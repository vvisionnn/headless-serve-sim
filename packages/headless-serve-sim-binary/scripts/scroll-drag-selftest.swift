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

        print("ScrollDrag self-test passed")
    }
}
