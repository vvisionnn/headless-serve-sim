import CoreVideo
import Foundation

/// Self-test for the H.264 pump's admission policy.
///
/// The property that matters is which frame is lost when the encoder cannot
/// keep up: the pump must discard the OLDEST un-encoded frame and keep the
/// newest, because the viewer wants current pixels. The previous controller did
/// the opposite — it rejected each new frame while one was in flight.
@main
private enum H264PumpSelftest {
    static func makeBuffer(tag: Int) -> CVPixelBuffer {
        var buffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault, 4, 4, kCVPixelFormatType_32BGRA, nil, &buffer
        )
        precondition(status == kCVReturnSuccess, "failed to allocate test buffer")
        // Tag the buffer so submission identity is checkable.
        CVBufferSetAttachment(
            buffer!, "tag" as CFString, NSNumber(value: tag), .shouldPropagate
        )
        return buffer!
    }

    static func tag(of buffer: CVPixelBuffer) -> Int {
        let value = CVBufferCopyAttachment(buffer, "tag" as CFString, nil)
        return ((value as? NSNumber)?.intValue) ?? -1
    }

    static func main() {
        submitsImmediatelyWhenIdle()
        keepsNewestFrameWhenBusy()
        drainsPendingOnCompletion()
        respectsDepth()
        preservesForcedKeyframeAcrossSupersede()
        resetDropsPending()
        print("H264 pump self-test passed")
    }

    /// With capacity free, a frame goes straight to the encoder.
    static func submitsImmediatelyWhenIdle() {
        var submitted: [Int] = []
        let pump = H264Pump(maxInFlight: 1) { buffer, _, _ in
            submitted.append(tag(of: buffer))
        }
        pump.offer(makeBuffer(tag: 1), forceKeyframe: false)
        precondition(submitted == [1], "idle pump must submit at once")
        precondition(pump.stats().submitted == 1)
    }

    /// THE regression this type exists for. Three frames arrive while the single
    /// slot is busy; the pump must keep the LAST one, not the first.
    static func keepsNewestFrameWhenBusy() {
        var submitted: [Int] = []
        var finish: (() -> Void)?
        let pump = H264Pump(maxInFlight: 1) { buffer, _, done in
            submitted.append(tag(of: buffer))
            finish = done
        }
        pump.offer(makeBuffer(tag: 1), forceKeyframe: false)
        precondition(submitted == [1])

        pump.offer(makeBuffer(tag: 2), forceKeyframe: false)
        pump.offer(makeBuffer(tag: 3), forceKeyframe: false)
        pump.offer(makeBuffer(tag: 4), forceKeyframe: false)
        precondition(submitted == [1], "must not exceed the in-flight limit")

        finish?()
        precondition(submitted == [1, 4], "pump must submit the NEWEST pending frame, got \(submitted)")

        let stats = pump.stats()
        precondition(stats.offered == 4)
        precondition(stats.submitted == 2)
        precondition(stats.supersededPending == 2, "frames 2 and 3 were superseded")
    }

    /// Completing a frame pulls the parked one through without another offer.
    static func drainsPendingOnCompletion() {
        var submitted: [Int] = []
        var pendingDone: [() -> Void] = []
        let pump = H264Pump(maxInFlight: 1) { buffer, _, done in
            submitted.append(tag(of: buffer))
            pendingDone.append(done)
        }
        pump.offer(makeBuffer(tag: 10), forceKeyframe: false)
        pump.offer(makeBuffer(tag: 11), forceKeyframe: false)
        precondition(submitted == [10])
        pendingDone.removeFirst()()
        precondition(submitted == [10, 11])
        precondition(pump.stats().completions == 1)
    }

    /// Depth N lets N frames overlap and no more.
    static func respectsDepth() {
        var submitted: [Int] = []
        var dones: [() -> Void] = []
        let pump = H264Pump(maxInFlight: 3) { buffer, _, done in
            submitted.append(tag(of: buffer))
            dones.append(done)
        }
        for tag in 1...5 { pump.offer(makeBuffer(tag: tag), forceKeyframe: false) }
        precondition(submitted == [1, 2, 3], "depth 3 admits exactly three, got \(submitted)")
        precondition(pump.stats().peakInFlight == 3)
        dones.removeFirst()()
        precondition(submitted == [1, 2, 3, 5], "the newest pending frame goes next, got \(submitted)")
    }

    /// A viewer asking to resync must not lose its keyframe request just because
    /// a newer frame replaced the one carrying it.
    static func preservesForcedKeyframeAcrossSupersede() {
        var forced: [Bool] = []
        var dones: [() -> Void] = []
        let pump = H264Pump(maxInFlight: 1) { _, force, done in
            forced.append(force)
            dones.append(done)
        }
        pump.offer(makeBuffer(tag: 1), forceKeyframe: false)
        pump.offer(makeBuffer(tag: 2), forceKeyframe: true)   // resync requested here
        pump.offer(makeBuffer(tag: 3), forceKeyframe: false)  // ...and superseded
        dones.removeFirst()()
        precondition(forced == [false, true], "forced keyframe must survive supersede, got \(forced)")
    }

    /// Resetting drops the parked frame instead of holding its buffer alive.
    static func resetDropsPending() {
        var submitted: [Int] = []
        var dones: [() -> Void] = []
        let pump = H264Pump(maxInFlight: 1) { buffer, _, done in
            submitted.append(tag(of: buffer))
            dones.append(done)
        }
        pump.offer(makeBuffer(tag: 1), forceKeyframe: false)
        pump.offer(makeBuffer(tag: 2), forceKeyframe: false)
        pump.reset()
        dones.removeFirst()()
        precondition(submitted == [1], "reset must discard the pending frame, got \(submitted)")
    }
}
