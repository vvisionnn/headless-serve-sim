import CoreVideo
import Foundation
import IOSurface

// Replace only the external Simulator/CoreDevice boundaries. FrameCapture and
// its Objective-C descriptor callbacks below are the production implementation.
enum SimFrameworks { static func load() {} }
enum DeveloperDir { static func resolve() -> String { "/test" } }
struct FrameObservedDisplay: Equatable { let displayID: Int; let rotation: Int; var blanked = false }
final class FrameDisplayMonitor {
    var onHinge: ((Double) -> Void)?
    func start(deviceUDID: String, allowedIDs: Set<Int>, observerPath: String?, onDisplay: @escaping (FrameObservedDisplay) -> Void) {}
    func stop() {}
}

@objc final class TestScreenProperties: NSObject {
    @objc let screenID: UInt32
    @objc let screenType: UInt64 = 0
    @objc var uiOrientation: UInt32 = 1
    init(id: UInt32) { screenID = id }
}

@objc final class TestDescriptor: NSObject {
    let buffer: CVPixelBuffer
    @objc let screenProperties: TestScreenProperties
    private var callback: (@convention(block) () -> Void)?
    private var callbackQueue: DispatchQueue?
    @objc var framebufferSurface: AnyObject { CVPixelBufferGetIOSurface(buffer)!.takeUnretainedValue() }
    init(id: UInt32, width: Int, height: Int) {
        screenProperties = TestScreenProperties(id: id)
        var buffer: CVPixelBuffer?
        precondition(CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32BGRA,
            [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary, &buffer) == kCVReturnSuccess)
        self.buffer = buffer!
    }
    @objc(registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:)
    func register(_ uuid: AnyObject, queue: AnyObject, frame: AnyObject, surfaces: AnyObject, properties: AnyObject) {
        callbackQueue = queue as? DispatchQueue
        callback = unsafeBitCast(frame, to: (@convention(block) () -> Void).self)
    }
    @objc(unregisterScreenCallbacksWithUUID:) func unregister(_ uuid: AnyObject) { callback = nil }
    func changed() {
        precondition(CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess)
        CVPixelBufferUnlockBaseAddress(buffer, [])
        callbackQueue!.sync { callback?() }
    }
}

@objc final class TestPort: NSObject {
    @objc let portIdentifier = "com.apple.framebuffer.display"
    @objc let descriptor: TestDescriptor
    init(_ descriptor: TestDescriptor) { self.descriptor = descriptor }
}
@objc final class TestIO: NSObject {
    @objc let deviceIOPorts: [TestPort]
    init(_ descriptors: [TestDescriptor]) { deviceIOPorts = descriptors.map(TestPort.init) }
    @objc func updateIOPorts() {}
}
@objc final class TestDevice: NSObject {
    @objc let UDID = NSUUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    @objc let stateString = "Booted"
    @objc let io: TestIO
    init(_ descriptors: [TestDescriptor]) { io = TestIO(descriptors) }
}
@objc final class TestDeviceSet: NSObject {
    @objc var devices: [TestDevice] = []
}
@objc(SimServiceContext) final class TestServiceContext: NSObject {
    static let shared = TestServiceContext()
    let deviceSet = TestDeviceSet()
    @objc(sharedServiceContextForDeveloperDir:error:)
    static func context(_ directory: AnyObject, error: AnyObject?) -> TestServiceContext { shared }
    @objc(defaultDeviceSetWithError:) func defaultSet(_ error: AnyObject?) -> TestDeviceSet { deviceSet }
}

/// Polls until `condition` holds; the deadline is a hang guard, not a timing budget.
func waitUntil(_ what: String, _ condition: () -> Bool) {
    let deadline = Date().addingTimeInterval(60)
    while !condition() {
        precondition(Date() < deadline, "timed out waiting for \(what)")
        Thread.sleep(forTimeInterval: 0.005)
    }
}

