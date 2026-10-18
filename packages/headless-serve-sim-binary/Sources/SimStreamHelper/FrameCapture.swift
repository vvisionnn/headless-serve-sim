import Foundation
import CoreVideo
import CoreMedia
import CoreGraphics
import IOSurface
import ObjectiveC

/// Headless simulator frame capture via direct IOSurface access.
///
/// Uses SimulatorKit frame callbacks (via objc_msgSend on the IO port descriptor)
/// for event-driven capture with zero jitter. Maintains a 5fps idle floor
/// for late-joining clients.
///
/// Pipeline: IOSurface callback → owned `FrameSnapshotter` buffer → encoders
final class FrameCapture {
    private var onFrame: ((CVPixelBuffer, CMTime, Bool) -> Void)?
    private var onIdle: (() -> Void)?
    private var requiresIdleFrame: (() -> Bool)?
    private var frameCount: UInt64 = 0
    private(set) var capturedWidth: Int = 0
    private(set) var capturedHeight: Int = 0
    var onDisplayChanged: ((Int?, Int) -> Void)?
    var onPanelFrame: ((Int, CVPixelBuffer) -> Void)?
    var requiresPanelFrame: (() -> Bool)?
    private var panelsNeedRefresh = false
    var onHingeChanged: ((Double) -> Void)?
    var onDisplayBlanked: ((Int, Bool) -> Void)?
    // Binding is capture-queue-owned; publish only completed transitions for
    // consumers on other queues. Do not expose live displayBinding.state.
    private let displayStateLock = NSLock()
    private var publishedDisplayState = FrameDisplayState(displayID: nil, rotation: 0)
    var displayState: FrameDisplayState {
        displayStateLock.lock()
        defer { displayStateLock.unlock() }
        return publishedDisplayState
    }
    private var publishedDisplaySize: (width: Int, height: Int)?
    /// Raw pixel size of the active panel, published with `displayState`.
    var activeDisplaySize: (width: Int, height: Int)? {
        displayStateLock.lock()
        defer { displayStateLock.unlock() }
        return publishedDisplaySize
    }
    var activeDisplayID: Int? { displayState.displayID }
    var displayRotation: Int { displayState.rotation }
    private(set) var touchDisplayID: Int?
    private(set) var hasMultipleIntegratedDisplays = false
    private var displayBinding = FrameDisplayBinding()
    private var observedDisplay: FrameObservedDisplay?
    private var displayMonitor: FrameDisplayMonitor?
    private var idleTimer: DispatchSourceTimer?
    private let captureQueue = DispatchQueue(label: "frame-capture", qos: .userInteractive)
    private var lastCaptureTimeMs: UInt64 = 0
    private var lastSeeds: [ObjectIdentifier: UInt32] = [:]
    private var rewireTickCount: Int = 0
    private var panelIDs: [ObjectIdentifier: Int] = [:]
    /// Interval at which the idle timer re-emits the current frame even when
    /// the simulator isn't rendering anything new. This is load-bearing for two
    /// consumers:
    /// 1. Browsers rendering `<img src="…/stream.mjpeg">` only render a multipart
    ///    chunk once the NEXT boundary arrives, so a single static frame never
    ///    paints until something changes.
    /// 2. Any upstream MJPEG→WebSocket relay only caches a frame when at least
    ///    one subscriber is due for it — a late-joining relay subscriber on an
    ///    idle sim never gets a cached frame to show.
    /// Re-emitting at ~5 fps fixes both without meaningful CPU cost.
    private static let idleIntervalMs: UInt64 = 200

    private var descriptors: [NSObject] = []
    private var callbackUUIDs: [ObjectIdentifier: NSUUID] = [:]
    private var screenProperties: [ObjectIdentifier: NSObject] = [:]
    private var ioClient: NSObject?
    private var activeDescriptor: NSObject?
    private var cachedSurfaceID: IOSurfaceID?
    private var cachedPixelBuffer: CVPixelBuffer?

