import CoreVideo
import Foundation

actor Recorder {
    var angles: [Double] = []
    var includedFrames: [Bool] = []
    var release: CheckedContinuation<Void, Never>?
    func record(_ angle: Double, includeFrame: Bool) async {
        angles.append(angle)
        includedFrames.append(includeFrame)
        if angles.count == 1 { await withCheckedContinuation { release = $0 } }
    }
    func resume() { release?.resume(); release = nil }
}

actor FocusRecorder {
    var yaws: [Double] = []
    var blanked: [Set<Int>] = []
    var angles: [Double] = []
    var rotations: [Double] = []
    var sides: [Int] = []
    func record(_ state: DuoFramePump.State) { yaws.append(state.yaw); blanked.append(state.blankedDisplays); angles.append(state.angle); rotations.append(state.rotation); sides.append(state.side) }
}

/// Hang guard only: how long a healthy run takes depends on the machine.
let hangGuard: TimeInterval = 60

/// Waits until `condition` holds.
func until(_ what: String, _ condition: () async -> Bool) async {
    let deadline = Date().addingTimeInterval(hangGuard)
    while !(await condition()) {
        guard Date() < deadline else { fatalError("timed out waiting for \(what)") }
        try? await Task.sleep(nanoseconds: 1_000_000)
    }
}

/// Waits until the pump has composed everything pending and stopped animating,
/// so "nothing else was composed" checks are exact rather than timing guesses.
func settle(_ pump: DuoFramePump) async {
    await until("pump to settle") { pump.isIdle }
}

@main struct PumpTest {
    static func finiteRotationsDoNotBlock() {
        for rotation in [1e20, -1e20, Double.greatestFiniteMagnitude, -Double.greatestFiniteMagnitude] {
            let finished = DispatchSemaphore(value: 0)
            DispatchQueue.global().async {
                let pump = DuoFramePump { _, _ in }
                pump.update(rotation: rotation)
                pump.stop()
                finished.signal()
            }
            guard finished.wait(timeout: .now() + hangGuard) == .success else {
                fatalError("finite rotation \(rotation) blocked pump update/stop")
            }
        }
    }

