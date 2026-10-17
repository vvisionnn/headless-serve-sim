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
        var side = DuoOutput.defaultSide
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
    /// How long to wait for the first hinge sample before composing the open
    /// default. A fresh helper hears the hinge shortly after its first panel;
    /// composing before then shows the open device, edge-on when the cover
    /// display has focus, and snaps once the real angle lands.
    private let hingeGrace: TimeInterval
    private let created = ProcessInfo.processInfo.systemUptime
    private var graceRetryScheduled = false

    init(hingeGrace: TimeInterval = 2, compose: @escaping ([Int: CVPixelBuffer], State) async -> Void) {
        self.hingeGrace = hingeGrace
        self.compose = compose
    }

    func offer(panel: Int, buffer: CVPixelBuffer) {
        lock.lock()
        panels[panel] = buffer
        revision &+= 1
        lock.unlock()
        schedule()
    }

    func update(angle: Double? = nil, rotation: Double? = nil, scale: Double? = nil, includeFrame: Bool? = nil, displayId: Int? = nil, blankedDisplay: Int? = nil, blanked: Bool? = nil, side: Int? = nil) {
        lock.lock()
        var changed = angle == nil && rotation == nil && scale == nil && includeFrame == nil
            && displayId == nil && blankedDisplay == nil && blanked == nil && side == nil
        if let angle, angle.isFinite, (0...180).contains(angle) {
            changed = changed || hinge.target != angle || !seededHinge
            hinge.target = angle
            if !seededHinge { hinge.value = angle; seededHinge = true }
        }
        if let rotation, rotation.isFinite {
            let current = roll.value.truncatingRemainder(dividingBy: 360)
            var delta = (rotation.truncatingRemainder(dividingBy: 360) - current).truncatingRemainder(dividingBy: 360)
            if delta > 180 { delta -= 360 }
            if delta < -180 { delta += 360 }
            let target = roll.value + delta
            // Equivalent angles can differ by a whole turn; don't re-target an
            // in-flight spring for a duplicate observer/client echo.
            if abs((target - roll.target).truncatingRemainder(dividingBy: 360)) > 0.000001 {
                roll.target = target
                changed = true
            }
        }
        if let displayId, displayId == 1 || displayId == 3 {
            let target = displayId == 1 ? 90.0 : 0
            changed = changed || focus.target != target || !seededFocus
            focus.target = target
            if !seededFocus { focus.value = focus.target; seededFocus = true }
        }
        if let scale, scale.isFinite, (0.5...2).contains(scale) {
            changed = changed || state.scale != scale
            state.scale = scale
        }
        if let side {
            changed = changed || state.side != side
            state.side = side
        }
        if let includeFrame {
            changed = changed || state.includeFrame != includeFrame
            state.includeFrame = includeFrame
        }
        if let blankedDisplay, let blanked {
            changed = changed || state.blankedDisplays.contains(blankedDisplay) != blanked
            if blanked { state.blankedDisplays.insert(blankedDisplay) }
            else { state.blankedDisplays.remove(blankedDisplay) }
        }
        if changed { revision &+= 1 }
        lock.unlock()
        if changed { schedule() }
    }

    private func schedule() {
        lock.lock()
        guard !running, !stopped, !panels.isEmpty else { lock.unlock(); return }
        let waited = ProcessInfo.processInfo.systemUptime - created
        if !seededHinge && waited < hingeGrace {
            let retry = !graceRetryScheduled
            graceRetryScheduled = true
            lock.unlock()
            if retry {
                DispatchQueue.global().asyncAfter(deadline: .now() + (hingeGrace - waited)) { [weak self] in
                    self?.schedule()
                }
            }
            return
        }
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

    /// True when no composition is running or pending and nothing is animating.
    var isIdle: Bool {
        lock.lock()
        defer { lock.unlock() }
        return !running
    }

    func stop() {
        lock.lock()
        stopped = true
        panels.removeAll()
        lock.unlock()
    }
}