    func start(
        deviceUDID: String,
        onIdle: @escaping () -> Void,
        requiresIdleFrame: @escaping () -> Bool,
        onFrame: @escaping (CVPixelBuffer, CMTime, Bool) -> Void
    ) throws {
        self.onFrame = onFrame
        self.onIdle = onIdle
        self.requiresIdleFrame = requiresIdleFrame

        Self.loadSimulatorFrameworks()

        guard let device = Self.findSimDevice(udid: deviceUDID) else {
            throw makeError(1, "Device \(deviceUDID) not found")
        }

        let state = device.value(forKey: "stateString") as? String ?? "unknown"
        guard state == "Booted" else {
            throw makeError(2, "Device not booted (state: \(state))")
        }

        guard let io = device.perform(NSSelectorFromString("io"))?.takeUnretainedValue() as? NSObject else {
            throw makeError(3, "Failed to get device IO")
        }
        self.ioClient = io

        try wireUpFramebuffer()
        let integratedDisplays = descriptors.filter {
            FrameDisplayProperties.read($0, width: 0, height: 0).screenType == 0
        }
        if integratedDisplays.count > 1 {
            let monitor = FrameDisplayMonitor()
            monitor.onHinge = { [weak self] angle in self?.onHingeChanged?(angle) }
            displayMonitor = monitor
            let allowedIDs = Set(integratedDisplays.compactMap { FrameDisplayProperties.read($0, width: 0, height: 0).screenID })
            monitor.start(deviceUDID: deviceUDID, allowedIDs: allowedIDs,
                          observerPath: ProcessInfo.processInfo.environment["HEADLESS_SERVE_SIM_DISPLAY_OBSERVER"]) { [weak self, weak monitor] display in
                self?.captureQueue.async { [weak self, weak monitor] in
                    guard let self, let monitor, self.displayMonitor === monitor else { return }
                    guard self.observedDisplay != display else { return }
                    self.observedDisplay = display
                    self.onDisplayBlanked?(display.displayID, display.blanked)
                    self.captureFrame(refreshDisplay: true)
                }
            }
        }
        if hasMultipleIntegratedDisplays, onPanelFrame != nil {
            for descriptor in integratedDisplays { capturePanel(descriptor, force: true) }
        }
        startIdleTimer()
        print("[capture] Frame callbacks registered (event-driven) + 5fps idle floor")
    }

    /// Find all framebuffer display descriptors, register callbacks on each,
    /// and cache them. Safe to re-call if the cached descriptors become stale.
    ///
    /// Listen on all display ports so foldable devices can switch the active
    /// panel without restarting capture. Older runtimes fall back to area.
    private func wireUpFramebuffer() throws {
        guard let io = ioClient else {
            throw makeError(3, "No IO client")
        }

        // Refresh ports — descriptors are created lazily.
        io.perform(NSSelectorFromString("updateIOPorts"))

        let candidates = try findFramebufferDescriptors(io: io)

        // Tear down old callbacks.
        let unregSel = NSSelectorFromString("unregisterScreenCallbacksWithUUID:")
        for oldDesc in descriptors {
            if let uuid = callbackUUIDs[ObjectIdentifier(oldDesc)],
               oldDesc.responds(to: unregSel) {
                oldDesc.perform(unregSel, with: uuid)
            }
        }
        callbackUUIDs.removeAll()
        screenProperties.removeAll()
        lastSeeds.removeAll()
        activeDescriptor = nil
        cachedSurfaceID = nil
        cachedPixelBuffer = nil
        descriptors = candidates
        panelIDs = Dictionary(uniqueKeysWithValues: candidates.compactMap { descriptor in
            let properties = FrameDisplayProperties.read(descriptor, width: 0, height: 0)
            return properties.screenType == 0 ? properties.screenID.map { (ObjectIdentifier(descriptor), $0) } : nil
        })
        hasMultipleIntegratedDisplays = candidates.filter {
            FrameDisplayProperties.read($0, width: 0, height: 0).screenType == 0
        }.count > 1

        // Registering screen callbacks is what causes SimulatorKit to wire the
        // display pipeline to our client and populate `framebufferSurface`.
        for desc in candidates {
            try registerFrameCallbacks(desc: desc)
        }

        captureFrame()
        if capturedWidth > 0, capturedHeight > 0 {
            print("[capture] Framebuffer: \(capturedWidth)x\(capturedHeight) (direct IOSurface, zero-copy)")
        }
    }

