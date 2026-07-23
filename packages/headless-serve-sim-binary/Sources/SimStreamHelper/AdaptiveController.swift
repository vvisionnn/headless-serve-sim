import Foundation

/// Streaming quality mode. `perf` favors smoothness/latency on weak links;
/// `quality` spends more bits for sharper screen content.
enum StreamMode: String {
    case perf
    case quality
}

/// AIMD congestion controller for the H.264 stream. Each tick it reads a backlog
/// "congestion" signal (bytes queued behind the viewer's socket) and produces a
/// target bitrate + max-QP that keep the link from backing up: additively raise
/// quality when the queue is empty, multiplicatively cut it the moment we fall
/// behind. Pure and deterministic — no clock, no I/O — so the policy is unit
/// tested in isolation (see scripts/adaptive-controller-selftest.swift).
struct AdaptiveController {
    struct Bounds: Equatable {
        var minBitrate: Int
        var maxBitrate: Int
        var sharpQP: Int   // QP ceiling at max bitrate (kept high to hold frame rate)
        var softQP: Int    // QP ceiling when congested (softest, sheds the most bits)
    }

    struct Output: Equatable {
        let bitrate: Int
        let maxQP: Int
        let congested: Bool
    }

    private(set) var bounds: Bounds
    private(set) var bitrate: Int

    init(bounds: Bounds) {
        self.bounds = bounds
        self.bitrate = bounds.maxBitrate
    }

    /// Switch mode bounds, re-clamping the current target into the new range.
    mutating func setBounds(_ newBounds: Bounds) {
        bounds = newBounds
        bitrate = min(max(bitrate, newBounds.minBitrate), newBounds.maxBitrate)
    }

    /// Advance one control step.
    /// - Parameters:
    ///   - congestionBytes: high-water send backlog since the last tick.
    ///   - highWaterBytes: the per-client queue overflow threshold.
    mutating func tick(congestionBytes: Int, highWaterBytes: Int) -> Output {
        // Treat "half the drop threshold" as the congestion line so we back off
        // *before* the queue overflows and starts dropping frames.
        let congested = congestionBytes >= max(1, highWaterBytes / 2)
        if congested {
            // Multiplicative decrease — react fast to a shrinking pipe.
            bitrate = max(bounds.minBitrate, Int(Double(bitrate) * 0.6))
        } else if congestionBytes < max(1, highWaterBytes / 8) {
            // Additive increase — probe back up toward the ceiling. Trigger on a
            // LOW backlog, not exactly 0: an active stream almost always has a
            // few KB in flight, and requiring exactly 0 left the bitrate pinned
            // wherever it landed (~2 Mbps), starving the encoder so a motion
            // burst couldn't be fed — collapsing the frame rate.
            let step = max(150_000, bounds.maxBitrate / 16)
            bitrate = min(bounds.maxBitrate, bitrate + step)
        }
        // QP cap (a CEILING, not a target) tracks bitrate headroom: it rises
        // toward `softQP` under congestion to shed bits. Both ends are kept high
        // enough that VideoToolbox blurs a frame to fit rather than dropping it,
        // so the frame rate is never sacrificed for sharpness.
        let span = max(1, bounds.maxBitrate - bounds.minBitrate)
        let frac = Double(bitrate - bounds.minBitrate) / Double(span)
        let qp = Int((Double(bounds.softQP) + (Double(bounds.sharpQP) - Double(bounds.softQP)) * frac).rounded())
        return Output(bitrate: bitrate, maxQP: qp, congested: congested)
    }

    /// Mode-appropriate bounds scaled to the stream resolution. Screen content
    /// is highly compressible, so these ceilings are generous (they mostly bind
    /// during full-screen motion); the floor keeps a weak link smooth.
    static func bounds(for mode: StreamMode, width: Int, height: Int) -> Bounds {
        let mp = Double(max(1, width * height)) / 1_000_000.0
        switch mode {
        case .perf:
            // Generous ceiling so a fast scroll has the bit budget to stay sharp
            // at 60fps on a fast link (localhost is free); the adaptive loop and
            // the send-queue throttle it down on a constrained remote link.
            let ceil = clamp(Int(mp * 6_000_000), 12_000_000, 30_000_000)
            // perf prioritizes frame rate: a HIGH QP ceiling lets VideoToolbox
            // blur a too-complex frame to hold 60fps instead of dropping it. A
            // low ceiling (the old 30) forbade that blur, so on hard-to-compress
            // screens the encoder starved the frame rate to ~13fps even on a
            // clear local link. Simple content still encodes sharp — the ceiling
            // is never reached because AverageBitRate fills the budget at low QP.
            return Bounds(minBitrate: 150_000, maxBitrate: ceil, sharpQP: 46, softQP: 51)
        case .quality:
            let ceil = clamp(Int(mp * 12_000_000), 24_000_000, 60_000_000)
            return Bounds(minBitrate: 400_000, maxBitrate: ceil, sharpQP: 22, softQP: 40)
        }
    }

    private static func clamp(_ v: Int, _ lo: Int, _ hi: Int) -> Int { min(max(v, lo), hi) }
}
