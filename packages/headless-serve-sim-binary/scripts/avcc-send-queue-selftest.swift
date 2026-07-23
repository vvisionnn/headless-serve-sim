import Foundation

private func bytes(_ count: Int) -> Data {
    Data(repeating: 0xAB, count: count)
}

@main
private enum AVCCSendQueueSelftest {
    static func main() {
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
