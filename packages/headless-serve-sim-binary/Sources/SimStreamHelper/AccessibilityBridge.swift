import Foundation
import AppKit
import Darwin
import ObjectiveC.runtime

// Accessibility tree fetcher for booted iOS Simulators.
//
// Ported from idb's FBSimulatorAccessibilityCommands.m (MIT, Meta Platforms).
// idb's implementation drives the private AccessibilityPlatformTranslation
// framework (AXPTranslator + AXPMacPlatformElement) and bridges its
// synchronous delegate callbacks onto CoreSimulator's asynchronous
// -[SimDevice sendAccessibilityRequestAsync:completionQueue:completionHandler:].
//
// We mirror that bridge in Swift using runtime introspection only — matching
// the rest of this helper's pattern (HIDInjector / FrameCapture). No private
// headers are imported; the framework is dlopen'd at startup and every type
// crosses the bridge as `NSObject` / `AnyObject`.
//
// Output JSON shape matches `axe describe-ui` so the existing Node-side
// normalizer in src/ax.ts works without changes:
//   { AXLabel, AXValue, AXUniqueId, enabled, frame:{x,y,width,height},
//     role_description, type, children: [...] }

enum AccessibilityError: Error, LocalizedError {
    case frameworkUnavailable
    case translatorUnavailable
    case noFrontmostApplication
    case timeout

    var errorDescription: String? {
        switch self {
        case .frameworkUnavailable:
            return "AccessibilityPlatformTranslation framework not loadable"
        case .translatorUnavailable:
            return "AXPTranslator class not found at runtime"
        case .noFrontmostApplication:
            return "No frontmost application returned for simulator"
        case .timeout:
            return "Timed out waiting for accessibility response"
        }
    }
}

/// Optional wall-clock limit on one describeUI walk. Once passed it stays
/// `hit`, so the walk unwinds and the partial tree is marked truncated.
struct AXDeadline {
    let at: DispatchTime?
    private(set) var hit = false

    mutating func passed() -> Bool {
        if !hit, let at, DispatchTime.now() >= at { hit = true }
        return hit
    }
}

/// Singleton bridging private AXPTranslator delegation onto SimDevice's
/// async accessibility XPC. The translator is process-global so we map
/// per-request tokens → SimDevice instances, and route every callback
/// through the matching device.
final class AccessibilityBridge: NSObject {
    static let shared = AccessibilityBridge()
    private static let maxSerializedElements = 500
    private static let maxSerializationDepth = 80

    private let queue = DispatchQueue(label: "headless-serve-sim.ax.bridge", qos: .userInitiated)
    private let lock = NSLock()
    private var tokenToDevice: [String: NSObject] = [:]
    private var translator: NSObject?
    private var loaded = false
    /// Where each window/widget context last sat on screen (interface points).
    private var contextOffsets: [UInt32: CGPoint] = [:]
    private var springBoardPids: [Int32: Bool] = [:]

    private override init() { super.init() }

    /// Load the framework, grab the translator singleton, and install
    /// `self` as the tokenized bridge delegate. Idempotent.
    private func ensureLoaded() throws {
        lock.lock(); defer { lock.unlock() }
        if loaded { return }

        if dlopen("/System/Library/PrivateFrameworks/AccessibilityPlatformTranslation.framework/AccessibilityPlatformTranslation", RTLD_NOW) == nil {
            throw AccessibilityError.frameworkUnavailable
        }

        guard let translatorClass = NSClassFromString("AXPTranslator") as? NSObject.Type else {
            throw AccessibilityError.translatorUnavailable
        }
        let sharedSel = NSSelectorFromString("sharedInstance")
        guard let t = translatorClass.perform(sharedSel)?.takeUnretainedValue() as? NSObject else {
            throw AccessibilityError.translatorUnavailable
        }

        // Tokenized delegation: a single global translator can route
        // concurrent requests across devices by tagging each request with
        // a token. Setting bridgeTokenDelegate without setting the
        // non-tokenized bridgeDelegate is what idb does.
        t.setValue(self, forKey: "bridgeTokenDelegate")
        t.setValue(true, forKey: "supportsDelegateTokens")
        t.setValue(true, forKey: "accessibilityEnabled")

        translator = t
        loaded = true
    }

