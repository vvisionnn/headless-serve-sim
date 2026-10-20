import AppKit
import Foundation

/// Where each element's frame sits on the interface screen during one AX walk.
/// SpringBoard reports the fixed portrait screen; any other process reports
/// its own context's space — the screen for a full-screen app, but the window
/// under Stage Manager or the widget for a widget's body. Hit-testing runs on
/// the fixed screen, so it is what places those contexts.
final class AXPlacement {
    enum Space {
        case fixed
        case offset(CGPoint)
    }

    let fixedScreen: CGSize
    let interfaceScreen: CGSize
    let interfaceOrientation: String?
    let scale: CGFloat
    /// SpringBoard frames placed so far, short of the whole screen; a
    /// widget's host is among them.
    private var hosts: [NSRect] = []
    /// Elements serialized so far.
    var walked = Set<ElementKey>()

    private let hitTest: (CGPoint) -> NSObject?
    private let isSpringBoard: (Int32) -> Bool
    private let cachedOffset: (UInt32) -> CGPoint?
    private let storeOffset: (UInt32, CGPoint) -> Void
    private var resolved: [UInt32: CGPoint] = [:]

    init(fixedScreen: CGSize, interfaceOrientation: String?, scale: CGFloat,
         hitTest: @escaping (CGPoint) -> NSObject?, isSpringBoard: @escaping (Int32) -> Bool,
         cachedOffset: @escaping (UInt32) -> CGPoint?, storeOffset: @escaping (UInt32, CGPoint) -> Void) {
        self.fixedScreen = fixedScreen
        self.interfaceOrientation = interfaceOrientation
        self.scale = scale
        self.hitTest = hitTest
        self.isSpringBoard = isSpringBoard
        self.cachedOffset = cachedOffset
        self.storeOffset = storeOffset
        let landscape = interfaceOrientation?.hasPrefix("landscape") == true
        interfaceScreen = landscape ? CGSize(width: fixedScreen.height, height: fixedScreen.width) : fixedScreen
    }

    static func pid(of element: NSObject) -> Int32? {
        guard let translation = element.value(forKey: "translation") as? NSObject,
              translation.responds(to: NSSelectorFromString("pid")) else { return nil }
        return (translation.value(forKey: "pid") as? NSNumber)?.int32Value
    }

    struct ElementKey: Hashable {
        let pid: Int32
        let objectID: UInt64
    }

    /// Identifies an element across the wrappers hit-testing hands back.
    static func key(of element: NSObject) -> ElementKey? {
        guard let translation = element.value(forKey: "translation") as? NSObject,
              translation.responds(to: NSSelectorFromString("objectID")),
              let pid = pid(of: element),
              let id = (translation.value(forKey: "objectID") as? NSNumber)?.uint64Value else { return nil }
        return ElementKey(pid: pid, objectID: id)
    }

    static func contextId(of element: NSObject) -> UInt32? {
        guard element.responds(to: NSSelectorFromString("_windowContextId")) else { return nil }
        return (element.value(forKey: "_windowContextId") as? NSNumber)?.uint32Value
    }

    func interface(_ raw: NSRect, in space: Space) -> NSRect {
        switch space {
        case .fixed: return AXInterfaceFrame.fromFixed(raw, screen: fixedScreen, interfaceOrientation: interfaceOrientation)
        case .offset(let o): return raw.offsetBy(dx: o.x, dy: o.y)
        }
    }

    func interface(_ fixedPoint: CGPoint) -> CGPoint {
        interface(NSRect(origin: fixedPoint, size: .zero), in: .fixed).origin
    }

    func fixed(_ interfaceFrame: NSRect) -> NSRect {
        AXInterfaceFrame.toFixed(interfaceFrame, screen: fixedScreen, interfaceOrientation: interfaceOrientation)
    }

    /// The element under an interface point.
    func element(at point: CGPoint) -> NSObject? {
        hitTest(AXInterfaceFrame.toFixed(point, screen: fixedScreen, interfaceOrientation: interfaceOrientation))
    }

    private func hit(_ point: CGPoint) -> AXContextLocator.Hit? {
        guard let element = element(at: point) else { return nil }
        let frame = (element as? NSAccessibilityElement)?.accessibilityFrame() ?? .zero
        return .init(context: Self.contextId(of: element) ?? 0, frame: frame)
    }

