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

    /// Where to put the finger when starting a *continuation* segment, given the
    /// direction it is about to travel.
    ///
    /// Restarting at the cursor gives only the distance from the cursor to the
    /// near wall — about half the track when the pointer sits mid-screen.
    /// Starting at the far wall instead gives the whole track, which halves the
    /// number of lifts a long scroll needs. Each lift costs real smoothness:
    /// iOS begins its own deceleration on touch-up and then has to abandon it on
    /// the next touch-down.
    ///
    /// Only continuations use this. The first touch-down of a gesture stays on
    /// the cursor, because that is what decides which view iOS hit-tests.
    static func segmentStart(anchor: Double, step: Double) -> Double {
        guard step.isFinite, step != 0 else { return clampToTrack(anchor) }
        return step < 0 ? 1 - edgeMargin : edgeMargin
    }

    /// Fraction of `step` that can be applied from `position` before the finger
    /// leaves the track — 1 when the whole step fits.
    ///
    /// Lets a large coalesced delta be spent across several segments instead of
    /// being clamped away, which would silently swallow scroll distance.
    static func fractionBeforeWall(from position: Double, step: Double) -> Double {
        guard step.isFinite, step != 0, position.isFinite else { return 1 }
        let wall = step < 0 ? edgeMargin : 1 - edgeMargin
        let fraction = (wall - position) / step
        guard fraction.isFinite else { return 1 }
        return min(max(fraction, 0), 1)
    }
}
