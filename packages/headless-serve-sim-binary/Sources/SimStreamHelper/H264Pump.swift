import CoreVideo
import Foundation

/// Keeps the encoder fed with the FRESHEST frame instead of the luckiest one.
///
/// The previous policy admitted a frame only if the encoder had a free slot and
/// dropped it otherwise. That drops the NEWEST frame under load — exactly the
/// wrong one, because the viewer then sees older pixels while newer ones are
/// discarded — and it makes delivery bursty: the simulator hands us frames in
/// clumps (a ProMotion iPad offers 67-81 changed frames/s, not a tidy 60), so a
/// clump arrives, one frame wins the slot, and the rest are thrown away even
/// though the encoder goes idle moments later.
///
/// This holds a single-slot "latest pending frame". A new frame REPLACES any
/// older un-encoded one, and the pump submits whenever the encoder has capacity.
/// Under sustained overload the stream therefore degrades by skipping old
/// frames, never by starving on a full queue, and the frame the viewer sees is
/// always the most recent one the encoder could reach.
final class H264Pump {
    struct Stats {
        /// Frames handed to the pump.
        let offered: UInt64
        /// Frames submitted to the encoder.
        let submitted: UInt64
        /// Pending frames replaced by a newer one before they were ever encoded.
        let supersededPending: UInt64
        /// High-water mark of concurrent submissions.
        let peakInFlight: UInt64
        /// Completed round trips and their summed duration.
        let completions: UInt64
        let inFlightNanoseconds: UInt64
    }

    private let lock = NSLock()
    private let maxInFlight: Int
    private var inFlight = 0
    private var peakInFlight = 0
    private var pending: (buffer: CVPixelBuffer, forceKeyframe: Bool)?
    private var claimedAt: [UInt64] = []

    private var offered: UInt64 = 0
    private var submitted: UInt64 = 0
    private var supersededPending: UInt64 = 0
    private var completions: UInt64 = 0
    private var inFlightNanoseconds: UInt64 = 0

    /// Submits one frame. Called on the pump's own queue.
    private let submit: (CVPixelBuffer, Bool, @escaping () -> Void) -> Void

    init(maxInFlight: Int, submit: @escaping (CVPixelBuffer, Bool, @escaping () -> Void) -> Void) {
        self.maxInFlight = max(1, maxInFlight)
        self.submit = submit
    }

    /// Offer the newest snapshot. Returns immediately; the frame is either
    /// submitted now or parked as the pending frame, replacing an older one.
    func offer(_ buffer: CVPixelBuffer, forceKeyframe: Bool) {
        lock.lock()
        offered += 1
        if let existing = pending {
            supersededPending += 1
            // A forced keyframe request must survive being superseded, or a
            // viewer that asked to resync waits for the next periodic IDR.
            pending = (buffer, forceKeyframe || existing.forceKeyframe)
        } else {
            pending = (buffer, forceKeyframe)
        }
        lock.unlock()
        drain()
    }

    /// Submit pending work while the encoder has capacity.
    private func drain() {
        while true {
            lock.lock()
            guard inFlight < maxInFlight, let next = pending else {
                lock.unlock()
                return
            }
            pending = nil
            inFlight += 1
            peakInFlight = max(peakInFlight, inFlight)
            claimedAt.append(DispatchTime.now().uptimeNanoseconds)
            submitted += 1
            lock.unlock()

            submit(next.buffer, next.forceKeyframe) { [weak self] in
                self?.complete()
            }
        }
    }

    private func complete() {
        lock.lock()
        if inFlight > 0 { inFlight -= 1 }
        // Frame reordering is disabled, so completions arrive in submission
        // order and the oldest outstanding claim belongs to this frame.
        if !claimedAt.isEmpty {
            let started = claimedAt.removeFirst()
            inFlightNanoseconds &+= DispatchTime.now().uptimeNanoseconds &- started
            completions += 1
        }
        lock.unlock()
        drain()
    }

    /// Drop any parked frame — used when the last viewer disconnects so a stale
    /// buffer is not held alive until the next offer.
    func reset() {
        lock.lock()
        pending = nil
        lock.unlock()
    }

    func stats() -> Stats {
        lock.lock()
        defer { lock.unlock() }
        return Stats(
            offered: offered,
            submitted: submitted,
            supersededPending: supersededPending,
            peakInFlight: UInt64(peakInFlight),
            completions: completions,
            inFlightNanoseconds: inFlightNanoseconds
        )
    }
}
