import Foundation
import ObjectiveC
import Darwin

/// Injects touch, button, and orientation HID events into the iOS Simulator.
///
/// Uses IndigoHIDMessageForMouseNSEvent to create touch messages and
/// IndigoHIDMessageForButton for hardware button presses, sent via
/// SimDeviceLegacyHIDClient. Orientation goes through a separate transport
/// (PurpleWorkspacePort / GSEvent mach messages), matching idb's approach.
///
/// The real C signature for touch is:
///   IndigoHIDMessageForMouseNSEvent(CGPoint*, CGPoint*, IndigoHIDTarget, NSEventType, NSSize, IndigoHIDEdge)
/// On arm64: x0=CGPoint*, x1=CGPoint*/NULL, x2=target, x3=eventType, d0/d1=NSSize, x4=edge.
/// Apple's Simulator.app always passes NSSize(1.0, 1.0), making ratio = point / 1.0 = point.
/// The edge parameter (x4) controls whether iOS treats the touch as a system edge gesture
/// (e.g. bottom edge = swipe-to-home on Face ID devices).
final class HIDInjector {
    private var hidClient: NSObject?
    private var sendSel: Selector?
    private var simDevice: NSObject?

    // IndigoHIDMessageForMouseNSEvent(CGPoint*, CGPoint*, IndigoHIDTarget, NSEventType, NSSize, IndigoHIDEdge)
    // arm64 ABI: pointer/int params → x0-x4, float params → d0-d1 (independent numbering).
    // CGFloat params map to d0 (NSSize.width) and d1 (NSSize.height).
    private typealias IndigoMouseFunc = @convention(c) (
        UnsafePointer<CGPoint>, UnsafePointer<CGPoint>?, UInt32, Int32, CGFloat, CGFloat, UInt32
    ) -> UnsafeMutableRawPointer?
    private var mouseFunc: IndigoMouseFunc?

    // IndigoHIDMessageForButton(int eventSource, int direction, int target) -> IndigoMessage*
    private typealias IndigoButtonFunc = @convention(c) (Int32, Int32, Int32) -> UnsafeMutableRawPointer?
    private var buttonFunc: IndigoButtonFunc?

    // IndigoHIDMessageForKeyboardArbitrary(uint32_t keyCode, uint32_t direction) -> IndigoMessage*
    // direction: 1 = key down, 2 = key up
    private typealias IndigoKeyboardFunc = @convention(c) (UInt32, UInt32) -> UnsafeMutableRawPointer?
    private var keyboardFunc: IndigoKeyboardFunc?

    // IndigoHIDMessageForDigitalCrownEvent(double rotationalDelta) -> IndigoMessage*
    private typealias IndigoDigitalCrownFunc = @convention(c) (Double) -> UnsafeMutableRawPointer?
    private var digitalCrownFunc: IndigoDigitalCrownFunc?

    // IndigoHIDMessageForHIDArbitrary(target, usagePage, usage, direction) -> IndigoMessage*
    // Arg order recovered from the builder's disassembly: it writes arg0 into the
    // message's target slot (+0x38) and arg3 into the direction slot (+0x34).
    private typealias IndigoHIDArbitraryFunc = @convention(c) (UInt32, UInt32, UInt32, UInt32) -> UnsafeMutableRawPointer?
    private var hidArbitraryFunc: IndigoHIDArbitraryFunc?

    func setup(deviceUDID: String) throws {
        FrameCapture.loadSimulatorFrameworks()

        guard let device = FrameCapture.findSimDevice(udid: deviceUDID) else {
            throw NSError(domain: "HIDInjector", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Device \(deviceUDID) not found"])
        }
        self.simDevice = device

        guard let funcPtr = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "IndigoHIDMessageForMouseNSEvent") else {
            throw NSError(domain: "HIDInjector", code: 5,
                          userInfo: [NSLocalizedDescriptionKey: "IndigoHIDMessageForMouseNSEvent not found"])
        }
        self.mouseFunc = unsafeBitCast(funcPtr, to: IndigoMouseFunc.self)

        if let buttonPtr = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "IndigoHIDMessageForButton") {
            self.buttonFunc = unsafeBitCast(buttonPtr, to: IndigoButtonFunc.self)
            print("[hid] IndigoHIDMessageForButton loaded")
        } else {
            print("[hid] Warning: IndigoHIDMessageForButton not found")
        }

