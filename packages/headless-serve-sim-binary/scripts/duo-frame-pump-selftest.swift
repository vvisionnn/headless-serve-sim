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
    func record(_ state: DuoFramePump.State) { yaws.append(state.yaw); blanked.append(state.blankedDisplays) }
}

@main struct PumpTest {
    static func main() async {
        var buffer: CVPixelBuffer?
        CVPixelBufferCreate(nil, 2, 2, kCVPixelFormatType_32BGRA, nil, &buffer)
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
        print("Duo frame pump self-test passed")
    }
}
