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
            guard finished.wait(timeout: .now() + .milliseconds(200)) == .success else {
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
            let unseeded = DuoFramePump { _, state in await fallback.record(state) }
            unseeded.update(includeFrame: includeFrame)
            unseeded.offer(panel: 3, buffer: buffer!)
            try? await Task.sleep(nanoseconds: 40_000_000)
            guard await fallback.angles == [180] else {
                fatalError("missing hinge sample must compose the safe default, includeFrame=\(includeFrame)")
            }
            unseeded.update(angle: 130)
            try? await Task.sleep(nanoseconds: 40_000_000)
            guard await fallback.angles.last == 130 else {
                fatalError("first valid hinge sample must seed the real pose without animating from the fallback")
            }
            unseeded.stop()
        }
        let seam = FocusRecorder()
        let seamPump = DuoFramePump { _, state in await seam.record(state) }
        seamPump.update(rotation: 170)
        seamPump.offer(panel: 3, buffer: buffer!)
        for _ in 0..<300 {
            if await seam.rotations.last == 170 { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        guard await seam.rotations.last == 170 else { fatalError("initial rotation did not settle") }
        seamPump.update(rotation: 350)
        for _ in 0..<300 {
            if await seam.rotations.last == 350 { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        guard await seam.rotations.last == 350 else { fatalError("seam setup rotation did not settle") }
        seamPump.update(rotation: -350)
        for _ in 0..<300 {
            if let rotation = await seam.rotations.last, rotation == 370 || rotation == 10 { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        guard await seam.rotations.last == 370 else { fatalError("signed degree seam must take the nearest 20-degree route, not -340") }
        seamPump.stop()
        let recorder = Recorder()
        let pump = DuoFramePump { _, state in await recorder.record(state.scale, includeFrame: state.includeFrame) }
        pump.update(angle: 180)
        pump.offer(panel: 3, buffer: buffer!)
        for _ in 0..<200 {
            if await recorder.release != nil { break }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        guard await recorder.release != nil else { fatalError("composition never started") }
        for step in 1...180 { pump.update(scale: 1 + Double(step) / 180) }
        pump.update(includeFrame: false)
        await recorder.resume()
        try? await Task.sleep(nanoseconds: 100_000_000)
        guard await recorder.angles == [1, 2] else { fatalError("must compose only newest pending view") }
        guard await recorder.includedFrames == [true, false] else { fatalError("screen-only toggle must reach the next coalesced composition") }
        pump.stop()
        pump.update(angle: 0)
        try? await Task.sleep(nanoseconds: 20_000_000)
        guard await recorder.angles.count == 2 else { fatalError("composition continued after stop") }
        let focus = FocusRecorder()
        let focusPump = DuoFramePump { _, state in await focus.record(state) }
        focusPump.update(angle: 180, displayId: 3)
        focusPump.offer(panel: 3, buffer: buffer!)
        try? await Task.sleep(nanoseconds: 40_000_000)
        focusPump.update(displayId: 1)
        for _ in 0..<300 {
            if await focus.yaws.last == 90 { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        let yaws = await focus.yaws
        precondition(yaws.first == 0)
        guard yaws.contains(where: { $0 > 0 && $0 < 90 }) else {
            fatalError("panel focus must turn through intermediate poses: \(yaws)")
        }
        precondition(yaws.last == 90)
        precondition(zip(yaws, yaws.dropFirst()).allSatisfy { $0 <= $1 })
        focusPump.update(blankedDisplay: 1, blanked: true)
        try? await Task.sleep(nanoseconds: 40_000_000)
        guard await focus.blanked.last == [1] else { fatalError("display blanking must reach the next composition") }
        focusPump.update(blankedDisplay: 1, blanked: false)
        try? await Task.sleep(nanoseconds: 40_000_000)
        let finalBlanked = await focus.blanked.last
        precondition(finalBlanked == [])
        focusPump.stop()
        let deduplicated = FocusRecorder()
        let dedupPump = DuoFramePump { _, state in await deduplicated.record(state) }
        dedupPump.update(angle: 180, rotation: 0, scale: 1, includeFrame: true, displayId: 3)
        dedupPump.offer(panel: 3, buffer: buffer!)
        try? await Task.sleep(nanoseconds: 40_000_000)
        for _ in 0..<2 { dedupPump.update(angle: 180, rotation: 0, scale: 1, includeFrame: true, displayId: 3) }
        try? await Task.sleep(nanoseconds: 40_000_000)
        guard await deduplicated.angles.count == 1 else { fatalError("identical view echoes must not render/encode again") }
        dedupPump.update()
        try? await Task.sleep(nanoseconds: 40_000_000)
        guard await deduplicated.angles.count == 2 else { fatalError("explicit refresh must remain available for keyframes") }
        dedupPump.update(side: 1536)
        try? await Task.sleep(nanoseconds: 40_000_000)
        guard await deduplicated.angles.count == 2 else { fatalError("an unchanged output side must not recompose") }
        dedupPump.update(side: 1024)
        try? await Task.sleep(nanoseconds: 40_000_000)
        guard await deduplicated.sides.last == 1024, await deduplicated.angles.count == 3 else { fatalError("a new output side must recompose at that side") }
        dedupPump.stop()
        print("Duo frame pump self-test passed")
    }
}