        if let keyboardPtr = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "IndigoHIDMessageForKeyboardArbitrary") {
            self.keyboardFunc = unsafeBitCast(keyboardPtr, to: IndigoKeyboardFunc.self)
            print("[hid] IndigoHIDMessageForKeyboardArbitrary loaded")
        } else {
            print("[hid] Warning: IndigoHIDMessageForKeyboardArbitrary not found")
        }

        if let crownPtr = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "IndigoHIDMessageForDigitalCrownEvent") {
            self.digitalCrownFunc = unsafeBitCast(crownPtr, to: IndigoDigitalCrownFunc.self)
            print("[hid] IndigoHIDMessageForDigitalCrownEvent loaded")
        } else {
            print("[hid] Warning: IndigoHIDMessageForDigitalCrownEvent not found")
        }

        if let arbPtr = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "IndigoHIDMessageForHIDArbitrary") {
            self.hidArbitraryFunc = unsafeBitCast(arbPtr, to: IndigoHIDArbitraryFunc.self)
            print("[hid] IndigoHIDMessageForHIDArbitrary loaded (buttons + keys)")
        } else {
            print("[hid] Warning: IndigoHIDMessageForHIDArbitrary not found — falling back to legacy button/key messages")
        }


        guard let hidClass = NSClassFromString("_TtC12SimulatorKit24SimDeviceLegacyHIDClient") else {
            throw NSError(domain: "HIDInjector", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "SimDeviceLegacyHIDClient not found"])
        }

        let initSel = NSSelectorFromString("initWithDevice:error:")
        typealias HIDInitFunc = @convention(c) (AnyObject, Selector, AnyObject, AutoreleasingUnsafeMutablePointer<NSError?>) -> AnyObject?
        guard let initIMP = class_getMethodImplementation(hidClass, initSel) else {
            throw NSError(domain: "HIDInjector", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "Cannot get init method"])
        }
        let initFunc = unsafeBitCast(initIMP, to: HIDInitFunc.self)

        var error: NSError?
        let client = initFunc(hidClass.alloc(), initSel, device, &error)
        if let error { throw error }
        guard let clientObj = client as? NSObject else {
            throw NSError(domain: "HIDInjector", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "Failed to create HID client"])
        }

        self.hidClient = clientObj
        self.sendSel = NSSelectorFromString("sendWithMessage:freeWhenDone:completionQueue:completion:")
        print("[hid] SimDeviceLegacyHIDClient created")
        print("[hid] IndigoHIDMessageForMouseNSEvent loaded (with edge gesture support)")

    }

    // IndigoHIDEdge values (x4 param to IndigoHIDMessageForMouseNSEvent).
    // These control system edge gesture recognition in the simulated iOS device.
    // Determined by disassembling IndigoHIDMessageForMouseNSEvent and testing
    // each value against a booted Face ID simulator.
    static let edgeNone: UInt32   = 0  // No edge — regular touch
    static let edgeBottom: UInt32 = 3  // Bottom edge — swipe-to-home on Face ID devices
    static let edgeTop: UInt32    = 2  // Top edge (notification center)
    static let edgeLeft: UInt32   = 1  // Left edge
    static let edgeRight: UInt32  = 4  // Right edge

    /// Build a single-finger touch message from normalized (0..1) coords. Pure,
    /// so it can run off `inputQueue`. NSSize(1,1) makes ratio = point.
    private func touchMessage(type: String, x: Double, y: Double, edge: UInt32) -> UnsafeMutableRawPointer? {
        guard let mouseFunc = mouseFunc else { return nil }
        let eventType: Int32
        switch type {
        // A continued touch uses Down, not Dragged — the C builder rejects 6.
        case "begin", "move": eventType = 1  // NSEventTypeLeftMouseDown
        case "end":           eventType = 2  // NSEventTypeLeftMouseUp
        default: return nil
        }
        var point = CGPoint(x: x, y: y)
        return mouseFunc(&point, nil, 0x32, eventType, 1.0, 1.0, edge)
    }

    /// Build and deliver one touch synchronously. Only call from `inputQueue`
    /// (the multi-step gestures below already run there).
    private func rawSendTouch(type: String, x: Double, y: Double, edge: UInt32 = 0) {
        if let msg = touchMessage(type: type, x: x, y: y, edge: edge) { rawSend(msg) }
    }

    func sendTouch(type: String, x: Double, y: Double, screenWidth: Int, screenHeight: Int, edge: UInt32 = 0) {
        guard let msg = touchMessage(type: type, x: x, y: y, edge: edge) else {
            print("[hid] IndigoHIDMessageForMouseNSEvent returned nil for \(type)")
            return
        }
        print("[hid] Sending \(type) at (\(String(format:"%.3f",x)),\(String(format:"%.3f",y)))\(edge > 0 ? " edge=\(edge)" : "")")
        // A direct touch interleaved with an in-flight scroll drag would corrupt
        // both gestures, so every send goes through the one input queue.
        inputQueue.async { [self] in rawSend(msg) }
    }

    func sendMultiTouch(type: String, x1: Double, y1: Double, x2: Double, y2: Double, screenWidth: Int, screenHeight: Int) {
        guard let mouseFunc = mouseFunc else { return }

        let eventType: Int32
        switch type {
        case "begin": eventType = 1  // NSEventTypeLeftMouseDown
        case "move":  eventType = 1  // Continued touch — use Down, not Dragged (C function rejects 6)
        case "end":   eventType = 2  // NSEventTypeLeftMouseUp
        default: return
        }

        // Pass both CGPoints to create a 3-block multi-touch message.
        // NSSize(1.0, 1.0) makes ratio = point / 1.0 = point, so all fields
        // (ratios + any derived values) are computed correctly by the C function.
        var point1 = CGPoint(x: x1, y: y1)
        var point2 = CGPoint(x: x2, y: y2)

        guard let rawMsg = mouseFunc(&point1, &point2, 0x32, eventType, 1.0, 1.0, 0) else {
            print("[hid] IndigoHIDMessageForMouseNSEvent returned nil for multi-touch \(type)")
            return
        }

        print("[hid] Multi-touch \(type) f1=(\(String(format:"%.3f",x1)),\(String(format:"%.3f",y1))) f2=(\(String(format:"%.3f",x2)),\(String(format:"%.3f",y2)))")
        inputQueue.async { [self] in rawSend(rawMsg) }
    }

    // MARK: - Button events

    // idb eventSource constants (first arg to IndigoHIDMessageForButton)
    private static let buttonSourceHome: Int32 = 0x0
    private static let buttonSourceLock: Int32 = 0x1
    private static let buttonSourceSideButton: Int32 = 0xbb8
    private static let buttonSourceSiri: Int32 = 0x400002
    // Software-keyboard toggle — the event source Simulator.app's ⌘K sends.
    private static let buttonSourceSoftwareKeyboard: Int32 = 0x3f0

    // idb direction constants (second arg)
    private static let buttonDown: Int32 = 1
    private static let buttonUp: Int32 = 2

    // idb target constant (third arg)
    private static let buttonTargetHardware: Int32 = 0x33

    /// Deliver a raw message to the guest, freeing it. Returns false when the
    /// transport isn't available.
    @discardableResult
    private func rawSend(_ msg: UnsafeMutableRawPointer) -> Bool {
        guard let client = hidClient, let sendSel = sendSel,
              let sendIMP = class_getMethodImplementation(object_getClass(client)!, sendSel)
        else {
            free(msg)
            return false
        }
        typealias SendFunc = @convention(c) (AnyObject, Selector, UnsafeMutableRawPointer, ObjCBool, AnyObject?, AnyObject?) -> Void
        unsafeBitCast(sendIMP, to: SendFunc.self)(client, sendSel, msg, ObjCBool(true), nil, nil)
        return true
    }

    /// Send one HID usage transition on the digitizer target. This is the single
    /// primitive behind both hardware buttons and keyboard keys — see `HIDUsage`
    /// for why the digitizer target is the portable one.
    /// Returns false when the arbitrary-HID builder isn't available.
    @discardableResult
    private func sendHIDUsage(page: UInt32, usage: UInt32, direction: UInt32) -> Bool {
        guard let arb = hidArbitraryFunc else { return false }
        guard let msg = arb(Self.hidUsageTarget, page, usage, direction) else {
            print("[hid] IndigoHIDMessageForHIDArbitrary returned nil (page=0x\(String(page, radix: 16)) usage=0x\(String(usage, radix: 16)))")
            return false
        }
        return rawSend(msg)
    }

    /// Press and release a HID usage, optionally holding it (Siri needs a hold).
    @discardableResult
    private func pressHIDUsage(page: UInt32, usage: UInt32, hold: TimeInterval = 0) -> Bool {
        guard sendHIDUsage(page: page, usage: usage, direction: HIDUsage.down) else { return false }
        if hold > 0 { Thread.sleep(forTimeInterval: hold) }
        return sendHIDUsage(page: page, usage: usage, direction: HIDUsage.up)
    }

    /// Target for arbitrary HID reports: the display digitizer, the one Indigo
    /// target every supported Xcode still routes to the guest.
    private static let hidUsageTarget: UInt32 = 0x32

    private func sendHIDButton(eventSource: Int32, direction: Int32) {
        guard let buttonFunc = buttonFunc else { return }

        // IndigoHIDMessageForButton returns a ready-to-send message
        // idb uses it directly with malloc_size to determine length
        guard let msg = buttonFunc(eventSource, direction, Self.buttonTargetHardware) else {
            print("[hid] IndigoHIDMessageForButton returned nil")
            return
        }
        rawSend(msg)
    }


    /// Every HID send funnels through this one serial queue so concurrent
    /// gestures — a scroll drag, a tap, a button press — can never interleave
    /// their messages to the shared `hidClient`. One-shot events dispatch a
    /// single `rawSend`; multi-step gestures run their whole sequence in one
    /// block using the synchronous `rawSend*` helpers.
    private let inputQueue = DispatchQueue(label: "hid-input")

    // MARK: - Keyboard events

    /// Inject a USB HID keyboard key event (Usage Page 0x07).
    /// - Parameters:
    ///   - type: "down" or "up"
    ///   - usage: HID usage code (e.g. 0x04 = 'A', 0x28 = Enter, 0xE1 = LeftShift)
    func sendKey(type: String, usage: UInt32) {
        let direction: UInt32
        switch type {
        case "down": direction = HIDUsage.down
        case "up":   direction = HIDUsage.up
        default: return
        }

        print("[hid] Key \(type) usage=0x\(String(usage, radix: 16))")

        // Preferred path: a keyboard-page HID report on the digitizer target.
        if sendHIDUsage(page: HIDUsage.keyboardPage, usage: usage, direction: direction) { return }

        // Fallback for toolchains without the arbitrary-HID builder.
        guard let keyboardFunc = keyboardFunc else {
            print("[hid] Keyboard injection unavailable")
            return
        }
        guard let msg = keyboardFunc(usage, direction) else {
            print("[hid] IndigoHIDMessageForKeyboardArbitrary returned nil (usage=0x\(String(usage, radix: 16)))")
            return
        }
        rawSend(msg)
    }


    // MARK: - Digital Crown events

    /// Inject a Digital Crown rotation event.
    /// - Parameter delta: Raw scroll delta, matching SimulatorKit's wheel-to-crown path.
    func sendDigitalCrown(delta: Double) {
        guard delta.isFinite, delta != 0 else { return }
        guard let digitalCrownFunc else {
            print("[hid] Digital Crown injection unavailable")
            return
        }

        let msg = digitalCrownFunc(delta)
        guard let msg else {
            print("[hid] IndigoHIDMessageForDigitalCrownEvent returned nil (delta=\(delta))")
            return
        }

        print("[hid] Digital Crown delta=\(String(format:"%.4f", delta))")
        inputQueue.async { [self] in rawSend(msg) }
    }

    // MARK: - Scroll events
    //
    // iOS treats the simulator display as a touchscreen; there is no hardware
    // scroll wheel behind it. Device Hub scrolls by capturing a real trackpad
    // and forwarding genuine HID scroll through a privileged pointer service
    // (`com.apple.private.hid.client.event-filter`), which an unprivileged
    // helper cannot do — and a synthetic scroll aimed at the pointer service
    // (target 0x35) is silently dropped.
    //
    // So scroll the way a finger does: turn the wheel delta into a touch drag on
    // the digitizer (0x32), the same path taps and swipes already use. A burst
    // of wheel events becomes one continuous drag — begin, moves, end once the
    // wheel goes idle — re-anchoring when the finger nears an edge so a long
    // scroll isn't capped by the screen bounds.

    /// Finger travel per unit of scroll delta, both fractions of the display.
    /// 1.0 keeps the guest's content tracking the pointer 1:1, which is what a
    /// real finger does — anything else makes the content lag or outrun the
    /// trackpad.
    private static let scrollDragGain: Double = 1.0
    /// Idle gap after which the drag lifts and the gesture ends. Long enough to
    /// span the widening gaps in a trackpad's momentum tail: at 0.1s the tail
    /// split into several gestures, each getting its own iOS deceleration.
    private static let scrollGestureIdle: TimeInterval = 0.18
    /// Deltas are accumulated for this long and applied as one move. A trackpad
    /// reports up to 120 times a second; one IPC round-trip per report backs the
    /// input queue up, and the extra moves buy no additional precision.
    private static let scrollFlushInterval: TimeInterval = 0.008
    /// Pause after the first touch-down so iOS registers the finger before it
    /// moves. Only the opening touch pays it — inside a gesture it would stall
    /// the serial queue mid-scroll.
    private static let scrollTouchSettleUs: UInt32 = 8000
    /// Bound on segments spent from one flush, so a malformed delta can't spin.
    private static let scrollMaxSegmentsPerFlush = 8

    private var scrollDragActive = false
    private var scrollFingerX = 0.5
    private var scrollFingerY = 0.5
    private var scrollAnchorX = 0.5
    private var scrollAnchorY = 0.5
    private var scrollPendingX = 0.0
    private var scrollPendingY = 0.0
    private var scrollFlushScheduled = false
    private var scrollEndWork: DispatchWorkItem?


    /// Inject a wheel / trackpad pan as a touch drag on the digitizer.
    ///
    /// iOS scrolls 1:1 with the finger, so a scroll longer than the display has
    /// to be spent across several touch-down…touch-up segments. Each seam is
    /// visible — iOS starts decelerating on the lift — so the aim is to need as
    /// few as possible: continuations start at the far wall for a full track of
    /// runway, and deltas are coalesced so the queue is never the bottleneck.
    ///
    /// - Parameters:
    ///   - dx: Horizontal delta as a fraction of the display (positive = content
    ///     moves right). A fraction, not pixels: only the browser knows how big
    ///     the stream is drawn, and normalizing here against the capture
    ///     resolution made content travel a fraction of the pointer.
    ///   - dy: Vertical delta as a fraction of the display (positive = down).
    ///   - anchorX: Normalized cursor x for the opening touch, or nil for centre.
    ///     Anchoring is what makes iOS hit-test the view under the pointer.
    ///   - anchorY: Normalized cursor y, as above.
    func sendScroll(dx: Double, dy: Double, anchorX: Double?, anchorY: Double?) {
        guard dx.isFinite, dy.isFinite, dx != 0 || dy != 0 else { return }

        // The finger travels opposite the content: scrolling content down is a
        // swipe up.
        let stepX = -dx * Self.scrollDragGain
        let stepY = -dy * Self.scrollDragGain
        let aX = ScrollDrag.clampToTrack(anchorX ?? 0.5)
        let aY = ScrollDrag.clampToTrack(anchorY ?? 0.5)

        inputQueue.async { [self] in
            if !scrollDragActive && !scrollFlushScheduled {
                // Latch the anchor from the event that opens the gesture; later
                // pointer drift must not move where iOS hit-tested.
                scrollAnchorX = aX
                scrollAnchorY = aY
            }
            scrollPendingX += stepX
            scrollPendingY += stepY
            guard !scrollFlushScheduled else { return }
            scrollFlushScheduled = true
            inputQueue.asyncAfter(deadline: .now() + Self.scrollFlushInterval) { [self] in
                scrollFlushScheduled = false
                flushScroll()
            }
        }
    }

    /// Spend the accumulated delta, opening or continuing the drag as needed.
    /// Runs on `inputQueue`.
    private func flushScroll() {
        var remainingX = scrollPendingX
        var remainingY = scrollPendingY
        scrollPendingX = 0
        scrollPendingY = 0
        guard remainingX != 0 || remainingY != 0 else { return }

        if !scrollDragActive {
            scrollFingerX = scrollAnchorX
            scrollFingerY = scrollAnchorY
            rawSendTouch(type: "begin", x: scrollFingerX, y: scrollFingerY)
            usleep(Self.scrollTouchSettleUs)
            scrollDragActive = true
        }

        var segments = 0
        while segments < Self.scrollMaxSegmentsPerFlush {
            segments += 1
            // The axis that runs out of track first bounds this segment.
            let usable = min(
                ScrollDrag.fractionBeforeWall(from: scrollFingerX, step: remainingX),
                ScrollDrag.fractionBeforeWall(from: scrollFingerY, step: remainingY),
            )
            if usable >= 1 {
                scrollFingerX = ScrollDrag.clampToTrack(scrollFingerX + remainingX)
                scrollFingerY = ScrollDrag.clampToTrack(scrollFingerY + remainingY)
                rawSendTouch(type: "move", x: scrollFingerX, y: scrollFingerY)
                break
            }

            // Travel what is left of the track, then lift and restart at the far
            // wall so the next segment gets the whole display to work with.
            scrollFingerX = ScrollDrag.clampToTrack(scrollFingerX + remainingX * usable)
            scrollFingerY = ScrollDrag.clampToTrack(scrollFingerY + remainingY * usable)
            rawSendTouch(type: "move", x: scrollFingerX, y: scrollFingerY)
            rawSendTouch(type: "end", x: scrollFingerX, y: scrollFingerY)

            remainingX *= 1 - usable
            remainingY *= 1 - usable
            scrollFingerX = ScrollDrag.segmentStart(anchor: scrollAnchorX, step: remainingX)
            scrollFingerY = ScrollDrag.segmentStart(anchor: scrollAnchorY, step: remainingY)
            rawSendTouch(type: "begin", x: scrollFingerX, y: scrollFingerY)
        }

        // Lift once the scroll goes quiet. The idle window is also a period of
        // stillness, so iOS reads a near-zero release velocity and adds no
        // momentum of its own — macOS already delivered the trackpad's.
        scrollEndWork?.cancel()
        let work = DispatchWorkItem { [self] in
            guard scrollDragActive else { return }
            rawSendTouch(type: "end", x: scrollFingerX, y: scrollFingerY)
            scrollDragActive = false
        }
        scrollEndWork = work
        inputQueue.asyncAfter(deadline: .now() + Self.scrollGestureIdle, execute: work)
    }

    /// Toggle the on-screen software keyboard, matching Simulator.app's
    /// I/O → Keyboard → Toggle Software Keyboard (⌘K): a momentary Indigo HID
    /// button press on event source 0x3f0. Instant, and it leaves the
    /// hardware-keyboard state alone.
    ///
    /// Unlike the hardware buttons this stays on `IndigoHIDMessageForButton`
    /// rather than the arbitrary-HID path — the toggle is an Apple-private
    /// event source, not a USB HID consumer usage, so it has no usage-page
    /// equivalent to send.
    func toggleSoftwareKeyboard() {
        guard buttonFunc != nil else {
            print("[hid] Software keyboard toggle unavailable (IndigoHIDMessageForButton not loaded)")
            return
        }
        print("[hid] Toggling software keyboard")
        inputQueue.async { [self] in
            sendHIDButton(eventSource: Self.buttonSourceSoftwareKeyboard, direction: Self.buttonDown)
            sendHIDButton(eventSource: Self.buttonSourceSoftwareKeyboard, direction: Self.buttonUp)
        }
    }

    /// Press an arbitrary USB HID usage, for controls with no name mapping.
    /// `phase` is "down", "up", or "press" for a full press-and-release.
    func sendHIDControl(page: UInt32, usage: UInt32, phase: String) {
        print("[hid] HID control page=0x\(String(page, radix: 16)) usage=0x\(String(usage, radix: 16)) phase=\(phase)")
        inputQueue.async { [self] in
            switch phase {
            case "down": sendHIDUsage(page: page, usage: usage, direction: HIDUsage.down)
            case "up":   sendHIDUsage(page: page, usage: usage, direction: HIDUsage.up)
            default:     pressHIDUsage(page: page, usage: usage)
            }
        }
    }

    func sendButton(button: String, deviceUDID: String) {
        print("[hid] Sending button: \(button)")

        // `swipe_home` is a touch gesture, not a button, so it bypasses the HID
        // usage table entirely.
        if button == "swipe_home" {
            inputQueue.async { [self] in sendSwipeHome() }
            return
        }

        // Preferred path for every real hardware button: a consumer-page HID
        // usage on the digitizer target (see HIDUsage). Siri only registers on a
        // hold, and the app switcher is a double home press.
        if let usage = HIDUsage.consumerUsage(forButton: button) {
            let hold: TimeInterval = button == "siri" ? 0.3 : 0
            inputQueue.async { [self] in
                if pressHIDUsage(page: HIDUsage.consumerPage, usage: usage, hold: hold) { return }
                sendLegacyButton(button, deviceUDID: deviceUDID)
            }
            return
        }

        if button == "app_switcher" {
            inputQueue.async { [self] in
                if pressHIDUsage(page: HIDUsage.consumerPage, usage: HIDUsage.menu) {
                    Thread.sleep(forTimeInterval: 0.15)
                    _ = pressHIDUsage(page: HIDUsage.consumerPage, usage: HIDUsage.menu)
                    return
                }
                sendLegacyButton(button, deviceUDID: deviceUDID)
            }
            return
        }

        print("[hid] Unknown button: \(button)")
    }

    /// Pre-arbitrary-HID fallback, for toolchains where
    /// `IndigoHIDMessageForHIDArbitrary` isn't exported. Runs on `buttonQueue`.
    private func sendLegacyButton(_ button: String, deviceUDID: String) {
        switch button {
        case "home":
            if buttonFunc != nil {
                sendHIDButton(eventSource: Self.buttonSourceHome, direction: Self.buttonDown)
                sendHIDButton(eventSource: Self.buttonSourceHome, direction: Self.buttonUp)
            } else {
                launchSpringBoard(deviceUDID: deviceUDID)
            }

        case "app_switcher":
            guard buttonFunc != nil else {
                print("[hid] App switcher not available (IndigoHIDMessageForButton not loaded)")
                return
            }
            sendHIDButton(eventSource: Self.buttonSourceHome, direction: Self.buttonDown)
            sendHIDButton(eventSource: Self.buttonSourceHome, direction: Self.buttonUp)
            Thread.sleep(forTimeInterval: 0.15)
            sendHIDButton(eventSource: Self.buttonSourceHome, direction: Self.buttonDown)
            sendHIDButton(eventSource: Self.buttonSourceHome, direction: Self.buttonUp)

        case "lock":
            sendHIDButton(eventSource: Self.buttonSourceLock, direction: Self.buttonDown)
            sendHIDButton(eventSource: Self.buttonSourceLock, direction: Self.buttonUp)

        case "siri":
            // Holding Siri for ~300ms matches Simulator.app's "hold side button
            // to invoke Siri" gesture; a tap is ignored.
            sendHIDButton(eventSource: Self.buttonSourceSiri, direction: Self.buttonDown)
            Thread.sleep(forTimeInterval: 0.3)
            sendHIDButton(eventSource: Self.buttonSourceSiri, direction: Self.buttonUp)

        case "side_button":
            sendHIDButton(eventSource: Self.buttonSourceSideButton, direction: Self.buttonDown)
            sendHIDButton(eventSource: Self.buttonSourceSideButton, direction: Self.buttonUp)

        default:
            print("[hid] Unknown button: \(button)")
        }
    }


    // MARK: - SimDevice private control

    /// Toggle a CoreAnimation render debug flag on the simulator. Names are the
    /// strings Simulator.app's Debug menu passes to `-[SimDevice
    /// setCADebugOption:enabled:]` (CoreSimulator private category):
    ///   debug_color_blended / debug_color_copies / debug_color_misaligned
    ///   debug_color_offscreen / debug_slow_animations
    func setCADebugOption(name: String, enabled: Bool) -> Bool {
        guard let device = simDevice else {
            fputs("[sim] setCADebugOption: no SimDevice\n", stderr)
            return false
        }
        let sel = NSSelectorFromString("setCADebugOption:enabled:")
        guard device.responds(to: sel) else {
            fputs("[sim] setCADebugOption: selector not available on SimDevice\n", stderr)
            return false
        }
        typealias Fn = @convention(c) (AnyObject, Selector, NSString, ObjCBool) -> ObjCBool
        let imp = device.method(for: sel)
        let fn = unsafeBitCast(imp, to: Fn.self)
        let result = fn(device, sel, name as NSString, ObjCBool(enabled))
        print("[sim] setCADebugOption(\(name), \(enabled)) → \(result.boolValue)")
        return result.boolValue
    }

    /// Ask CoreSimulator to broadcast a memory warning to the simulated OS.
    /// Equivalent to Debug → Simulate Memory Warning and idb's
    /// FBSimulatorMemoryCommands.simulateMemoryWarning.
    func simulateMemoryWarning() {
        guard let device = simDevice else {
            fputs("[sim] simulateMemoryWarning: no SimDevice\n", stderr)
            return
        }
        let sel = NSSelectorFromString("simulateMemoryWarning")
        guard device.responds(to: sel) else {
            fputs("[sim] simulateMemoryWarning: selector not available on SimDevice\n", stderr)
            return
        }
        _ = device.perform(sel)
        print("[sim] simulateMemoryWarning dispatched")
    }

    /// Synthesize a swipe-up-from-bottom gesture (Face ID "go home" gesture).
    /// Uses IndigoHIDEdge.bottom to flag touches as system edge gestures,
    /// which iOS interprets as the home indicator swipe.
    private func sendSwipeHome() {
        let xPos = 0.5
        let yStart = 0.95
        let yEnd = 0.35
        let steps = 10
        let stepDelay: TimeInterval = 0.016  // ~16ms per step
        let edge = Self.edgeBottom

        // Touch down at bottom edge
        sendTouch(type: "begin", x: xPos, y: yStart, screenWidth: 0, screenHeight: 0, edge: edge)
        Thread.sleep(forTimeInterval: stepDelay)

        // Interpolated moves upward
        for i in 1...steps {
            let t = Double(i) / Double(steps)
            let y = yStart + (yEnd - yStart) * t
            sendTouch(type: "move", x: xPos, y: y, screenWidth: 0, screenHeight: 0, edge: edge)
            Thread.sleep(forTimeInterval: stepDelay)
        }

        // Touch up
        sendTouch(type: "end", x: xPos, y: yEnd, screenWidth: 0, screenHeight: 0, edge: edge)
    }

    private func launchSpringBoard(deviceUDID: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = ["simctl", "launch", deviceUDID, "com.apple.springboard"]
        try? process.run()
    }

    // MARK: - Orientation (GSEvent via PurpleWorkspacePort)

    // UIDeviceOrientation values accepted by the guest's GraphicsServices.
    static let orientationPortrait: UInt32 = 1
    static let orientationPortraitUpsideDown: UInt32 = 2
    static let orientationLandscapeRight: UInt32 = 3
    static let orientationLandscapeLeft: UInt32 = 4

    // GSEvent wire-format constants. Reverse-engineered by idb from
    // Simulator.app's ARM64 disassembly; see idb's SimulatorApp/GSEvent.h.
    private static let gsEventTypeDeviceOrientationChanged: UInt32 = 50
    private static let gsEventHostFlag: UInt32 = 0x20000
    private static let gsEventMachMessageID: mach_msg_id_t = 0x7B

    /// Send a device-orientation GSEvent to the simulator.
    ///
    /// GSEvent messages travel a different path from Indigo HID: they go
    /// through `mach_msg_send` → `PurpleWorkspacePort` →
    /// `GraphicsServices._PurpleEventCallback` → backboardd. This is how
    /// Simulator.app itself rotates the device, and how idb's
    /// `FBSimulatorPurpleHID.orientationEvent:` is delivered.
    func sendOrientation(orientation: UInt32) -> Bool {
        guard let device = simDevice else {
            fputs("[hid] sendOrientation: no SimDevice (setup not called?)\n", stderr)
            return false
        }

        let lookupSel = NSSelectorFromString("lookup:error:")
        typealias LookupFunc = @convention(c) (
            AnyObject, Selector, NSString, AutoreleasingUnsafeMutablePointer<NSError?>
        ) -> mach_port_t
        guard let lookupIMP = class_getMethodImplementation(object_getClass(device)!, lookupSel) else {
            fputs("[hid] sendOrientation: -[SimDevice lookup:error:] not found\n", stderr)
            return false
        }
        let lookup = unsafeBitCast(lookupIMP, to: LookupFunc.self)

        var lookupError: NSError?
        let purplePort = lookup(device, lookupSel, "PurpleWorkspacePort" as NSString, &lookupError)
        if purplePort == 0 {
            fputs("[hid] sendOrientation: PurpleWorkspacePort not found (\(lookupError?.localizedDescription ?? "no error")); device may not be fully booted.\n", stderr)
            return false
        }

        // 112-byte aligned buffer (>= 108 = align4(4 + 0x6B), the msgh_size
        // for a GSEvent with a 4-byte orientation payload).
        var buf = [UInt8](repeating: 0, count: 112)
        return buf.withUnsafeMutableBufferPointer { ptr in
            let base = UnsafeMutableRawPointer(ptr.baseAddress!)
            let header = base.assumingMemoryBound(to: mach_msg_header_t.self)
            header.pointee.msgh_bits = mach_msg_bits_t(MACH_MSG_TYPE_COPY_SEND)
            header.pointee.msgh_size = 108
            header.pointee.msgh_remote_port = purplePort
            header.pointee.msgh_local_port = mach_port_t(MACH_PORT_NULL)
            header.pointee.msgh_voucher_port = mach_port_t(MACH_PORT_NULL)
            header.pointee.msgh_id = Self.gsEventMachMessageID

            // GSEvent type at offset 0x18 — record_info_size at 0x48 — payload at 0x4C.
            base.storeBytes(
                of: Self.gsEventTypeDeviceOrientationChanged | Self.gsEventHostFlag,
                toByteOffset: 0x18, as: UInt32.self)
            base.storeBytes(of: UInt32(4), toByteOffset: 0x48, as: UInt32.self)
            base.storeBytes(of: orientation, toByteOffset: 0x4C, as: UInt32.self)

            let kr = mach_msg_send(header)
            if kr != KERN_SUCCESS {
                fputs("[hid] sendOrientation: mach_msg_send failed (\(kr))\n", stderr)
                return false
            } else {
                print("[hid] Orientation set to \(orientation)")
                return true
            }
        }
    }
}