    private func findFramebufferDescriptors(io: NSObject) throws -> [NSObject] {
        guard let ports = io.value(forKey: "deviceIOPorts") as? [NSObject] else {
            throw makeError(4, "Failed to get IO ports")
        }

        let pidSel = NSSelectorFromString("portIdentifier")
        let descSel = NSSelectorFromString("descriptor")
        let surfSel = NSSelectorFromString("framebufferSurface")

        var candidates: [NSObject] = []
        for port in ports {
            guard port.responds(to: pidSel),
                  let pid = port.perform(pidSel)?.takeUnretainedValue(),
                  "\(pid)" == "com.apple.framebuffer.display",
                  port.responds(to: descSel),
                  let desc = port.perform(descSel)?.takeUnretainedValue() as? NSObject,
                  desc.responds(to: surfSel)
            else { continue }
            candidates.append(desc)
        }

        if candidates.isEmpty {
            throw makeError(5, "No framebuffer display descriptor found")
        }
        return candidates
    }

    private func pickBestDescriptor() -> (descriptor: NSObject, candidate: FrameDisplayCandidate)? {
        let surfSel = NSSelectorFromString("framebufferSurface")
        var liveDescriptors: [NSObject] = []
        var candidates: [FrameDisplayCandidate] = []
        for desc in descriptors {
            guard let surfObj = desc.perform(surfSel)?.takeUnretainedValue() else { continue }
            let surf = unsafeBitCast(surfObj, to: IOSurface.self)
            liveDescriptors.append(desc)
            candidates.append(FrameDisplayProperties.read(desc, width: IOSurfaceGetWidth(surf),
                                                          height: IOSurfaceGetHeight(surf),
                                                          properties: screenProperties[ObjectIdentifier(desc)]))
        }
        guard let index = FrameDisplaySelector.select(candidates, activeDisplayID: observedDisplay?.displayID) else { return nil }
        if let observedDisplay, candidates[index].screenID == observedDisplay.displayID {
            switch observedDisplay.rotation {
            case 180: candidates[index].uiOrientation = 2
            case 270: candidates[index].uiOrientation = 3
            case 90: candidates[index].uiOrientation = 4
            default: candidates[index].uiOrientation = 1
            }
        }
        return (liveDescriptors[index], candidates[index])
    }

    @discardableResult
    private func refreshDisplayBinding() -> Bool {
        guard let selected = pickBestDescriptor() else {
            if touchDisplayID != nil {
                touchDisplayID = nil
                onDisplayChanged?(activeDisplayID, displayRotation)
            }
            return false
        }
        let nextTouchDisplayID = FrameDisplaySelector.touchDisplayID(selected.candidate,
                                                                    hasMultipleIntegratedDisplays: hasMultipleIntegratedDisplays)
        let touchDisplayChanged = touchDisplayID != nextTouchDisplayID
        touchDisplayID = nextTouchDisplayID
        let change = displayBinding.update(descriptorID: ObjectIdentifier(selected.descriptor),
                                           candidate: selected.candidate)
        activeDescriptor = selected.descriptor
        if change.bindingChanged {
            lastSeeds.removeAll()
            cachedSurfaceID = nil
            cachedPixelBuffer = nil
        }
        if change.stateChanged || touchDisplayChanged {
            let next = displayBinding.state
            displayStateLock.lock()
            publishedDisplayState = next
            publishedDisplaySize = (selected.candidate.width, selected.candidate.height)
            displayStateLock.unlock()
            onDisplayChanged?(next.displayID, next.rotation)
        }
        return change.bindingChanged
    }

    // MARK: - Frame callbacks via objc_msgSend

    private func registerFrameCallbacks(desc: NSObject) throws {
        let regSel = NSSelectorFromString("registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:")
        guard desc.responds(to: regSel) else {
            throw makeError(8, "Descriptor doesn't support registerScreenCallbacks")
        }

        guard let msgSendPtr = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "objc_msgSend") else {
            throw makeError(9, "objc_msgSend not found")
        }