    /// Capture the simulator's accessibility tree and return JSON bytes
    /// matching the `axe describe-ui` flat-array output. Throws on
    /// framework load failure or if the simulator returns no frontmost
    /// application (e.g. SpringBoard hasn't come up yet). With a `timeout`
    /// the walk stops at the deadline and the root gains `"truncated": true`;
    /// `gridPass: false` skips hit-test discovery entirely.
    func describeUI(udid: String, displayID: UInt32 = 0, interfaceOrientation: String? = nil,
                    displayPixels: CGSize? = nil,
                    timeout: TimeInterval? = nil, gridPass: Bool = true) throws -> Data {
        var deadline = AXDeadline(at: timeout.map { .now() + $0 })
        try ensureLoaded()

        guard let device = FrameCapture.findSimDevice(udid: udid) else {
            throw NSError(domain: "Accessibility", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Device \(udid) not found"])
        }
        guard device.responds(to: NSSelectorFromString("sendAccessibilityRequestAsync:completionQueue:completionHandler:")) else {
            throw NSError(domain: "Accessibility", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "SimDevice lacks sendAccessibilityRequestAsync — install Xcode 12+",
            ])
        }
        guard let translator = translator else {
            throw AccessibilityError.translatorUnavailable
        }

        let token = UUID().uuidString
        registerToken(token, device: device)
        defer { unregisterToken(token) }

        // Ask the translator for the frontmost application's translation
        // object. This blocks while AXPTranslator pumps its delegate
        // callbacks (which we route to the SimDevice).
        let frontmostSel = NSSelectorFromString("frontmostApplicationWithDisplayId:bridgeDelegateToken:")
        typealias FrontmostFunc = @convention(c) (AnyObject, Selector, UInt32, NSString) -> AnyObject?
        guard let frontmostIMP = translator.method(for: frontmostSel) else {
            throw AccessibilityError.translatorUnavailable
        }
        let frontmost = unsafeBitCast(frontmostIMP, to: FrontmostFunc.self)
        guard let translation = frontmost(translator, frontmostSel, displayID, token as NSString) as? NSObject else {
            throw AccessibilityError.noFrontmostApplication
        }
        translation.setValue(token, forKey: "bridgeDelegateToken")

        // Convert the translation object to a real AXPMacPlatformElement —
        // an NSAccessibilityElement subclass whose accessibility properties
        // lazily fault in via more delegate callbacks.
        let macElementSel = NSSelectorFromString("macPlatformElementFromTranslation:")
        typealias MacElementFunc = @convention(c) (AnyObject, Selector, AnyObject) -> AnyObject?
        guard let macIMP = translator.method(for: macElementSel) else {
            throw AccessibilityError.translatorUnavailable
        }
        let toMacElement = unsafeBitCast(macIMP, to: MacElementFunc.self)
        guard let rootElement = toMacElement(translator, macElementSel, translation) as? NSObject else {
            throw AccessibilityError.noFrontmostApplication
        }
        if let rootTranslation = rootElement.value(forKey: "translation") as? NSObject {
            rootTranslation.setValue(token, forKey: "bridgeDelegateToken")
        }

        // Frames come in two spaces: SpringBoard's fixed portrait screen and
        // each other process's own context. Publish them all on the interface
        // screen; hit-testing (and so coverage) works on the fixed screen.
        let rootFrame = (rootElement as? NSAccessibilityElement)?.accessibilityFrame() ?? .zero
        let landscape = interfaceOrientation?.hasPrefix("landscape") == true
        let scale = (device.value(forKey: "deviceType") as? NSObject)
            .flatMap { ($0.value(forKey: "mainScreenScale") as? NSNumber)?.doubleValue }.flatMap { $0 > 0 ? CGFloat($0) : nil }
        let fixedScreen: CGSize
        if let displayPixels, let scale {
            fixedScreen = CGSize(width: displayPixels.width / scale, height: displayPixels.height / scale)
        } else {
            let app = AXInterfaceFrame.normalize(rootFrame, interfaceOrientation: interfaceOrientation, screen: nil)
            fixedScreen = landscape ? CGSize(width: app.height, height: app.width) : app.size
        }
        let interfaceScreen = landscape ? CGSize(width: fixedScreen.height, height: fixedScreen.width) : fixedScreen
        let appFrame = AXInterfaceFrame.normalize(rootFrame, interfaceOrientation: interfaceOrientation, screen: interfaceScreen)
        let placement = AXPlacement(
            fixedScreen: fixedScreen, interfaceOrientation: interfaceOrientation, scale: scale ?? 2,
            hitTest: { [unowned self] in self.hitTest($0, displayID: displayID, token: token) },
            isSpringBoard: { [unowned self] in self.isSpringBoard(pid: $0) },
            cachedOffset: { [unowned self] context in
                self.lock.lock(); defer { self.lock.unlock() }
                return self.contextOffsets[context]
            },
            storeOffset: { [unowned self] context, offset in
                self.lock.lock(); defer { self.lock.unlock() }
                if self.contextOffsets.count > 64 { self.contextOffsets.removeAll() }
                self.contextOffsets[context] = offset
            })
        let rootPid = AXPlacement.pid(of: rootElement)
        let (rootSpace, window) = placement.rootSpace(element: rootElement, pid: rootPid, appFrame: appFrame)

        // 1. Recursive walk from the application element, collecting the
        //    frames we've covered. This catches everything iOS exposes via
        //    standard accessibility-children traversal.
        var coverage = AccessibilityCoverage()
        var visited = Set<ObjectIdentifier>()
        var remainingElements = Self.maxSerializedElements
        guard var root = serialize(
            element: rootElement,
            token: token,
            coverage: &coverage,
            visited: &visited,
            remainingElements: &remainingElements,
            deadline: &deadline,
            depth: 0,
            placement: placement,
            space: rootSpace,
            parentPid: rootPid,
            parentFrame: nil
        ) else {
            throw AccessibilityError.noFrontmostApplication
        }
        // The root stands for the whole screen; a windowed app's own window
        // shows up as its full-window group.
        let screenFrame = NSRect(origin: .zero, size: placement.interfaceScreen)
        root["frame"] = ["x": screenFrame.origin.x, "y": screenFrame.origin.y,
                         "width": screenFrame.size.width, "height": screenFrame.size.height]

        // 2. Grid hit-test discovery: many iOS containers (UIScrollView,
        //    UICollectionView, custom group elements) hide their AX
        //    children from the recursive walk. We sample points across the
        //    screen (or just the app's window) and ask the translator what's
        //    under each — anything that's still a real accessibility element
        //    shows up here. Same technique as idb's processRemoteContent path.
        let gridBounds = window ?? screenFrame
        if gridPass, gridBounds.width > 1, gridBounds.height > 1 {
            var children = (root["children"] as? [[String: Any]]) ?? []
            let discovered = discoverByGrid(
                placement: placement,
                bounds: gridBounds,
                coverage: &coverage,
                visited: &visited,
                remainingElements: &remainingElements,
                deadline: &deadline,
                token: token,
                appSpace: rootSpace
            )
            children.append(contentsOf: discovered)
            root["children"] = children
        }
        if deadline.hit { root["truncated"] = true }

        let json: [Any] = [root]
        return try JSONSerialization.data(withJSONObject: json)
    }