@main enum FrameCaptureSelftest {
    static func main() throws {
        let descriptors = [TestDescriptor(id: 1, width: 14, height: 20), TestDescriptor(id: 3, width: 20, height: 28)]
        TestServiceContext.shared.deviceSet.devices = [TestDevice(descriptors)]
        let capture = FrameCapture()
        let lock = NSLock()
        var panels = 0
        capture.onPanelFrame = { _, _ in lock.lock(); panels += 1; lock.unlock() }
        try capture.start(deviceUDID: "11111111-1111-1111-1111-111111111111", onIdle: {}, requiresIdleFrame: { true }, onFrame: { _, _, _ in
            preconditionFailure("multi-panel capture must use panel callbacks")
        })
        defer { capture.stop() }
        lock.lock(); let initial = panels; lock.unlock()
        precondition(initial >= 2, "startup must seed both panels")
        // Static Duo MJPEG must keep receiving panel refreshes at the idle floor.
        waitUntil("idle-floor panel refreshes") { lock.lock(); defer { lock.unlock() }; return panels >= initial + 2 }
        capture.stop()
        let demandCapture = FrameCapture()
        var demanded = true
        var demandedPanels = 0
        demandCapture.onPanelFrame = { _, _ in lock.lock(); demandedPanels += 1; lock.unlock() }
        demandCapture.requiresPanelFrame = { lock.lock(); defer { lock.unlock() }; return demanded }
        try demandCapture.start(deviceUDID: "11111111-1111-1111-1111-111111111111", onIdle: {}, requiresIdleFrame: { false }, onFrame: { _, _, _ in })
        lock.lock(); demanded = false; let seeded = demandedPanels; lock.unlock()
        for _ in 0..<10 { descriptors.forEach { $0.changed() } }
        lock.lock(); let withoutDemand = demandedPanels; lock.unlock()
        precondition(withoutDemand == seeded, "zero-demand callbacks must not publish/copy raw panels")
        lock.lock(); demanded = true; lock.unlock()
        descriptors.forEach { $0.changed() }
        lock.lock(); let resumed = demandedPanels; lock.unlock()
        precondition(resumed >= seeded + 2, "viewer rejoin must receive fresh panels even after seeds advanced")
        demandCapture.stop()
        let publicationCapture = FrameCapture()
        var callbackState: FrameDisplayState?
        publicationCapture.onDisplayChanged = { id, rotation in
            let snapshot = publicationCapture.displayState
            precondition(snapshot == FrameDisplayState(displayID: id, rotation: rotation),
                         "callbacks must observe the completed published transition")
            callbackState = snapshot
        }
        try publicationCapture.start(deviceUDID: "11111111-1111-1111-1111-111111111111", onIdle: {}, requiresIdleFrame: { false }, onFrame: { _, _, _ in })
        precondition(callbackState == FrameDisplayState(displayID: 3, rotation: 0))
        let coverGeometry = publicationCapture.scrollGeometry(displayID: 1)!
        precondition(coverGeometry.width == 14 && coverGeometry.height == 20 && coverGeometry.displayID == 1)
        let innerGeometry = publicationCapture.scrollGeometry(displayID: nil)!
        precondition(innerGeometry.width == 20 && innerGeometry.height == 28 && innerGeometry.displayID == 3)
        precondition(publicationCapture.scrollGeometry(displayID: 2) == nil, "unregistered panel must not route wheel input")
        descriptors[1].screenProperties.uiOrientation = 4
        descriptors[1].changed()
        waitUntil("rotation publication") { publicationCapture.displayState == FrameDisplayState(displayID: 3, rotation: 90) }
        publicationCapture.stop()
        precondition(publicationCapture.displayState == FrameDisplayState(displayID: nil, rotation: 0))
        let sourceURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/SimStreamHelper/FrameCapture.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)
        precondition(source.contains("displayStateLock") && source.contains("publishedDisplayState"),
                     "cross-queue display reads must use a synchronized publication, not live binding state")
        let mainSource = try String(contentsOf: sourceURL.deletingLastPathComponent().appendingPathComponent("main.swift"), encoding: .utf8)
        let scrollWiring = mainSource.components(separatedBy: "onScroll =")[1].components(separatedBy: "onSoftwareKeyboard")[0]
        precondition(scrollWiring.contains("scrollGeometry") && scrollWiring.contains("displayID:"),
                     "wheel input must bind to raw panel geometry, not composed-video screen dimensions")
        print("Frame capture static Duo idle refresh, demand, display publication and scroll geometry self-test passed")
    }
}
