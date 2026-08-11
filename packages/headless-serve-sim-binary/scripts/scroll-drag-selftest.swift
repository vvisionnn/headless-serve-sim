import Foundation

@main
private enum ScrollDragSelftest {
    static func main() {
        let margin = ScrollDrag.edgeMargin

        // The finger must stay off the bezel. A touch reported at 0 or 1 is read
        // by iOS as an edge gesture (swipe-to-home, notification center), so a
        // scroll that ran to the boundary would trigger system UI instead.
        precondition(ScrollDrag.clampToTrack(-5) == margin)
        precondition(ScrollDrag.clampToTrack(0) == margin)
        precondition(ScrollDrag.clampToTrack(1) == 1 - margin)
        precondition(ScrollDrag.clampToTrack(9) == 1 - margin)

        // Interior values pass through untouched.
        precondition(ScrollDrag.clampToTrack(0.5) == 0.5)
        precondition(ScrollDrag.clampToTrack(0.25) == 0.25)

        // Non-finite input must not propagate into a CGPoint.
        precondition(ScrollDrag.clampToTrack(.nan) == 0.5)
        precondition(ScrollDrag.clampToTrack(.infinity) == 1 - margin)
        precondition(ScrollDrag.clampToTrack(-.infinity) == margin)

        // Re-anchor is decided on the *unclamped* proposal: once clamped the
        // finger would sit still against the edge and the scroll would stall
        // with no indication anything was wrong.
        precondition(ScrollDrag.needsReanchor(x: 0.5, y: 1.2))
        precondition(ScrollDrag.needsReanchor(x: -0.3, y: 0.5))
        precondition(ScrollDrag.needsReanchor(x: 0.5, y: margin))
        precondition(ScrollDrag.needsReanchor(x: 1 - margin, y: 0.5))
        precondition(!ScrollDrag.needsReanchor(x: 0.5, y: 0.5))
        precondition(!ScrollDrag.needsReanchor(x: margin + 0.01, y: 1 - margin - 0.01))

        // A NaN step must force a re-anchor rather than being treated as inside.
        precondition(ScrollDrag.needsReanchor(x: .nan, y: 0.5))

        // The track has to be wide enough to actually drag through.
        precondition(margin > 0 && margin < 0.25)

        // ── segmentStart ──
        // A continuation must begin at the wall the finger is travelling away
        // from, so the whole track is runway. Restarting at the cursor gave
        // about half of it, and every extra lift is a visible seam.
        precondition(ScrollDrag.segmentStart(anchor: 0.5, step: -0.1) == 1 - margin)
        precondition(ScrollDrag.segmentStart(anchor: 0.5, step: 0.1) == margin)
        // A zero or non-finite step has no direction; fall back to the anchor.
        precondition(ScrollDrag.segmentStart(anchor: 0.3, step: 0) == 0.3)
        precondition(ScrollDrag.segmentStart(anchor: 0.3, step: .nan) == 0.3)
        precondition(ScrollDrag.segmentStart(anchor: 9, step: 0) == 1 - margin)

        // ── fractionBeforeWall ──
        // A step that fits is spent whole.
        precondition(ScrollDrag.fractionBeforeWall(from: 0.5, step: 0.1) == 1)
        precondition(ScrollDrag.fractionBeforeWall(from: 0.5, step: -0.1) == 1)
        // No step, no limit.
        precondition(ScrollDrag.fractionBeforeWall(from: 0.5, step: 0) == 1)
        precondition(ScrollDrag.fractionBeforeWall(from: 0.5, step: .nan) == 1)
        // Half of an oversized step fits: from the top wall, a downward step of
        // twice the track spends exactly half before hitting the bottom.
        let track = 1 - 2 * margin
        let half = ScrollDrag.fractionBeforeWall(from: margin, step: track * 2)
        precondition(abs(half - 0.5) < 1e-9)
        // Sitting on the wall already, travelling into it, yields nothing.
        precondition(ScrollDrag.fractionBeforeWall(from: 1 - margin, step: 0.1) == 0)
        precondition(ScrollDrag.fractionBeforeWall(from: margin, step: -0.1) == 0)
        // Always a usable fraction — a value outside 0...1 would either stall
        // the drag or push the finger off the display.
        for position in [0.0, margin, 0.25, 0.5, 0.9, 1.0] {
            for step in [-5.0, -0.3, -0.01, 0.01, 0.3, 5.0] {
                let f = ScrollDrag.fractionBeforeWall(from: position, step: step)
                precondition(f >= 0 && f <= 1)
            }
        }

        // ── runway ──
        // The whole point: a continuation gets the full track, which is twice
        // what restarting at a mid-screen cursor gave.
        let fromCursor = 0.5 - margin
        let fromWall = ScrollDrag.fractionBeforeWall(
            from: ScrollDrag.segmentStart(anchor: 0.5, step: -1), step: -1
        )
        precondition(fromWall > fromCursor * 1.9)

        print("ScrollDrag self-test passed")
    }
}
