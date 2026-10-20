import Foundation

/// A fake iPad screen in interface points: SpringBoard (context 1) reports
/// screen frames; a Stage Manager window (context 7) and a widget (context 9)
/// report frames in their own space, as the simulator does.
private struct FakeScreen {
    var window = CGPoint(x: 287.5, y: 335)
    let windowSize = CGSize(width: 458, height: 594)
    let widget = CGPoint(x: 903.5, y: 76)
    var hits = 0

    // Deepest first within each context.
    var windowElements = [
        NSRect(x: 78, y: 10, width: 44, height: 44),
        NSRect(x: 42, y: 388, width: 376, height: 106),
        NSRect(x: 0, y: 0, width: 458, height: 594),
    ]
    let widgetElements = [
        NSRect(x: 17.5, y: 95.5, width: 120, height: 19.5),
        NSRect(x: 17.5, y: 17.5, width: 57.5, height: 50.5),
    ]
    // SpringBoard chrome over the window: its controls, and the strip along
    // its top that takes touches meant for dragging it. Then the widget's host.
    let controls = NSRect(x: 308, y: 355, width: 41, height: 22)
    var titleStrip: NSRect { NSRect(x: window.x, y: window.y, width: windowSize.width, height: 32) }
    var host: NSRect { NSRect(x: widget.x, y: widget.y, width: 360, height: 181) }

    // A browser window (context 8) under its title strip is all web content,
    // which has no context of its own (0) and is laid out in the window's space.
    let browser = CGPoint(x: 1000.5, y: 300)
    let browserSize = CGSize(width: 610, height: 671)
    let pageText = NSRect(x: 105, y: 239, width: 400, height: 72)

    mutating func hit(_ p: CGPoint) -> AXContextLocator.Hit? {
        hits += 1
        if controls.contains(p) { return .init(context: 1, frame: controls) }
        if titleStrip.contains(p) { return .init(context: 1, frame: titleStrip) }
        let inBrowser = CGPoint(x: p.x - browser.x, y: p.y - browser.y)
        if NSRect(origin: .zero, size: browserSize).contains(inBrowser) {
            if inBrowser.y < 32 { return .init(context: 1, frame: NSRect(origin: browser, size: CGSize(width: 610, height: 32))) }
            if inBrowser.y < 54 { return .init(context: 8, frame: NSRect(origin: .zero, size: browserSize)) }
            return .init(context: 0, frame: pageText.contains(inBrowser) ? pageText : NSRect(x: 0, y: 54, width: 610, height: 617))
        }
        let inWindow = CGPoint(x: p.x - window.x, y: p.y - window.y)
        if NSRect(origin: .zero, size: windowSize).contains(inWindow),
           let f = windowElements.first(where: { $0.contains(inWindow) }) {
            return .init(context: 7, frame: f)
        }
        let inWidget = CGPoint(x: p.x - widget.x, y: p.y - widget.y)
        if let f = widgetElements.first(where: { $0.contains(inWidget) }) { return .init(context: 9, frame: f) }
        if host.contains(p) { return .init(context: 1, frame: host) }
        return nil
    }
}