    /// Record a placed interface frame.
    func note(_ frame: NSRect, in space: Space) {
        guard case .fixed = space,
              abs(frame.width - interfaceScreen.width) >= 1 || abs(frame.height - interfaceScreen.height) >= 1 else { return }
        hosts.append(frame)
    }

    /// The space of `element`'s process, given its own frame `raw`. `seed`
    /// is an interface point known to hit it; `guess` a likely offset.
    func space(pid: Int32, element: NSObject, raw: NSRect, seed: CGPoint?, guess: CGPoint?) -> Space? {
        if isSpringBoard(pid) { return .fixed }
        // Content without a context of its own (a web view's) is laid out in
        // its host app's space; the caller keeps that.
        guard let context = Self.contextId(of: element), context != 0 else { return nil }
        if let o = resolved[context] { return .offset(o) }
        // A widget's body sits at its SpringBoard host's origin. Its hit area
        // is skewed from its frames, so hit-testing can't place it.
        if let point = seed ?? guess.map({ CGPoint(x: $0.x + raw.midX, y: $0.y + raw.midY) }),
           let host = hosts.filter({ $0.contains(point) }).min(by: { $0.width * $0.height < $1.width * $1.height }),
           host.insetBy(dx: -1, dy: -1).contains(raw.offsetBy(dx: host.minX, dy: host.minY)) {
            resolved[context] = host.origin
            return .offset(host.origin)
        }
        var candidates: [CGPoint] = []
        for c in [cachedOffset(context), guess, .zero] { if let c, !candidates.contains(c) { candidates.append(c) } }
        var start = seed.map { (point: $0, frame: raw) }
        if start == nil {
            for c in candidates {
                let q = CGPoint(x: c.x + raw.midX, y: c.y + raw.midY)
                if let h = hit(q), h.context == context { start = (q, h.frame); break }
            }
        }
        guard let start else { return nil }
        return .offset(locate(context, seed: start, candidates: candidates))
    }

    /// The frontmost app's space, and its window when it doesn't fill the
    /// screen. `appFrame` is the application element's frame.
    func rootSpace(element: NSObject, pid: Int32?, appFrame: NSRect) -> (Space, window: NSRect?) {
        if let pid, isSpringBoard(pid) { return (.fixed, nil) }
        guard let context = Self.contextId(of: element) else { return (.offset(.zero), nil) }
        // Filling the screen, the app's space is the screen's; grid hits on
        // its hidden elements share it.
        guard abs(appFrame.width - interfaceScreen.width) >= 1 || abs(appFrame.height - interfaceScreen.height) >= 1 else {
            resolved[context] = .zero
            return (.offset(.zero), nil)
        }
        let cached = cachedOffset(context)
        var seed: (point: CGPoint, frame: NSRect)?
        if let cached {
            let q = CGPoint(x: cached.x + appFrame.midX, y: cached.y + appFrame.midY)
            if let h = hit(q), h.context == context || h.context == 0 { seed = (q, h.frame) }
        }
        // Much of a window can be another process's content (a web view's),
        // laid out in the window's space with no context of its own.
        if seed == nil {
            seed = AXContextLocator.findSeed(context: context, size: appFrame.size, screen: interfaceScreen,
                                             adoptsContextless: true) { hit($0) }
        }
        guard let seed else { return (.offset(.zero), nil) }
        let o = AXContextLocator.locateWindow(context: context, size: appFrame.size, seed: seed.point,
                                              candidates: cached.map { [$0] } ?? [], scale: scale) { hit($0) }
        resolved[context] = o
        storeOffset(context, o)
        return (.offset(o), appFrame.offsetBy(dx: o.x, dy: o.y))
    }

    private func locate(_ context: UInt32, seed: (point: CGPoint, frame: NSRect), candidates: [CGPoint]) -> CGPoint {
        let o = AXContextLocator.locate(context: context, seed: seed.point, element: seed.frame,
                                        candidates: candidates, scale: scale) { hit($0) }
        resolved[context] = o
        storeOffset(context, o)
        return o
    }
}
