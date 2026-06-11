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
        var sharpQP: Int   // QP cap when bandwidth is plentiful (sharper text)
        var softQP: Int    // QP cap when congested (softer, protects frame rate)
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
        } else if congestionBytes == 0 {
            // Additive increase — probe back up toward the ceiling.
            let step = max(150_000, bounds.maxBitrate / 16)
            bitrate = min(bounds.maxBitrate, bitrate + step)
        }
        // QP cap tracks bitrate headroom: sharp at the ceiling, soft near the
        // floor (so a weak link trades sharpness, not frame rate).
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
            let ceil = clamp(Int(mp * 2_500_000), 4_000_000, 12_000_000)
            return Bounds(minBitrate: 150_000, maxBitrate: ceil, sharpQP: 30, softQP: 48)
        case .quality:
            let ceil = clamp(Int(mp * 5_000_000), 8_000_000, 28_000_000)
            return Bounds(minBitrate: 400_000, maxBitrate: ceil, sharpQP: 22, softQP: 40)
        }
    }

    private static func clamp(_ v: Int, _ lo: Int, _ hi: Int) -> Int { min(max(v, lo), hi) }
}