@main
private enum AXContextLocatorSelftest {
    static func main() {
        var screen = FakeScreen()
        let cell = NSRect(x: 42, y: 388, width: 376, height: 106)

        // Bisecting from one hit on the window's cell finds the window.
        var found = AXContextLocator.locate(context: 7, seed: CGPoint(x: 517, y: 775), element: cell,
                                            candidates: [], scale: 2) { screen.hit($0) }
        precondition(found == screen.window, "window offset \(found)")
        precondition(screen.hits <= 40, "bisection took \(screen.hits) hits")

        // A right cached offset costs four hits.
        screen.hits = 0
        found = AXContextLocator.locate(context: 7, seed: CGPoint(x: 517, y: 775), element: cell,
                                        candidates: [screen.window], scale: 2) { screen.hit($0) }
        precondition(found == screen.window && screen.hits == 4, "cache check took \(screen.hits) hits")

        // A stale one (the window moved a point) is caught and replaced.
        screen.window = CGPoint(x: 288.5, y: 335)
        found = AXContextLocator.locate(context: 7, seed: CGPoint(x: 517, y: 775), element: cell,
                                        candidates: [CGPoint(x: 287.5, y: 335)], scale: 2) { screen.hit($0) }
        precondition(found == screen.window, "moved window offset \(found)")

        // A widget's content sits at its host's origin; its margins hit the host.
        screen.hits = 0
        let text = NSRect(x: 17.5, y: 95.5, width: 120, height: 19.5)
        found = AXContextLocator.locate(context: 9, seed: CGPoint(x: 981, y: 181), element: text,
                                        candidates: [screen.host.origin], scale: 2) { screen.hit($0) }
        precondition(found == screen.widget && screen.hits == 4, "widget offset \(found) in \(screen.hits) hits")
        found = AXContextLocator.locate(context: 9, seed: CGPoint(x: 981, y: 181), element: text,
                                        candidates: [], scale: 2) { screen.hit($0) }
        precondition(found == screen.widget, "bisected widget offset \(found)")

        // Measured against the window's background, the strip would read as
        // outside it; a smaller element near the seed is measured instead.
        found = AXContextLocator.locate(context: 7, seed: CGPoint(x: screen.window.x + 20, y: screen.window.y + 200),
                                        element: NSRect(origin: .zero, size: screen.windowSize),
                                        candidates: [], scale: 2) { screen.hit($0) }
        precondition(found == screen.window, "background-measured window offset \(found)")
        screen.hits = 0
        found = AXContextLocator.locate(context: 7, seed: CGPoint(x: screen.window.x + 20, y: screen.window.y + 200),
                                        element: NSRect(origin: .zero, size: screen.windowSize),
                                        candidates: [screen.window], scale: 2) { screen.hit($0) }
        precondition(found == screen.window && screen.hits <= 12, "background cache check took \(screen.hits) hits")
        // With rows to measure against instead.
        screen.windowElements.insert(contentsOf: (0..<6).map { NSRect(x: 20, y: 100 + CGFloat($0) * 52, width: 418, height: 52) }, at: 0)
        found = AXContextLocator.locate(context: 7, seed: CGPoint(x: screen.window.x + 20, y: screen.window.y + 200),
                                        element: NSRect(origin: .zero, size: screen.windowSize),
                                        candidates: [], scale: 2) { screen.hit($0) }
        precondition(found == screen.window, "row-measured window offset \(found)")

        // A window is measured by its edges: what it covers is its own
        // context or content without one (web content, whose hit areas don't
        // match its frames). Its top is under SpringBoard's title strip, so
        // its height comes off the bottom edge.
        precondition(AXContextLocator.findSeed(context: 8, size: screen.browserSize,
                                               screen: CGSize(width: 1700, height: 1032)) { screen.hit($0) } == nil)
        let browserSeed = AXContextLocator.findSeed(context: 8, size: screen.browserSize, screen: CGSize(width: 1700, height: 1032),
                                                    adoptsContextless: true) { screen.hit($0) }
        precondition(browserSeed != nil, "no seed in the browser")
        screen.hits = 0
        found = AXContextLocator.locateWindow(context: 8, size: screen.browserSize, seed: browserSeed!.point,
                                              candidates: [], scale: 2) { screen.hit($0) }
        precondition(found == screen.browser, "browser offset \(found)")
        precondition(screen.hits <= 40, "window bisection took \(screen.hits) hits")
        screen.hits = 0
        found = AXContextLocator.locateWindow(context: 8, size: screen.browserSize, seed: browserSeed!.point,
                                              candidates: [screen.browser], scale: 2) { screen.hit($0) }
        precondition(found == screen.browser && screen.hits == 4, "window cache check took \(screen.hits) hits")
        found = AXContextLocator.locateWindow(context: 7, size: screen.windowSize, seed: CGPoint(x: 517, y: 775),
                                              candidates: [], scale: 2) { screen.hit($0) }
        precondition(found == screen.window, "settings window offset \(found)")

        // A window seen from nowhere is found by sampling the screen.
        let seed = AXContextLocator.findSeed(context: 7, size: screen.windowSize,
                                             screen: CGSize(width: 1032, height: 1376)) { screen.hit($0) }
        precondition(seed.map { screen.hit($0.point)?.context } == 7, "no seed in the window")
        precondition(AXContextLocator.findSeed(context: 5, size: screen.windowSize,
                                               screen: CGSize(width: 1032, height: 1376)) { screen.hit($0) } == nil)
        print("AX context locator self-test passed")
    }
}