        typealias MsgSendFunc = @convention(c) (
            AnyObject, Selector, AnyObject, AnyObject, AnyObject, AnyObject, AnyObject
        ) -> Void
        let msgSend = unsafeBitCast(msgSendPtr, to: MsgSendFunc.self)

        let uuid = NSUUID()
        let descriptorID = ObjectIdentifier(desc)
        callbackUUIDs[descriptorID] = uuid
        let propertiesSel = NSSelectorFromString("screenProperties")
        if desc.responds(to: propertiesSel),
           let properties = desc.perform(propertiesSel)?.takeUnretainedValue() as? NSObject {
            screenProperties[descriptorID] = properties
        }

        let frameCallback: @convention(block) () -> Void = { [weak self] in
            self?.captureFrame()
        }
        let surfacesCallback: @convention(block) () -> Void = { [weak self] in
            guard let self else { return }
            self.cachedSurfaceID = nil
            self.cachedPixelBuffer = nil
            self.captureFrame(refreshDisplay: true)
        }
        let propsCallback: @convention(block) (NSObject) -> Void = { [weak self] properties in
            guard let self else { return }
            // The callback snapshot is live; descriptor.screenProperties can
            // retain its initial backlight state after a panel switch.
            self.screenProperties[descriptorID] = properties
            self.captureFrame(refreshDisplay: true)
        }

