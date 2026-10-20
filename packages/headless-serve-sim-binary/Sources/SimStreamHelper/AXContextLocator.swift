import CoreGraphics
import Foundation

/// Content drawn by another process (an app window under Stage Manager, a
/// widget's body) reports frames in its own context's space; only hit-testing
/// runs on the screen. Find where a context sits by hit-testing against one of
/// its elements. Points here are interface points.
enum AXContextLocator {
    struct Hit {
        let context: UInt32
        /// In the hit context's own space.
        let frame: NSRect
    }

    /// The screen offset of `context`, given that hit-testing `seed` returned
    /// `element` from it. Each candidate is checked against the element's edges
    /// (four hits); failing those, bisect each axis to a quarter pixel.
    static func locate(context: UInt32, seed: CGPoint, element: NSRect, candidates: [CGPoint],
                       scale: CGFloat, hit: (CGPoint) -> Hit?) -> CGPoint {
        let step = 1 / (4 * scale)
        // A big element (a window's background) can be partly covered by
        // chrome that takes its touches, such as the strip along a Stage
        // Manager window's top; measure against something smaller near it.
        var seed = seed, element = element
        if min(element.width, element.height) > 120 {
            for dy in [-1, 0, 1] as [CGFloat] {
                for dx in [-1, 0, 1] as [CGFloat] where dx != 0 || dy != 0 {
                    let p = CGPoint(x: seed.x + dx * element.width / 4, y: seed.y + dy * element.height / 4)
                    if let h = hit(p), h.context == context,
                       h.frame.width * h.frame.height < element.width * element.height {
                        (seed, element) = (p, h.frame)
                    }
                }
            }
        }
        // Still on the element (or something inside it) in the same context.
        func onElement(_ p: CGPoint) -> Bool {
            guard let h = hit(p), h.context == context else { return false }
            return element.insetBy(dx: -0.01, dy: -0.01).contains(h.frame)
        }
        // The seed's place on the element bounds the offset.
        var lo = CGPoint(x: seed.x - element.maxX, y: seed.y - element.maxY)
        var hi = CGPoint(x: seed.x - element.minX, y: seed.y - element.minY)
        // Still measuring a big element: chrome only covers a window's top,
        // so take its bottom edge.
        let fromBottom = min(element.width, element.height) > 120
        func onEdgeY(_ c: CGFloat) -> Bool {
            fromBottom
                ? onElement(CGPoint(x: seed.x, y: element.maxY + c - step)) && !onElement(CGPoint(x: seed.x, y: element.maxY + c + step))
                : onElement(CGPoint(x: seed.x, y: element.minY + c + step)) && !onElement(CGPoint(x: seed.x, y: element.minY + c - step))
        }
        for c in candidates where (lo.x...hi.x).contains(c.x) && (lo.y...hi.y).contains(c.y) {
            if onElement(CGPoint(x: element.minX + c.x + step, y: seed.y)),
               !onElement(CGPoint(x: element.minX + c.x - step, y: seed.y)),
               onEdgeY(c.y) {
                return c
            }
        }
        // Probing at the element's left edge for a guessed offset lands on it
        // exactly when the real offset is no larger.
        while hi.x - lo.x > step {
            let mid = (lo.x + hi.x) / 2
            if onElement(CGPoint(x: element.minX + mid, y: seed.y)) { hi.x = mid } else { lo.x = mid }
        }
        while hi.y - lo.y > step {
            let mid = (lo.y + hi.y) / 2
            if fromBottom {
                if onElement(CGPoint(x: seed.x, y: element.maxY + mid)) { lo.y = mid } else { hi.y = mid }
            } else if onElement(CGPoint(x: seed.x, y: element.minY + mid)) { hi.y = mid } else { lo.y = mid }
        }
        return CGPoint(x: (hi.x * scale).rounded() / scale, y: (hi.y * scale).rounded() / scale)
    }

    /// Where a window of `size` in `context` sits, measured by its edges from
    /// `seed`, a point inside it. What it covers hit-tests as its own context
    /// or as content with none (a web view's, laid out in the window's space
    /// but with hit areas that don't match its frames). SpringBoard's strip
    /// along its top takes touches, so its height comes off the bottom edge;
    /// the left edge is found along its middle, clear of the window controls.
    static func locateWindow(context: UInt32, size: CGSize, seed: CGPoint, candidates: [CGPoint],
                             scale: CGFloat, hit: (CGPoint) -> Hit?) -> CGPoint {
        func inside(_ p: CGPoint) -> Bool {
            guard let h = hit(p) else { return false }
            return h.context == context || h.context == 0
        }
        let step = 1 / (4 * scale)
        func snap(_ v: CGFloat) -> CGFloat { (v * scale).rounded() / scale }
        for c in candidates {
            let bottom = c.y + size.height, middle = c.y + size.height / 2
            if inside(CGPoint(x: seed.x, y: bottom - step)), !inside(CGPoint(x: seed.x, y: bottom + step)),
               inside(CGPoint(x: c.x + step, y: middle)), !inside(CGPoint(x: c.x - step, y: middle)) {
                return c
            }
        }
        // The bottom edge lies within a window's height below the seed...
        var inY = seed.y, outY = seed.y + size.height
        while outY - inY > step {
            let mid = (inY + outY) / 2
            if inside(CGPoint(x: seed.x, y: mid)) { inY = mid } else { outY = mid }
        }
        let top = snap(outY) - size.height, middle = top + size.height / 2
        // ...and the left edge within its width to the left.
        var outX = seed.x - size.width, inX = seed.x
        while inX - outX > step {
            let mid = (outX + inX) / 2
            if inside(CGPoint(x: mid, y: middle)) { inX = mid } else { outX = mid }
        }
        return CGPoint(x: snap(inX), y: top)
    }

    /// A point on `screen` that hits `context`, a window of `size`: the
    /// centre, then a grid fine enough that the window can't fall between.
    /// Failing that, settle for content laid out in its space (see locate).
    static func findSeed(context: UInt32, size: CGSize, screen: CGSize, adoptsContextless: Bool = false,
                         hit: (CGPoint) -> Hit?) -> (point: CGPoint, frame: NSRect)? {
        let spacing = max(16, min(size.width, size.height) / 2)
        var points = [CGPoint(x: screen.width / 2, y: screen.height / 2)]
        var y = spacing / 2
        while y < screen.height {
            var x = spacing / 2
            while x < screen.width { points.append(CGPoint(x: x, y: y)); x += spacing }
            y += spacing
        }
        var contextless: (point: CGPoint, frame: NSRect)?
        for p in points {
            guard let h = hit(p) else { continue }
            if h.context == context { return (p, h.frame) }
            if adoptsContextless, h.context == 0, contextless == nil { contextless = (p, h.frame) }
        }
        return contextless
    }
}
