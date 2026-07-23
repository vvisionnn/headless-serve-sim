import Foundation

/// Reserves encoder capacity before the expensive framebuffer snapshot.
///
/// JPEG and H.264 complete asynchronously on different queues. Keeping their
/// busy state behind one lock removes the previous cross-queue data races and
/// lets the capture callback skip a full BGRA copy when neither encoder can
/// accept the frame.
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
    }

    private let lock = NSLock()
    private var jpegBusy = false
    private var h264Busy = false
    private var framesOffered: UInt64 = 0
    private var framesDemandingEncode: UInt64 = 0
    private var snapshotsRequired: UInt64 = 0
    private var busyFramesAvoidedCopy: UInt64 = 0
    private var jpegAdmitted: UInt64 = 0
    private var jpegBusyDrops: UInt64 = 0
    private var h264Admitted: UInt64 = 0
    private var h264BusyDrops: UInt64 = 0
    private var idleAvccHeartbeats: UInt64 = 0

    func claim(wantsJpeg: Bool, wantsH264: Bool) -> Claims {
        lock.lock()
        defer { lock.unlock() }
        framesOffered += 1
        if wantsJpeg || wantsH264 { framesDemandingEncode += 1 }

        let jpeg = wantsJpeg && !jpegBusy
        let h264 = wantsH264 && !h264Busy
        if jpeg {
            jpegBusy = true
            jpegAdmitted += 1
        } else if wantsJpeg {
            jpegBusyDrops += 1
        }
        if h264 {
            h264Busy = true
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
        h264Busy = false
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
            idleAvccHeartbeats: idleAvccHeartbeats
        )
    }
}