        msgSend(
            desc, regSel,
            uuid, captureQueue as AnyObject,
            frameCallback as AnyObject, surfacesCallback as AnyObject, propsCallback as AnyObject
        )
    }

    private func startIdleTimer() {
        let timer = DispatchSource.makeTimerSource(queue: captureQueue)
        timer.schedule(deadline: .now().advanced(by: .milliseconds(Int(Self.idleIntervalMs))),
                       repeating: .milliseconds(Int(Self.idleIntervalMs)))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            // Probe native screen state even when H.264 needs no idle pixels.
            if self.refreshDisplayBinding() {
                self.captureFrame()
            }
            let nowMs = DispatchTime.now().uptimeNanoseconds / 1_000_000
            if self.panelsNeedRefresh, self.requiresPanelFrame?() == true { self.captureFrame() }
            if (nowMs - self.lastCaptureTimeMs) >= Self.idleIntervalMs {
                self.onIdle?()
                if self.requiresIdleFrame?() == true {
                    self.captureFrame()
                } else {
                    self.lastCaptureTimeMs = nowMs
                }
            }
            // Self-heal: if we've never captured a frame, the cached descriptor
            // is likely stale. Re-wire the pipeline periodically (every ~1s)
            // until frames start flowing.
            if self.frameCount == 0 {
                self.rewireTickCount += 1
                if self.rewireTickCount % 5 == 0 {
                    do {
                        try self.wireUpFramebuffer()
                    } catch {
                        // Swallow — we'll try again on the next tick.
                    }
                }
            }
        }
        timer.resume()
        self.idleTimer = timer
    }

    // MARK: - Frame capture

    private func capturePanel(_ descriptor: NSObject, force: Bool = false) {
        guard let onPanelFrame, let id = panelIDs[ObjectIdentifier(descriptor)],
              let object = descriptor.perform(NSSelectorFromString("framebufferSurface"))?.takeUnretainedValue() else { return }
        let surface = unsafeBitCast(object, to: IOSurface.self)
        let width = IOSurfaceGetWidth(surface), height = IOSurfaceGetHeight(surface)
        guard width > 0, height > 0 else { return }
        let key = ObjectIdentifier(descriptor), seed = IOSurfaceGetSeed(surface)
        if !force, lastSeeds[key] == seed { return }
        lastSeeds[key] = seed
        var buffer: Unmanaged<CVPixelBuffer>?
        guard CVPixelBufferCreateWithIOSurface(kCFAllocatorDefault, surface, nil, &buffer) == kCVReturnSuccess,
              let buffer else { return }
        frameCount += 1
        onPanelFrame(id, buffer.takeRetainedValue())
    }

    private func captureFrame(refreshDisplay: Bool = false) {
        if refreshDisplay || activeDescriptor == nil {
            refreshDisplayBinding()
        }
        if hasMultipleIntegratedDisplays, onPanelFrame != nil {
            if frameCount > 0, requiresPanelFrame?() == false {
                panelsNeedRefresh = true
                return
            }
            let nowMs = DispatchTime.now().uptimeNanoseconds / 1_000_000
            let idleRefreshDue = frameCount > 0 && nowMs &- lastCaptureTimeMs >= Self.idleIntervalMs
            let previousFrameCount = frameCount
            for descriptor in descriptors { capturePanel(descriptor, force: refreshDisplay || idleRefreshDue || panelsNeedRefresh) }
            panelsNeedRefresh = false
            if frameCount != previousFrameCount { lastCaptureTimeMs = nowMs }
            return
        }
        guard let desc = activeDescriptor else { return }

        let surfSel = NSSelectorFromString("framebufferSurface")
        guard let surfObj = desc.perform(surfSel)?.takeUnretainedValue() else { return }
        let surface = unsafeBitCast(surfObj, to: IOSurface.self)

        // Seed-skip: when the simulator's framebuffer content hasn't changed,
        // don't spend cycles re-encoding the same pixels back-to-back from the
        // frame-callback path. BUT: we must still re-emit at the idle floor
        // (~5 fps) so that downstream consumers keep seeing a live stream —
        // see the `idleIntervalMs` doc-comment for why that matters.
        let key = ObjectIdentifier(desc)
        let seed = IOSurfaceGetSeed(surface)
        let nowMs = DispatchTime.now().uptimeNanoseconds / 1_000_000
        let sinceLastMs = nowMs &- lastCaptureTimeMs
        let seedChanged = lastSeeds[key] != seed
        let idleRefreshDue = frameCount > 0 && sinceLastMs >= Self.idleIntervalMs
        if frameCount > 0, !seedChanged, !idleRefreshDue { return }
        lastSeeds[key] = seed

        let w = IOSurfaceGetWidth(surface)
        let h = IOSurfaceGetHeight(surface)
        guard w > 0, h > 0 else { return }

        if capturedWidth != w || capturedHeight != h {
            capturedWidth = w
            capturedHeight = h
            print("[capture] Surface size changed: \(w)x\(h)")
        }

        let surfaceID = IOSurfaceGetID(surface)
        let pb: CVPixelBuffer
        if cachedSurfaceID == surfaceID, let cachedPixelBuffer {
            pb = cachedPixelBuffer
        } else {
            var pixelBuffer: Unmanaged<CVPixelBuffer>?
            let status = CVPixelBufferCreateWithIOSurface(
                kCFAllocatorDefault, surface,
                [kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA] as CFDictionary,
                &pixelBuffer
            )
            guard status == kCVReturnSuccess,
                  let created = pixelBuffer?.takeRetainedValue() else { return }
            cachedSurfaceID = surfaceID
            cachedPixelBuffer = created
            pb = created
        }

        lastCaptureTimeMs = nowMs
        frameCount += 1
        let timestamp = CMTime(value: CMTimeValue(frameCount), timescale: 60)
        onFrame?(pb, timestamp, seedChanged)
    }

    /// Explicit touch targets must still have a registered Integrated framebuffer.
    func connectedIntegratedDisplayID(_ id: Int) -> Int? {
        captureQueue.sync {
            guard hasMultipleIntegratedDisplays,
                  let descriptor = descriptors.first(where: {
                      panelIDs[ObjectIdentifier($0)] == id && callbackUUIDs[ObjectIdentifier($0)] != nil
                  }),
                  let object = descriptor.perform(NSSelectorFromString("framebufferSurface"))?.takeUnretainedValue() else { return nil }
            let surface = unsafeBitCast(object, to: IOSurface.self)
            let candidate = FrameDisplayProperties.read(descriptor, width: IOSurfaceGetWidth(surface),
                height: IOSurfaceGetHeight(surface), properties: screenProperties[ObjectIdentifier(descriptor)])
            guard candidate.screenID == id else { return nil }
            return FrameDisplaySelector.touchDisplayID(candidate, hasMultipleIntegratedDisplays: true)
        }
    }

    /// Wheel deltas are raw-panel pixels even when the video is a composition.
    /// Resolve dimensions and the validated touch binding together on captureQueue.
    func scrollGeometry(displayID: Int?) -> (width: Int, height: Int, displayID: Int?)? {
        captureQueue.sync {
            let descriptor: NSObject?
            if let displayID {
                guard hasMultipleIntegratedDisplays else { return nil }
                descriptor = descriptors.first { panelIDs[ObjectIdentifier($0)] == displayID }
            } else { descriptor = activeDescriptor }
            guard let descriptor, callbackUUIDs[ObjectIdentifier(descriptor)] != nil,
                  let object = descriptor.perform(NSSelectorFromString("framebufferSurface"))?.takeUnretainedValue() else { return nil }
            let surface = unsafeBitCast(object, to: IOSurface.self)
            let width = IOSurfaceGetWidth(surface), height = IOSurfaceGetHeight(surface)
            guard width > 0, height > 0 else { return nil }
            let candidate = FrameDisplayProperties.read(descriptor, width: width, height: height,
                properties: screenProperties[ObjectIdentifier(descriptor)])
            let target = FrameDisplaySelector.touchDisplayID(candidate, hasMultipleIntegratedDisplays: hasMultipleIntegratedDisplays)
            guard displayID == nil || target == displayID else { return nil }
            return (width, height, target)
        }
    }

    func getScreenSize() -> (width: Int, height: Int)? {
        guard capturedWidth > 0, capturedHeight > 0 else { return nil }
        return (capturedWidth, capturedHeight)
    }

    func stop() {
        displayMonitor?.stop()
        displayMonitor = nil
        observedDisplay = nil
        idleTimer?.cancel()
        idleTimer = nil

        let unregSel = NSSelectorFromString("unregisterScreenCallbacksWithUUID:")
        for desc in descriptors {
            if let uuid = callbackUUIDs[ObjectIdentifier(desc)],
               desc.responds(to: unregSel) {
                desc.perform(unregSel, with: uuid)
            }
        }
        callbackUUIDs.removeAll()
        screenProperties.removeAll()
        descriptors.removeAll()
        panelIDs.removeAll()
        lastSeeds.removeAll()
        panelsNeedRefresh = false
        displayBinding = FrameDisplayBinding()
        displayStateLock.lock()
        publishedDisplayState = FrameDisplayState(displayID: nil, rotation: 0)
        publishedDisplaySize = nil
        displayStateLock.unlock()
        touchDisplayID = nil
        hasMultipleIntegratedDisplays = false
        activeDescriptor = nil
        cachedSurfaceID = nil
        cachedPixelBuffer = nil
        ioClient = nil
        onIdle = nil
        requiresIdleFrame = nil
    }

    // MARK: - Helpers

    private func makeError(_ code: Int, _ msg: String) -> NSError {
        NSError(domain: "FrameCapture", code: code,
                userInfo: [NSLocalizedDescriptionKey: msg])
    }

    static func findSimDevice(udid: String) -> NSObject? {
        guard let contextClass = NSClassFromString("SimServiceContext") as? NSObject.Type else { return nil }
        let developerDir = getDeveloperDir()
        let sharedSel = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
        guard let context = contextClass.perform(sharedSel, with: developerDir, with: nil)?
                .takeUnretainedValue() as? NSObject else { return nil }
        let deviceSetSel = NSSelectorFromString("defaultDeviceSetWithError:")
        guard let deviceSet = context.perform(deviceSetSel, with: nil)?
                .takeUnretainedValue() as? NSObject else { return nil }
        guard let devices = deviceSet.value(forKey: "devices") as? [NSObject] else { return nil }
        return devices.first(where: {
            ($0.value(forKey: "UDID") as? NSUUID)?.uuidString == udid
        })
    }

    static func getDeveloperDir() -> String {
        DeveloperDir.resolve()
    }

    /// Xcode 27 moved SimulatorKit from `Developer/Library/PrivateFrameworks`
    /// to `Contents/SharedFrameworks`; try both. CoreSimulator stays in the
    /// shared system-wide location across versions.
    static func loadSimulatorFrameworks() {
        SimFrameworks.load()
    }
}
