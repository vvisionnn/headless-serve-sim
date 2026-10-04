import CoreVideo
import Foundation

/// One pending composition; newer frames replace work the renderer has not begun.
final class DuoFramePump {
    struct State {
        var angle: Double = 180
        var rotation: Double = 0
        var yaw: Double = 0
        var scale: Double = 1
        var includeFrame = true
        var blankedDisplays: Set<Int> = []
    }

    private let lock = NSLock()
    private var panels: [Int: CVPixelBuffer] = [:]
    private var state = State()
    private var hinge = DuoMotion(value: 180, target: 180)
    private var roll = DuoMotion(value: 0, target: 0)
    private var focus = DuoMotion(value: 0, target: 0)
    private var seededFocus = false
    private var seededHinge = false
    private var lastStep = ProcessInfo.processInfo.systemUptime
    private var revision: UInt64 = 0
    private var running = false
    private var stopped = false
    private let compose: ([Int: CVPixelBuffer], State) async -> Void

    init(compose: @escaping ([Int: CVPixelBuffer], State) async -> Void) {
        self.compose = compose
    }

    func offer(panel: Int, buffer: CVPixelBuffer) {
        lock.lock()
        panels[panel] = buffer
        revision &+= 1
        lock.unlock()
        schedule()
    }

    func update(angle: Double? = nil, rotation: Double? = nil, scale: Double? = nil, includeFrame: Bool? = nil, displayId: Int? = nil, blankedDisplay: Int? = nil, blanked: Bool? = nil) {
        lock.lock()
        if let angle, angle.isFinite, (0...180).contains(angle) {
            hinge.target = angle
            if !seededHinge { hinge.value = angle; seededHinge = true }
        }
        if let rotation, rotation.isFinite {
            let current = roll.value.truncatingRemainder(dividingBy: 360)
            var delta = rotation - current
            while delta > 180 { delta -= 360 }
            while delta < -180 { delta += 360 }
            roll.target = roll.value + delta
        }
        if let displayId, displayId == 1 || displayId == 3 {
            focus.target = displayId == 1 ? 90 : 0
            if !seededFocus { focus.value = focus.target; seededFocus = true }
        }
        if let scale, scale.isFinite, (0.5...2).contains(scale) { state.scale = scale }
        if let includeFrame { state.includeFrame = includeFrame }
        if let blankedDisplay, let blanked {
            if blanked { state.blankedDisplays.insert(blankedDisplay) }
            else { state.blankedDisplays.remove(blankedDisplay) }
        }
        revision &+= 1
        lock.unlock()
        schedule()
    }

    private func schedule() {
        lock.lock()
        guard !running, !stopped, seededHinge, !panels.isEmpty else { lock.unlock(); return }
        running = true
        lock.unlock()
        Task { await drain() }
    }

    private func take() -> (panels: [Int: CVPixelBuffer], state: State, revision: UInt64)? {
        lock.lock()
        defer { lock.unlock() }
        guard !stopped else { return nil }
        let now = ProcessInfo.processInfo.systemUptime
        let dt = now - lastStep
        lastStep = now
        _ = hinge.step(dt)
        _ = roll.step(dt)
        _ = focus.step(dt)
        state.yaw = focus.value
        state.angle = max(0, min(180, hinge.value))
        state.rotation = roll.value
        return (panels, state, revision)
    }

    private func again(after completed: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        let moving = hinge.value != hinge.target || roll.value != roll.target || focus.value != focus.target
        if !stopped && (revision != completed || moving) { return true }
        running = false
        return false
    }

    private func drain() async {
        var deadline = ProcessInfo.processInfo.systemUptime
        while let next = take() {
            await compose(next.panels, next.state)
            if !again(after: next.revision) { return }
            deadline += 1.0 / 60
            let now = ProcessInfo.processInfo.systemUptime
            let remaining = deadline - now
            if remaining > 0 { try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000)) }
            else if remaining < -1.0 / 60 { deadline = now }
        }
    }

    func stop() {
        lock.lock()
        stopped = true
        panels.removeAll()
        lock.unlock()
    }
}