    static func main() async {
        var buffer: CVPixelBuffer?
        CVPixelBufferCreate(nil, 2, 2, kCVPixelFormatType_32BGRA, nil, &buffer)
        finiteRotationsDoNotBlock()
        for includeFrame in [true, false] {
            let fallback = FocusRecorder()
            let unseeded = DuoFramePump(hingeGrace: 0.2) { _, state in await fallback.record(state) }
            unseeded.update(includeFrame: includeFrame)
            unseeded.offer(panel: 3, buffer: buffer!)
            await until("fallback composition after the hinge grace") { await !fallback.angles.isEmpty }
            await settle(unseeded)
            guard await fallback.angles == [180] else {
                fatalError("missing hinge sample must compose the safe default, includeFrame=\(includeFrame)")
            }
            unseeded.update(angle: 130)
            await settle(unseeded)
            guard await fallback.angles.last == 130 else {
                fatalError("first valid hinge sample must seed the real pose without animating from the fallback")
            }
            unseeded.stop()
        }
        // A fresh helper learns the hinge a moment after its first panel; the
        // open default (edge-on when the cover display has focus) must not be
        // shown in the meantime.
        let early = FocusRecorder()
        let earlyPump = DuoFramePump(hingeGrace: hangGuard) { _, state in await early.record(state) }
        earlyPump.update(displayId: 1)
        earlyPump.offer(panel: 1, buffer: buffer!)
        await settle(earlyPump)
        guard await early.angles.isEmpty else { fatalError("composed before the hinge was known") }
        earlyPump.update(angle: 0)
        await settle(earlyPump)
        let earlyAngles = await early.angles
        guard earlyAngles == [0] else {
            fatalError("first composition must use the observed hinge: \(earlyAngles)")
        }
        earlyPump.stop()
        // A freshly booted Duo may never report its hinge. With the cover
        // display lit it is closed; composing it open would show it edge-on.
        let closed = FocusRecorder()
        let closedPump = DuoFramePump(hingeGrace: 0.2) { _, state in await closed.record(state) }
        closedPump.update(displayId: 1)
        closedPump.offer(panel: 1, buffer: buffer!)
        await until("fallback composition after the hinge grace") { await !closed.angles.isEmpty }
        await settle(closedPump)
        let closedAngles = await closed.angles
        guard closedAngles == [0] else {
            fatalError("an unknown hinge with the cover display lit must compose closed: \(closedAngles)")
        }
        closedPump.stop()
        let seam = FocusRecorder()
        let seamPump = DuoFramePump { _, state in await seam.record(state) }
        seamPump.update(angle: 180, rotation: 170)
        seamPump.offer(panel: 3, buffer: buffer!)
        await settle(seamPump)
        guard await seam.rotations.last == 170 else { fatalError("initial rotation did not settle") }
        seamPump.update(rotation: 350)
        await settle(seamPump)
        guard await seam.rotations.last == 350 else { fatalError("seam setup rotation did not settle") }
        seamPump.update(rotation: -350)
        await settle(seamPump)
        guard await seam.rotations.last == 370 else { fatalError("signed degree seam must take the nearest 20-degree route, not -340") }
        seamPump.stop()
        let recorder = Recorder()
        let pump = DuoFramePump { _, state in await recorder.record(state.scale, includeFrame: state.includeFrame) }
        pump.update(angle: 180)
        pump.offer(panel: 3, buffer: buffer!)
        await until("composition to start") { await recorder.release != nil }
        for step in 1...180 { pump.update(scale: 1 + Double(step) / 180) }
        pump.update(includeFrame: false)
        await recorder.resume()
        await settle(pump)
        guard await recorder.angles == [1, 2] else { fatalError("must compose only newest pending view") }
        guard await recorder.includedFrames == [true, false] else { fatalError("screen-only toggle must reach the next coalesced composition") }
        pump.stop()
        // A stopped pump never schedules, so this is checked synchronously.
        pump.update(angle: 0)
        guard pump.isIdle, await recorder.angles.count == 2 else { fatalError("composition continued after stop") }
        let focus = FocusRecorder()
        let focusPump = DuoFramePump { _, state in await focus.record(state) }
        focusPump.update(angle: 180, displayId: 3)
        focusPump.offer(panel: 3, buffer: buffer!)
        await settle(focusPump)
        focusPump.update(displayId: 1)
        await settle(focusPump)
        let yaws = await focus.yaws
        precondition(yaws.first == 0)
        guard yaws.contains(where: { $0 > 0 && $0 < 90 }) else {
            fatalError("panel focus must turn through intermediate poses: \(yaws)")
        }
        precondition(yaws.last == 90)
        precondition(zip(yaws, yaws.dropFirst()).allSatisfy { $0 <= $1 })
        focusPump.update(blankedDisplay: 1, blanked: true)
        await settle(focusPump)
        guard await focus.blanked.last == [1] else { fatalError("display blanking must reach the next composition") }
        focusPump.update(blankedDisplay: 1, blanked: false)
        await settle(focusPump)
        let finalBlanked = await focus.blanked.last
        precondition(finalBlanked == [])
        focusPump.stop()
        let deduplicated = FocusRecorder()
        let dedupPump = DuoFramePump { _, state in await deduplicated.record(state) }
        dedupPump.update(angle: 180, rotation: 0, scale: 1, includeFrame: true, displayId: 3)
        dedupPump.offer(panel: 3, buffer: buffer!)
        await settle(dedupPump)
        for _ in 0..<2 { dedupPump.update(angle: 180, rotation: 0, scale: 1, includeFrame: true, displayId: 3) }
        await settle(dedupPump)
        guard await deduplicated.angles.count == 1 else { fatalError("identical view echoes must not render/encode again") }
        dedupPump.update()
        await settle(dedupPump)
        guard await deduplicated.angles.count == 2 else { fatalError("explicit refresh must remain available for keyframes") }
        dedupPump.update(side: 1536)
        await settle(dedupPump)
        guard await deduplicated.angles.count == 2 else { fatalError("an unchanged output side must not recompose") }
        dedupPump.update(side: 1024)
        await settle(dedupPump)
        guard await deduplicated.sides.last == 1024, await deduplicated.angles.count == 3 else { fatalError("a new output side must recompose at that side") }
        dedupPump.stop()
        print("Duo frame pump self-test passed")
    }
}
