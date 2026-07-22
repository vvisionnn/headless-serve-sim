import Foundation

/// Kind of an AVCC chunk — used by the bounded send queue to decide what may
/// be discarded without leaving the decoder on an invalid reference chain.
enum AVCCChunkKind {
    case description
    case keyframe
    case delta
    case seed
    case heartbeat
    case disposableDelta
}

/// Queue state for one AVCC client. The owning `AVCCClient` holds its condition
/// lock for every call, keeping this type deterministic and easy to self-test.
final class AVCCSendQueue {
    enum Admission: Equatable {
        case enqueued
        case dropped
        case droppedNeedsKeyframe
    }

    struct Stats {
        let queuedBytes: Int
        let inFlightBytes: Int
        let highWaterBytes: Int
        let droppedChunks: UInt64
        let completedWrites: UInt64
        let totalWriteNanoseconds: UInt64
        let maxWriteNanoseconds: UInt64
    }

    private var pending: [Data] = []
    private var pendingDescription: Data?
    private(set) var queuedBytes = 0
    private(set) var inFlightBytes = 0
    private var highWaterBytes = 0
    private var sampleHighWaterBytes = 0
    private var needKeyframe = false
    private var droppedChunks: UInt64 = 0
    private var droppedSinceSample = 0
    private var completedWrites: UInt64 = 0
    private var totalWriteNanoseconds: UInt64 = 0
    private var maxWriteNanoseconds: UInt64 = 0

    var isEmpty: Bool { pending.isEmpty && pendingDescription == nil }
    var pressureBytes: Int { queuedBytes + inFlightBytes }

    func enqueue(_ chunk: Data, kind: AVCCChunkKind, limit: Int) -> Admission {
        switch kind {
        case .keyframe:
            pending.removeAll(keepingCapacity: true)
            queuedBytes = 0
            needKeyframe = false
            append(chunk)
            return .enqueued
        case .description:
            pendingDescription = chunk
            return .enqueued
        case .delta, .seed:
            guard pressureBytes + chunk.count <= limit else {
                droppedChunks += 1
                droppedSinceSample += 1
                let request = !needKeyframe
                needKeyframe = true
                return request ? .droppedNeedsKeyframe : .dropped
            }
            append(chunk)
            return .enqueued
        case .heartbeat:
            guard pressureBytes + chunk.count <= limit else { return .dropped }
            append(chunk)
            return .enqueued
        case .disposableDelta:
            guard pressureBytes + chunk.count <= limit / 2 else {
                droppedChunks += 1
                droppedSinceSample += 1
                return .dropped
            }
            append(chunk)
            return .enqueued
        }
    }

    /// Move exactly one chunk into the in-flight slot. Keeping all remaining
    /// chunks in `pending` means a blocked socket can never hide a detached
    /// multi-frame batch from congestion accounting or keyframe coalescing.
    func beginNextWrite() -> Data? {
        precondition(inFlightBytes == 0)
        let next: Data?
        if let description = pendingDescription {
            pendingDescription = nil
            next = description
        } else if !pending.isEmpty {
            next = pending.removeFirst()
            queuedBytes -= next!.count
        } else {
            next = nil
        }
        inFlightBytes = next?.count ?? 0
        updateHighWater()
        return next
    }

    func completeWrite(durationNanoseconds: UInt64) {
        guard inFlightBytes > 0 else { return }
        inFlightBytes = 0
        completedWrites += 1
        totalWriteNanoseconds &+= durationNanoseconds
        maxWriteNanoseconds = max(maxWriteNanoseconds, durationNanoseconds)
    }

    func clear() {
        pending.removeAll(keepingCapacity: false)
        pendingDescription = nil
        queuedBytes = 0
        inFlightBytes = 0
        needKeyframe = false
    }

    func stats() -> Stats {
        Stats(
            queuedBytes: queuedBytes,
            inFlightBytes: inFlightBytes,
            highWaterBytes: highWaterBytes,
            droppedChunks: droppedChunks,
            completedWrites: completedWrites,
            totalWriteNanoseconds: totalWriteNanoseconds,
            maxWriteNanoseconds: maxWriteNanoseconds
        )
    }

    func sampleHighWater() -> Int {
        let value = sampleHighWaterBytes
        sampleHighWaterBytes = pressureBytes
        return value
    }

    func sampleDropped() -> Int {
        let value = droppedSinceSample
        droppedSinceSample = 0
        return value
    }

    private func append(_ chunk: Data) {
        pending.append(chunk)
        queuedBytes += chunk.count
        updateHighWater()
    }

    private func updateHighWater() {
        highWaterBytes = max(highWaterBytes, pressureBytes)
        sampleHighWaterBytes = max(sampleHighWaterBytes, pressureBytes)
    }
}
