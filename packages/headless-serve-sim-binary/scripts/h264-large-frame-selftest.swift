import CoreMedia
import CoreVideo
import Foundation

// Low-latency H.264 on Apple silicon takes at most a 4K UHD frame
// (8,294,400 px); past it VideoToolbox accepts every frame and emits nothing.
// The Duo's square composite is sized by the browser, so it must stay inside
// that, and the encoder must never go silent on a frame it can't take.

private final class Tally {
    private let lock = NSLock()
    private var keyframes = 0
    private var deltas = 0
    func add(_ encoded: H264Encoder.Encoded) {
        lock.lock(); defer { lock.unlock() }
        if encoded.kind == .keyframe { keyframes += 1 } else { deltas += 1 }
    }
    func counts() -> (keyframes: Int, deltas: Int) {
        lock.lock(); defer { lock.unlock() }; return (keyframes, deltas)
    }
}

private func frame(side: Int, shade: UInt8) -> CVPixelBuffer {
    var buffer: CVPixelBuffer?
    let attributes = [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary
    precondition(
        CVPixelBufferCreate(nil, side, side, kCVPixelFormatType_32BGRA, attributes, &buffer) == kCVReturnSuccess,
        "Pixel buffer allocation failed")
    let pixels = buffer!
    CVPixelBufferLockBaseAddress(pixels, [])
    let base = CVPixelBufferGetBaseAddress(pixels)!.assumingMemoryBound(to: UInt8.self)
    let count = CVPixelBufferGetDataSize(pixels)
    // A gradient with some texture, closer to a screen than a flat fill.
    for i in stride(from: 0, to: count, by: 4) {
        base[i] = UInt8(truncatingIfNeeded: i / 4096 &+ Int(shade))
        base[i + 1] = UInt8(truncatingIfNeeded: (i / 4) % 251)
        base[i + 2] = shade
        base[i + 3] = 255
    }
    CVPixelBufferUnlockBaseAddress(pixels, [])
    return pixels
}

/// Encodes `count` frames at `side`², the first a forced keyframe, on the
/// settings the helper streams a Duo with.
private func encode(side: Int, count: Int) -> (keyframes: Int, deltas: Int) {
    let encoder = H264Encoder(fps: 60, maxQP: 40, useLowLatencyRateControl: true)
    encoder.setBitrate(AdaptiveController.bounds(for: .quality, width: side, height: side).maxBitrate)
    let tally = Tally()
    encoder.onEncoded = { tally.add($0) }
    let done = DispatchGroup()
    for index in 0..<count {
        done.enter()
        encoder.encode(frame(side: side, shade: UInt8(index * 20)), forceKeyframe: index == 0) {
            done.leave()
        }
        Thread.sleep(forTimeInterval: 1.0 / 60.0)
    }
    precondition(done.wait(timeout: .now() + 60) == .success, "Encoder never finished")
    return tally.counts()
}

@main
private enum H264LargeFrameSelftest {
    static func main() {
        let largest = DuoOutput.maximumSide
        precondition(largest * largest <= 3840 * 2160, "The Duo's largest composite fits a 4K UHD frame")

        let atMaximum = encode(side: largest, count: 8)
        precondition(atMaximum.keyframes >= 1, "The largest Duo composite encodes its keyframe (\(atMaximum))")
        precondition(atMaximum.keyframes + atMaximum.deltas >= 6, "and keeps streaming (\(atMaximum))")

        // Past the low-latency limit the encoder must not go silent: it falls
        // back to a session that takes the frame.
        let pastLimit = encode(side: 3072, count: 8)
        precondition(pastLimit.keyframes >= 1, "A frame past the low-latency limit still streams (\(pastLimit))")
        print("H.264 large-frame self-test passed")
    }
}
