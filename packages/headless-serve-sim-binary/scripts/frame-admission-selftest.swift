import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

@main
private enum FrameAdmissionSelftest {
    static func main() {
        let admission = FrameAdmissionController()

        let first = admission.claim(wantsJpeg: true, wantsH264: true)
        expect(first.jpeg, "first JPEG should be admitted")
        expect(first.h264, "first H.264 should be admitted")
        expect(first.requiresSnapshot, "admitted encoders require one shared snapshot")

        let blocked = admission.claim(wantsJpeg: true, wantsH264: true)
        expect(!blocked.jpeg && !blocked.h264, "busy encoders should reject before a copy")
        expect(!blocked.requiresSnapshot, "fully rejected frames must not request a snapshot")

        admission.completeJpeg()
        let jpegOnly = admission.claim(wantsJpeg: true, wantsH264: true)
        expect(jpegOnly.jpeg && !jpegOnly.h264, "encoder admission must be independent")

        admission.completeJpeg()
        admission.completeH264()
        admission.noteIdleAvccHeartbeat()
        let h264Only = admission.claim(wantsJpeg: false, wantsH264: true)
        expect(!h264Only.jpeg && h264Only.h264, "an H.264-only viewer should not reserve JPEG")
        admission.completeH264()

        let stats = admission.stats()
        expect(stats.framesOffered == 4, "all offers should be counted")
        expect(stats.framesDemandingEncode == 4, "all test offers demand an encoder")
        expect(stats.snapshotsRequired == 3, "the blocked offer should avoid its snapshot")
        expect(stats.busyFramesAvoidedCopy == 1, "one demanded frame should avoid its copy")
        expect(stats.jpegBusyDrops == 1, "one JPEG offer should be rejected while busy")
        expect(stats.h264BusyDrops == 2, "two H.264 offers should be rejected while busy")
        expect(stats.idleAvccHeartbeats == 1, "idle heartbeat should be counted")

        print("FrameAdmissionController self-test passed")
    }
}
