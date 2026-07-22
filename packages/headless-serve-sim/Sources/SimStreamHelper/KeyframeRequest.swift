import Foundation

/// Coalesces keyframe requests across the client-manager and capture queues.
final class KeyframeRequest {
    private let lock = NSLock()
    private var pending = false

    func request() {
        lock.lock()
        pending = true
        lock.unlock()
    }

    func isPending() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return pending
    }

    func consume() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        let value = pending
        pending = false
        return value
    }
}
