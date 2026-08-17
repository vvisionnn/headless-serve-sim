import Foundation

/// Reserves encoder capacity before the expensive framebuffer snapshot.
///
/// JPEG and H.264 complete asynchronously on different queues. Keeping their
/// busy state behind one lock removes the previous cross-queue data races and
/// lets the capture callback skip a full BGRA copy when neither encoder can
/// accept the frame.
///
/// H.264 admits up to `maxH264InFlight` frames at once. A single slot makes the
/// delivered frame rate exactly `1 / round-trip`, which on a 5.7 MP iPad
/// framebuffer measured ~26 ms and therefore capped the stream at ~38 fps no
/// matter how many frames the simulator produced. VideoToolbox pipelines
/// submissions, and `FrameSnapshotter` hands out a pool buffer per frame, so
/// overlapping submissions is safe for both ordering (frame reordering is off)
/// and buffer lifetime.
final class FrameAdmissionController {
    struct Claims {
        let jpeg: Bool
        let h264: Bool
        var requiresSnapshot: Bool { jpeg || h264 }
    }

    struct Stats {
        let framesOffered: UInt64
        let framesDemandingEncode: UInt64
        let snapshotsRequired: UInt64
        let busyFramesAvoidedCopy: UInt64
        let jpegAdmitted: UInt64
        let jpegBusyDrops: UInt64
        let h264Admitted: UInt64
        let h264BusyDrops: UInt64
        let idleAvccHeartbeats: UInt64
        /// Completed H.264 round trips (claim → VideoToolbox callback).
        let h264Completions: UInt64
        /// Summed round-trip time for those completions.
        let h264InFlightNanoseconds: UInt64
        /// High-water mark of concurrently in-flight H.264 frames.
        let h264PeakInFlight: UInt64
    }

    private let lock = NSLock()
    private var jpegBusy = false
    private var h264InFlight = 0
    private let maxH264InFlight: Int
    private var framesOffered: UInt64 = 0
    private var framesDemandingEncode: UInt64 = 0
    private var snapshotsRequired: UInt64 = 0
    private var busyFramesAvoidedCopy: UInt64 = 0
    private var jpegAdmitted: UInt64 = 0
    private var jpegBusyDrops: UInt64 = 0
    private var h264Admitted: UInt64 = 0
    private var h264BusyDrops: UInt64 = 0
    private var idleAvccHeartbeats: UInt64 = 0
    private var h264Completions: UInt64 = 0
    private var h264InFlightNanoseconds: UInt64 = 0
    private var h264PeakInFlight: Int = 0
    /// Claim timestamps for frames still inside the encoder, oldest first.
    private var h264ClaimedAt: [UInt64] = []

    init(maxH264InFlight: Int = 1) {
        self.maxH264InFlight = max(1, maxH264InFlight)
    }

    func claim(wantsJpeg: Bool, wantsH264: Bool) -> Claims {
        lock.lock()
        defer { lock.unlock() }
        framesOffered += 1
        if wantsJpeg || wantsH264 { framesDemandingEncode += 1 }

        let jpeg = wantsJpeg && !jpegBusy
        let h264 = wantsH264 && h264InFlight < maxH264InFlight
        if jpeg {
            jpegBusy = true
            jpegAdmitted += 1
        } else if wantsJpeg {
            jpegBusyDrops += 1
        }
        if h264 {
            h264InFlight += 1
            h264PeakInFlight = max(h264PeakInFlight, h264InFlight)
            h264ClaimedAt.append(DispatchTime.now().uptimeNanoseconds)
            h264Admitted += 1
        } else if wantsH264 {
            h264BusyDrops += 1
        }
        if jpeg || h264 { snapshotsRequired += 1 }
        else if wantsJpeg || wantsH264 { busyFramesAvoidedCopy += 1 }
        return Claims(jpeg: jpeg, h264: h264)
    }

    func completeJpeg() {
        lock.lock()
        jpegBusy = false
        lock.unlock()
    }

    func completeH264() {
        lock.lock()
        if h264InFlight > 0 { h264InFlight -= 1 }
        // Frame reordering is disabled, so completions arrive in submission
        // order and the oldest outstanding claim is this frame's.
        if !h264ClaimedAt.isEmpty {
            let claimedAt = h264ClaimedAt.removeFirst()
            h264InFlightNanoseconds &+= DispatchTime.now().uptimeNanoseconds &- claimedAt
            h264Completions += 1
        }
        lock.unlock()
    }

    func noteIdleAvccHeartbeat() {
        lock.lock()
        idleAvccHeartbeats += 1
        lock.unlock()
    }

    func stats() -> Stats {
        lock.lock()
        defer { lock.unlock() }
        return Stats(
            framesOffered: framesOffered,
            framesDemandingEncode: framesDemandingEncode,
            snapshotsRequired: snapshotsRequired,
            busyFramesAvoidedCopy: busyFramesAvoidedCopy,
            jpegAdmitted: jpegAdmitted,
            jpegBusyDrops: jpegBusyDrops,
            h264Admitted: h264Admitted,
            h264BusyDrops: h264BusyDrops,
            idleAvccHeartbeats: idleAvccHeartbeats,
            h264Completions: h264Completions,
            h264InFlightNanoseconds: h264InFlightNanoseconds,
            h264PeakInFlight: UInt64(h264PeakInFlight)
        )
    }
}