    /// Cheap point-query for the frontmost app on a simulator: returns
    /// `{bundleId, pid}` without walking the AX tree. Used to bootstrap
    /// `/appstate` SSE clients (the SpringBoard log stream is edge-triggered
    /// so a fresh subscriber sees nothing until the user re-foregrounds an
    /// app). Throws when SpringBoard hasn't surfaced an app yet.
    func frontmostApp(udid: String, displayID: UInt32 = 0) throws -> [String: Any] {
        try ensureLoaded()

        guard let device = FrameCapture.findSimDevice(udid: udid) else {
            throw NSError(domain: "Accessibility", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Device \(udid) not found"])
        }
        guard let translator = translator else {
            throw AccessibilityError.translatorUnavailable
        }

        let token = UUID().uuidString
        registerToken(token, device: device)
        defer { unregisterToken(token) }

        let frontmostSel = NSSelectorFromString("frontmostApplicationWithDisplayId:bridgeDelegateToken:")
        typealias FrontmostFunc = @convention(c) (AnyObject, Selector, UInt32, NSString) -> AnyObject?
        guard let frontmostIMP = translator.method(for: frontmostSel) else {
            throw AccessibilityError.translatorUnavailable
        }
        let frontmost = unsafeBitCast(frontmostIMP, to: FrontmostFunc.self)
        guard let translation = frontmost(translator, frontmostSel, displayID, token as NSString) as? NSObject else {
            throw AccessibilityError.noFrontmostApplication
        }
        translation.setValue(token, forKey: "bridgeDelegateToken")

        let (bundleId, pid) = Self.identity(of: translation)
        guard let bundleId else { throw AccessibilityError.noFrontmostApplication }
        var result: [String: Any] = ["bundleId": bundleId]
        if pid > 0 { result["pid"] = Int(pid) }
        return result
    }

    /// The bundle id and pid behind a frontmost-application translation.
    private static func identity(of translation: NSObject) -> (bundleId: String?, pid: Int32) {
        // AXPTranslationObject's accessors vary across simulator runtimes
        // and throw NSUnknownKeyException for undefined keys, so probe via
        // -respondsToSelector: before each KVC fetch.
        func safeValue<T>(_ key: String, as: T.Type) -> T? {
            guard translation.responds(to: NSSelectorFromString(key)) else { return nil }
            return translation.value(forKey: key) as? T
        }

        var pid: Int32 = 0
        for key in ["pid", "processIdentifier", "processID"] {
            if let n = safeValue(key, as: NSNumber.self) {
                pid = n.int32Value
                if pid > 0 { break }
            }
        }

        // Bundle identifier sometimes ships as a property on the translation
        // (newer simulator runtimes) — try first, then fall back to walking
        // the executable path up to the surrounding `.app/Info.plist`.
        var bundleId: String? = nil
        for key in ["bundleIdentifier", "processBundleIdentifier", "applicationIdentifier"] {
            if let s = safeValue(key, as: String.self), !s.isEmpty {
                bundleId = s
                break
            }
        }
        if bundleId == nil, pid > 0 {
            bundleId = Self.bundleIdForPid(pid)
        }
        return (bundleId, pid)
    }

    /// Resolve a pid to its bundle identifier by reading
    /// `<executable>.app/Info.plist`. Works for simulator app processes
    /// because `proc_pidpath` returns the host-side path to the
    /// `MyApp.app/MyApp` binary inside the simulator's runtime container.
    private static func bundleIdForPid(_ pid: Int32) -> String? {
        // PROC_PIDPATHINFO_MAXSIZE = 4 * MAXPATHLEN (4096) — not exported to
        // Swift in some SDKs, so size the buffer explicitly.
        var buffer = [CChar](repeating: 0, count: 4 * 1024)
        let len = proc_pidpath(pid, &buffer, UInt32(buffer.count))
        guard len > 0 else { return nil }
        let path = String(cString: buffer)
        var url = URL(fileURLWithPath: path)
        // Walk up until we find the enclosing `.app` bundle. SpringBoard
        // and most user apps land inside one within a few components.
        for _ in 0..<8 {
            url.deleteLastPathComponent()
            if url.pathExtension == "app" {
                let plist = url.appendingPathComponent("Info.plist")
                if let data = try? Data(contentsOf: plist),
                   let obj = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
                   let bundleId = obj["CFBundleIdentifier"] as? String,
                   !bundleId.isEmpty {
                    return bundleId
                }
                return nil
            }
            if url.path == "/" { break }
        }
        return nil
    }

    /// Sample a grid of screen points and ask the translator for the
    /// element at each. Dedupes by frame against `coverage` and skips
    /// points whose enclosing rect we've already cataloged — that lets
    /// the cost scale with the number of *unique* elements rather than
    /// the grid size. Caller owns the token. `bounds` is in interface
    /// points; probes and coverage are on the fixed screen. Hits that can't
    /// be placed on their own share the frontmost app's `appSpace`.
    private func discoverByGrid(
        placement: AXPlacement,
        bounds: CGRect,
        coverage: inout AccessibilityCoverage,
        visited: inout Set<ObjectIdentifier>,
        remainingElements: inout Int,
        deadline: inout AXDeadline,
        token: String,
        appSpace: AXPlacement.Space
    ) -> [[String: Any]] {
        let fixedBounds = placement.fixed(bounds)
        var pointBudget = 600  // safety cap for misbehaving sims
        // 32pt apart, wider where that many points couldn't cover the bounds.
        let step = max(32, (fixedBounds.width * fixedBounds.height / CGFloat(pointBudget)).squareRoot().rounded(.up))
        var discovered: [[String: Any]] = []

        var y = fixedBounds.minY + step / 2
        while y < fixedBounds.maxY, pointBudget > 0, remainingElements > 0, !deadline.passed() {
            var x = fixedBounds.minX + step / 2
            while x < fixedBounds.maxX, pointBudget > 0, remainingElements > 0, !deadline.passed() {
                let point = CGPoint(x: x, y: y)
                x += step

                // Skip points already enclosed by a known element — this
                // is the load-bearing optimization. Once a card's text
                // element is cataloged, every other grid point that falls
                // inside the same text frame avoids an XPC round-trip.
                if coverage.contains(point) { continue }
                pointBudget -= 1

                let shownPoint = placement.interface(point)
                guard let element = placement.element(at: shownPoint) else { continue }
                // Hits on an element we walked (often the screen-wide
                // background) need nothing more.
                if visited.contains(ObjectIdentifier(element)) { continue }
                if let key = AXPlacement.key(of: element), placement.walked.contains(key) { continue }
                guard let pid = AXPlacement.pid(of: element) else { continue }
                let raw = (element as? NSAccessibilityElement)?.accessibilityFrame() ?? .zero
                let space = placement.space(pid: pid, element: element, raw: raw,
                                            seed: shownPoint, guess: nil) ?? appSpace
                let frame = placement.fixed(placement.interface(raw, in: space))
                if coverage.contains(frame) {
                    if let key = AXPlacement.key(of: element) { placement.walked.insert(key) }
                    continue
                }
                // The Application/window itself is too coarse to be
                // useful — skip when the hit returns the screen.
                if abs(frame.width - fixedBounds.width) < 1,
                   abs(frame.height - fixedBounds.height) < 1 {
                    coverage.insertContainer(frame)
                    if let key = AXPlacement.key(of: element) { placement.walked.insert(key) }
                    continue
                }
                if let serialized = serialize(
                    element: element,
                    token: token,
                    coverage: &coverage,
                    visited: &visited,
                    remainingElements: &remainingElements,
                    deadline: &deadline,
                    depth: 0,
                    placement: placement,
                    space: space,
                    parentPid: pid,
                    parentFrame: nil
                ) {
                    discovered.append(serialized)
                }
            }
            y += step
        }
        return discovered
    }

    /// The element under a fixed-screen point, stamped with the token.
    private func hitTest(_ point: CGPoint, displayID: UInt32, token: String) -> NSObject? {
        guard let translator else { return nil }
        let pointSel = NSSelectorFromString("objectAtPoint:displayId:bridgeDelegateToken:")
        typealias PointFunc = @convention(c) (AnyObject, Selector, CGPoint, UInt32, NSString) -> AnyObject?
        let macSel = NSSelectorFromString("macPlatformElementFromTranslation:")
        typealias MacFunc = @convention(c) (AnyObject, Selector, AnyObject) -> AnyObject?
        guard let pointIMP = translator.method(for: pointSel), let macIMP = translator.method(for: macSel) else { return nil }
        let objectAtPoint = unsafeBitCast(pointIMP, to: PointFunc.self)
        let toMacElement = unsafeBitCast(macIMP, to: MacFunc.self)
        guard let translation = objectAtPoint(translator, pointSel, point, displayID, token as NSString) as? NSObject else {
            return nil
        }
        translation.setValue(token, forKey: "bridgeDelegateToken")
        guard let element = toMacElement(translator, macSel, translation) as? NSObject else { return nil }
        if let t = element.value(forKey: "translation") as? NSObject {
            t.setValue(token, forKey: "bridgeDelegateToken")
        }
        return element
    }

    private func isSpringBoard(pid: Int32) -> Bool {
        lock.lock()
        if let known = springBoardPids[pid] { lock.unlock(); return known }
        lock.unlock()
        let known = Self.bundleIdForPid(pid) == "com.apple.springboard"
        lock.lock(); springBoardPids[pid] = known; lock.unlock()
        return known
    }

    // MARK: - Token registry

    private func registerToken(_ token: String, device: NSObject) {
        lock.lock(); defer { lock.unlock() }
        tokenToDevice[token] = device
    }

    private func unregisterToken(_ token: String) {
        lock.lock(); defer { lock.unlock() }
        tokenToDevice.removeValue(forKey: token)
    }

    private func device(for token: String) -> NSObject? {
        lock.lock(); defer { lock.unlock() }
        return tokenToDevice[token]
    }

    // MARK: - Serialization

    // axe's JSON keys, mirroring idb's FBAXKeys constants.
    private static let axPrefix = "AX"

    private func serialize(
        element: NSObject,
        token: String,
        coverage: inout AccessibilityCoverage,
        visited: inout Set<ObjectIdentifier>,
        remainingElements: inout Int,
        deadline: inout AXDeadline,
        depth: Int,
        placement: AXPlacement,
        space parentSpace: AXPlacement.Space,
        parentPid: Int32?,
        parentFrame: NSRect?
    ) -> [String: Any]? {
        guard remainingElements > 0, depth <= Self.maxSerializationDepth, !deadline.passed() else {
            return nil
        }
        guard visited.insert(ObjectIdentifier(element)).inserted else {
            return nil
        }
        remainingElements -= 1

        // Token must be re-stamped on every element walked because the
        // framework creates fresh translation objects lazily as we touch
        // child collections.
        if let translation = element.value(forKey: "translation") as? NSObject {
            translation.setValue(token, forKey: "bridgeDelegateToken")
        }

        var dict: [String: Any] = [:]

        // Frame — fetched once and emitted as a {x,y,w,h} dict to match
        // axe's output (idb's FBAXKeysFrameDict shape).
        var frame = NSRect.zero
        if let element = element as? NSAccessibilityElement {
            frame = element.accessibilityFrame()
        } else {
            // Fall back to KVC if AppKit's bridged accessor isn't available.
            if let value = element.value(forKey: "accessibilityFrame") as? NSValue {
                frame = value.rectValue
            }
        }
        // Content from another process (a remote view, a widget body) sits
        // in its own space.
        let pid = AXPlacement.pid(of: element) ?? parentPid
        var space = parentSpace
        if pid != parentPid, let pid {
            space = placement.space(pid: pid, element: element, raw: frame, seed: nil,
                                    guess: parentFrame?.origin) ?? parentSpace
        }
        let shown = placement.interface(frame, in: space)
        dict["frame"] = [
            "x": shown.origin.x,
            "y": shown.origin.y,
            "width": shown.size.width,
            "height": shown.size.height,
        ]

        // Role → "type" with the AX prefix stripped, matching SimulatorBridge.
        let rawRole = stringValue(element, key: "accessibilityRole")
        let role: String
        if let r = rawRole, r.hasPrefix(Self.axPrefix) {
            role = String(r.dropFirst(Self.axPrefix.count))
        } else {
            role = rawRole ?? ""
        }
        dict["type"] = role

        dict["AXLabel"] = stringValue(element, key: "accessibilityLabel") ?? NSNull()
        dict["AXValue"] = stringValue(element, key: "accessibilityValue") ?? NSNull()
        dict["AXUniqueId"] = stringValue(element, key: "accessibilityIdentifier") ?? NSNull()
        dict["role_description"] = stringValue(element, key: "accessibilityRoleDescription") ?? ""
        dict["enabled"] = boolValue(element, key: "accessibilityEnabled") ?? true

        // Children — NSAccessibilityElement exposes accessibilityChildren()
        // returning [Any]?. Each child's translation needs the same token.
        var childDicts: [[String: Any]] = []
        let children: [Any]?
        if let element = element as? NSAccessibilityElement {
            children = element.accessibilityChildren()
        } else {
            children = element.value(forKey: "accessibilityChildren") as? [Any]
        }
        if let children {
            for child in children {
                guard remainingElements > 0, !deadline.hit else { break }
                guard let childObj = child as? NSObject else { continue }
                if let childDict = serialize(
                    element: childObj,
                    token: token,
                    coverage: &coverage,
                    visited: &visited,
                    remainingElements: &remainingElements,
                    deadline: &deadline,
                    depth: depth + 1,
                    placement: placement,
                    space: space,
                    parentPid: pid,
                    parentFrame: shown
                ) {
                    childDicts.append(childDict)
                }
            }
        }

        // Record this element. Only true leaves block the grid — anything
        // that looks like a container (had walked children, or is just
        // physically too large to be a single tappable element) stays
        // probe-able so we can discover "remote" elements iOS hid under
        // empty-children Groups (Nav bar / Tab Bar / scroll views).
        placement.note(shown, in: space)
        if let key = AXPlacement.key(of: element) { placement.walked.insert(key) }
        let covered = placement.fixed(shown)
        if !childDicts.isEmpty || isLikelyContainer(frame: covered) {
            coverage.insertContainer(covered)
        } else {
            coverage.insertLeaf(covered)
        }
        dict["children"] = childDicts

        return dict
    }

    private func stringValue(_ obj: NSObject, key: String) -> String? {
        // KVC works for these because NSAccessibilityElement exposes them
        // as @objc properties; the underlying AXPMacPlatformElement faults
        // them in lazily via the delegate bridge.
        let value = obj.value(forKey: key)
        if let s = value as? String { return s.isEmpty ? nil : s }
        if let s = (value as? NSAttributedString)?.string { return s.isEmpty ? nil : s }
        if value == nil { return nil }
        return String(describing: value!)
    }

    private func boolValue(_ obj: NSObject, key: String) -> Bool? {
        if let n = obj.value(forKey: key) as? NSNumber { return n.boolValue }
        return nil
    }

    /// Heuristic: anything with a dimension >= 250pt is too big to be a
    /// single tappable element, so we treat it as a container even when
    /// it reports no AX children. Picks up the iOS pattern where a Group
    /// (Nav bar, Tab Bar, scroll views) hides its content from the
    /// recursive walk but exposes it to hit-testing.
    private func isLikelyContainer(frame: NSRect) -> Bool {
        return max(frame.width, frame.height) >= 250
    }

    // MARK: - AXPTranslationTokenDelegateHelper

    // The translator calls these on us — selectors must match exactly.
    // The returned block synchronously satisfies one accessibility
    // attribute fetch by hopping to CoreSimulator's async XPC and
    // dispatch_group_wait()-ing on the response. AXPTranslator drives
    // this hot during element walks (every frame/label/role read on a
    // child triggers one call).
    @objc(accessibilityTranslationDelegateBridgeCallbackWithToken:)
    func bridgeCallback(token: String) -> AnyObject {
        let capturedToken = token
        let block: @convention(block) (AnyObject?) -> AnyObject? = { [weak self] axRequest in
            guard let self, let request = axRequest,
                  let device = self.device(for: capturedToken) else {
                return Self.emptyTranslatorResponse()
            }
            return self.runRequest(request, on: device)
        }
        return block as AnyObject
    }

    /// Hop one accessibility XPC request → response. Synchronous: AXPTranslator
    /// drives this from inside its lazy property accessors, so we must block
    /// until CoreSimulator's async callback fires (or the timeout trips).
    private func runRequest(_ request: AnyObject, on device: NSObject) -> AnyObject? {
        let sel = NSSelectorFromString("sendAccessibilityRequestAsync:completionQueue:completionHandler:")
        guard let imp = device.method(for: sel) else {
            return Self.emptyTranslatorResponse()
        }

        let semaphore = DispatchSemaphore(value: 0)
        // Heap box for the response so the completion block assigns
        // through a real reference rather than capturing an inout slot.
        final class Box { var value: AnyObject? }
        let box = Box()

        // Declare the completion handler as an explicit block constant
        // and pass it through the IMP typed as `id` (AnyObject). Inlining
        // it against a @convention(c) function type whose last param is
        // @convention(block) trips Swift's "@noescape closure escaped"
        // runtime check at -O.
        let completion: @convention(block) (AnyObject?) -> Void = { resp in
            box.value = resp
            semaphore.signal()
        }

        typealias SendFunc = @convention(c) (
            AnyObject, Selector, AnyObject, DispatchQueue, AnyObject
        ) -> Void
        let send = unsafeBitCast(imp, to: SendFunc.self)
        send(device, sel, request, queue, completion as AnyObject)

        if semaphore.wait(timeout: .now() + 5.0) == .timedOut {
            return Self.emptyTranslatorResponse()
        }
        return box.value ?? Self.emptyTranslatorResponse()
    }

    @objc(accessibilityTranslationConvertPlatformFrameToSystem:withToken:)
    func convertFrame(rect: NSRect, withToken token: String) -> NSRect {
        // Simulator content already arrives in screen-relative coordinates
        // for our use case; pass through (mirrors idb's no-op).
        return rect
    }

    @objc(accessibilityTranslationRootParentWithToken:)
    func rootParent(withToken token: String) -> AnyObject? {
        // Walk only descends, so this delegate method is never load-bearing.
        return nil
    }

    private static func emptyTranslatorResponse() -> AnyObject? {
        guard let cls = NSClassFromString("AXPTranslatorResponse") as? NSObject.Type else {
            return nil
        }
        return cls.perform(NSSelectorFromString("emptyResponse"))?.takeUnretainedValue() as AnyObject?
    }
}

/// Tracks which screen rects we've already cataloged so the grid walk
/// can skip points covered by existing elements (avoiding redundant XPC
/// round-trips) and skip elements we've already serialized (avoiding
/// duplicate subtrees). Round to whole points — AX frames wobble a
/// fractional pixel between fetches and we don't care.
struct AccessibilityCoverage {
    private var leafRects: [NSRect] = []
    private var keys: Set<String> = []

    /// Add a known-leaf rect — point-in-rect checks will skip XPC for any
    /// grid point falling inside it.
    mutating func insertLeaf(_ rect: NSRect) {
        let key = Self.key(for: rect)
        if keys.insert(key).inserted {
            leafRects.append(rect)
        }
    }

    /// Add a container rect for frame-dedup only. Containers don't block
    /// grid probes — empty-children Groups (Nav bar, Tab Bar) are how iOS
    /// hides "remote" content, so points inside them must still be sampled.
    mutating func insertContainer(_ rect: NSRect) {
        keys.insert(Self.key(for: rect))
    }

    func contains(_ rect: NSRect) -> Bool {
        keys.contains(Self.key(for: rect))
    }

    func contains(_ point: CGPoint) -> Bool {
        for r in leafRects where r.contains(point) {
            return true
        }
        return false
    }

    private static func key(for rect: NSRect) -> String {
        "\(Int(rect.origin.x.rounded())),\(Int(rect.origin.y.rounded())),\(Int(rect.size.width.rounded())),\(Int(rect.size.height.rounded()))"
    }
}
