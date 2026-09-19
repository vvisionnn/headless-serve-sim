import Foundation

private func bytes(_ count: Int) -> Data {
    Data(repeating: 0xAB, count: count)
}

@main
private enum AVCCSendQueueSelftest {
    static func main() {
        // Periodic IDRs must not discard healthy frames waiting for the socket.
        let healthy = AVCCSendQueue()
        precondition(healthy.enqueue(bytes(40), kind: .delta, limit: 200) == .enqueued)
        precondition(healthy.enqueue(bytes(50), kind: .delta, limit: 200) == .enqueued)
        precondition(healthy.enqueue(bytes(60), kind: .keyframe, limit: 200) == .enqueued)
        for size in [40, 50, 60] {
            precondition(healthy.beginNextWrite()?.count == size, "healthy keyframe discarded a queued frame")
            healthy.completeWrite(durationNanoseconds: 1)
        }
        precondition(healthy.stats().droppedChunks == 0)

        // Once a reference is dropped, later deltas remain undecodable even
        // after the socket catches up. Only an IDR repairs the reference chain.
        let recovery = AVCCSendQueue()
        precondition(recovery.enqueue(bytes(160), kind: .delta, limit: 200) == .enqueued)
        precondition(recovery.beginNextWrite()?.count == 160)
        precondition(recovery.enqueue(bytes(50), kind: .delta, limit: 200) == .droppedNeedsKeyframe)
        recovery.completeWrite(durationNanoseconds: 1)
        precondition(recovery.enqueue(bytes(20), kind: .delta, limit: 200) == .dropped)
        precondition(recovery.enqueue(bytes(20), kind: .disposableDelta, limit: 200) == .dropped)
        precondition(recovery.enqueue(bytes(60), kind: .keyframe, limit: 200) == .enqueued)
        precondition(recovery.enqueue(bytes(20), kind: .delta, limit: 200) == .enqueued)
        precondition(recovery.stats().droppedChunks == 3)
        precondition(recovery.beginNextWrite()?.count == 60)

        // A resolution/configuration change must not send old-session video
        // after the new description, even if the writer beats the new IDR.
        let reconfigured = AVCCSendQueue()
        precondition(reconfigured.enqueue(bytes(40), kind: .delta, limit: 200) == .enqueued)
        precondition(reconfigured.enqueue(bytes(12), kind: .description, limit: 200) == .enqueued)
        precondition(reconfigured.beginNextWrite()?.count == 12)
        reconfigured.completeWrite(durationNanoseconds: 1)
        precondition(reconfigured.beginNextWrite() == nil)
        precondition(reconfigured.enqueue(bytes(20), kind: .delta, limit: 200) == .dropped)
        precondition(reconfigured.enqueue(bytes(60), kind: .keyframe, limit: 200) == .enqueued)
        precondition(reconfigured.beginNextWrite()?.count == 60)
        precondition(reconfigured.stats().droppedChunks == 2)

        let queue = AVCCSendQueue()
        precondition(queue.enqueue(bytes(80), kind: .delta, limit: 200) == .enqueued)
        precondition(queue.enqueue(bytes(70), kind: .delta, limit: 200) == .enqueued)
        precondition(queue.beginNextWrite()?.count == 80)
        precondition(queue.stats().queuedBytes == 70)
        precondition(queue.stats().inFlightBytes == 80)
        precondition(queue.enqueue(bytes(40), kind: .delta, limit: 200) == .enqueued)
        precondition(queue.enqueue(bytes(20), kind: .delta, limit: 200) == .droppedNeedsKeyframe)
        precondition(queue.stats().queuedBytes + queue.stats().inFlightBytes == 190)

        // A keyframe replaces only pending obsolete frames; the write already owned by
        // the kernel remains visible until it completes.
        precondition(queue.enqueue(bytes(90), kind: .keyframe, limit: 200) == .enqueued)
        precondition(queue.stats().queuedBytes == 90)
        precondition(queue.stats().inFlightBytes == 80)
        precondition(queue.stats().droppedChunks == 3, "coalesced frames were not counted")
        queue.completeWrite(durationNanoseconds: 2_000_000)
        precondition(queue.beginNextWrite()?.count == 90)
        queue.completeWrite(durationNanoseconds: 3_000_000)
        precondition(queue.stats().completedWrites == 2)
        precondition(queue.stats().maxWriteNanoseconds == 3_000_000)

        // Decoder descriptions always precede the next queued keyframe.
        precondition(queue.enqueue(bytes(12), kind: .description, limit: 200) == .enqueued)
        precondition(queue.enqueue(bytes(100), kind: .keyframe, limit: 200) == .enqueued)
        precondition(queue.beginNextWrite()?.count == 12)
        queue.completeWrite(durationNanoseconds: 1)
        precondition(queue.beginNextWrite()?.count == 100)

        print("AVCCSendQueue self-test passed")
    }
}
