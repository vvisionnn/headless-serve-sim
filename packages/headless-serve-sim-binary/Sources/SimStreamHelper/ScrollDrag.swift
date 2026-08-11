import Foundation

/// Pure geometry for the scroll-as-touch-drag emulation in `HIDInjector`.
///
/// Split out so the tricky part — keeping the synthetic finger inside the
/// display and deciding when to re-anchor — is testable without a booted
/// simulator or a HID transport.
enum ScrollDrag {
    /// Fraction of the display kept clear at each edge. The finger stays inside
    /// this track: a touch reported at exactly 0 or 1 sits on the bezel, where
    /// iOS reads it as an edge gesture (swipe-to-home, notification center)
    /// rather than a scroll.
    static let edgeMargin: Double = 0.08

    /// Clamp a proposed finger position into the usable track.
    ///
    /// NaN carries no direction, so it centres. An infinity does carry one, so
    /// it clamps to the matching edge rather than jumping the finger to the
    /// middle of the screen mid-drag.
    static func clampToTrack(_ value: Double) -> Double {
        if value.isNaN { return 0.5 }
        return min(max(value, edgeMargin), 1 - edgeMargin)
    }

    /// Whether a proposed position has run out of track and the drag has to lift
    /// and restart from the anchor. Checked before clamping — once clamped, the
    /// finger would stall against the edge and the scroll would silently stop.
    static func needsReanchor(x: Double, y: Double) -> Bool {
        !isInsideTrack(x) || !isInsideTrack(y)
    }

    private static func isInsideTrack(_ value: Double) -> Bool {
        guard value.isFinite else { return false }
        return value > edgeMargin && value < 1 - edgeMargin
    }
}
