import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

// Wrap the real VT calls so concurrent control/submission is observable without
// provoking an unrecoverable hardware-encoder deadlock in the test process.
private final class SubmissionGate {
    let entered = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var armed = false
    private var submitting = false
    private var overlapped = false
    private var bitrateWrites: [Int] = []
    private var qpWrites: [Int] = []
    private var presentationTime = CMTime.invalid

    func recordPresentationTime(_ time: CMTime) { lock.lock(); presentationTime = time; lock.unlock() }
    func lastPresentationTime() -> CMTime { lock.lock(); defer { lock.unlock() }; return presentationTime }

    func arm() { lock.lock(); armed = true; overlapped = false; bitrateWrites = []; qpWrites = []; lock.unlock() }
    func beginSubmission() {
        lock.lock()
        let pause = armed
        armed = false
        submitting = true
        lock.unlock()
        if pause {
            entered.signal()
            precondition(release.wait(timeout: .now() + 10) == .success, "Submission gate timed out")
        }
    }
    func endSubmission() { lock.lock(); submitting = false; lock.unlock() }
    func propertyOverlaps() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if submitting { overlapped = true }
        return submitting
    }
    func hadOverlap() -> Bool { lock.lock(); defer { lock.unlock() }; return overlapped }
    func recordProperty(_ key: CFString, _ value: CFTypeRef?) {
        guard let value = value as? NSNumber else { return }
        lock.lock(); defer { lock.unlock() }
        if key == kVTCompressionPropertyKey_AverageBitRate { bitrateWrites.append(value.intValue) }
        if key == kVTCompressionPropertyKey_MaxAllowedFrameQP { qpWrites.append(value.intValue) }
    }
    func controls() -> (bitrates: [Int], qps: [Int]) {
        lock.lock(); defer { lock.unlock() }; return (bitrateWrites, qpWrites)
    }
}

private let submissionGate = SubmissionGate()

@discardableResult
func VTSessionSetProperty(_ session: VTSession, key: CFString, value: CFTypeRef?) -> OSStatus {
    if submissionGate.propertyOverlaps() { return noErr }
    submissionGate.recordProperty(key, value)
    return VideoToolbox.VTSessionSetProperty(session, key: key, value: value)
}

func VTCompressionSessionEncodeFrame(_ session: VTCompressionSession, imageBuffer: CVImageBuffer,
                                    presentationTimeStamp: CMTime, duration: CMTime,
                                    frameProperties: CFDictionary?, infoFlagsOut: UnsafeMutablePointer<VTEncodeInfoFlags>?,
                                    outputHandler: @escaping VTCompressionOutputHandler) -> OSStatus {
    submissionGate.recordPresentationTime(presentationTimeStamp)
    submissionGate.beginSubmission()
    defer { submissionGate.endSubmission() }
    return VideoToolbox.VTCompressionSessionEncodeFrame(session, imageBuffer: imageBuffer,
        presentationTimeStamp: presentationTimeStamp, duration: duration,
        frameProperties: frameProperties, infoFlagsOut: infoFlagsOut, outputHandler: outputHandler)
}

private final class Result {
    private let lock = NSLock()
    private var value: H264Encoder.Encoded?
    func store(_ encoded: H264Encoder.Encoded) { lock.lock(); value = encoded; lock.unlock() }
    func take() -> H264Encoder.Encoded? { lock.lock(); defer { lock.unlock() }; return value }
}

@main private enum H264ColorSelftest {
    static func main() throws {
        let originalSPS = Data([39, 100, 0, 60, 172, 86, 128, 53, 128, 107, 123, 185, 168, 8, 104, 8, 16])
        let liveSPS = Data([39, 100, 0, 60, 172, 86, 128, 53, 128, 107, 123, 185, 168, 8, 104, 8, 60, 34, 17, 168])
        precondition(H264Encoder.lowDelaySPS(originalSPS) == liveSPS,
                     "Default native-density SPS must declare max_num_reorder_frames=0 and one reference buffer")
        precondition(H264Encoder.lowDelaySPS(liveSPS) == liveSPS, "Existing VUI bounds must not change")
        precondition(H264Encoder.lowDelaySPS(Data([39, 100])) == Data([39, 100]))
        var buffer: CVPixelBuffer?
        let attributes = [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary
        precondition(CVPixelBufferCreate(nil, 3420, 3420, kCVPixelFormatType_32BGRA, attributes, &buffer) == kCVReturnSuccess)
        let source = buffer!
        precondition(CVPixelBufferLockBaseAddress(source, []) == kCVReturnSuccess)
        let base = CVPixelBufferGetBaseAddress(source)!.assumingMemoryBound(to: UInt8.self)
        let stride = CVPixelBufferGetBytesPerRow(source)
        let colors: [[UInt8]] = [[40, 80, 160, 255], [90, 190, 70, 255], [170, 60, 30, 255], [150, 150, 150, 255]]
        for y in 0..<3420 { for x in 0..<3420 {
            let color = colors[min(3, x / 855)], offset = y * stride + x * 4
            for channel in 0..<4 { base[offset + channel] = color[channel] }
        } }
        CVPixelBufferUnlockBaseAddress(source, [])
        CVBufferSetAttachment(source, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(source, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_sRGB, .shouldPropagate)
        let encoder = H264Encoder(fps: 60, bitrate: 60_000_000, maxQP: 22, useLowLatencyRateControl: false)
        defer { encoder.stop() }
        verifySerializedStartup(source)
        verifyConcurrentStarts(source)
        let first = encode(source, with: encoder)
        let sps = parameterSets(first.description!)[0]
        precondition(sps[1] == 100 && sps[2] & 0x10 == 0,
                     "Live P-frames must not declare an intra-only profile")
        precondition(sps.count > 17, "High-profile live frames must explicitly declare zero reordering")
        precondition(first.description![2] == sps[2], "avcC constraints must match the SPS")
        let firstTiming = timing(first)
        let submittedTime = CMTimeConvertScale(submissionGate.lastPresentationTime(), timescale: 1_000_000,
                                              method: .default).value
        precondition(firstTiming[0] == UInt64(submittedTime), "Wire PTS must preserve the submitted host clock")
        precondition(firstTiming[1] == 16_667 && firstTiming[2] == 1)
        Thread.sleep(forTimeInterval: 0.08)
        let nextTiming = timing(encode(source, with: encoder))
        precondition(nextTiming[0] > firstTiming[0] + 80_000, "Wire PTS must retain real capture gaps")
        precondition(nextTiming[2] == firstTiming[2] + 1, "Each encoded picture must have a contiguous sequence")
        print("Frame-bound H.264 presentation time, duration and sequence passed")
        let format = try formatDescription(first.description!)
        let extensions = CMFormatDescriptionGetExtensions(format)! as NSDictionary
        precondition(extensions[kCMFormatDescriptionExtension_ColorPrimaries] as? String == kCVImageBufferColorPrimaries_ITU_R_709_2 as String,
                     "Encoded SPS must declare the source BT.709 primaries")
        precondition(extensions[kCMFormatDescriptionExtension_TransferFunction] as? String == kCVImageBufferTransferFunction_sRGB as String,
                     "Encoded SPS must preserve the source sRGB transfer function")
        precondition(extensions[kCMFormatDescriptionExtension_YCbCrMatrix] as? String == kCVImageBufferYCbCrMatrix_ITU_R_709_2 as String,
                     "Tagged sRGB pixels must declare their BT.709 conversion matrix")
        try annexB(first).write(to: URL(fileURLWithPath: "/tmp/h264-color-selftest.h264"))
        CVBufferSetAttachment(source, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_P3_D65, .shouldPropagate)
        CVBufferSetAttachment(source, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
        let changed = encode(source, with: encoder)
        precondition(changed.description != nil, "A same-size source color change must publish a new SPS")
        let changedExtensions = CMFormatDescriptionGetExtensions(try formatDescription(changed.description!))! as NSDictionary
        precondition(changedExtensions[kCMFormatDescriptionExtension_ColorPrimaries] as? String == kCVImageBufferColorPrimaries_P3_D65 as String,
                     "Source P3 primaries must not be replaced with BT.709")
        CVBufferRemoveAllAttachments(source)
        let ordinary = encode(source, with: encoder)
        precondition(ordinary.description != nil, "Removing color attachments must not leave stale SPS color tags")
        let ordinaryExtensions = CMFormatDescriptionGetExtensions(try formatDescription(ordinary.description!))! as NSDictionary
        precondition(ordinaryExtensions[kCMFormatDescriptionExtension_ColorPrimaries] == nil)
        precondition(ordinaryExtensions[kCMFormatDescriptionExtension_TransferFunction] == nil)
        precondition(ordinaryExtensions[kCMFormatDescriptionExtension_YCbCrMatrix] == nil)
        print("H.264 native-density source color metadata, same-size changes and untagged input passed")
    }

    private static func verifySerializedStartup(_ source: CVPixelBuffer) {
        let encoder = H264Encoder(fps: 60, bitrate: 60_000_000, maxQP: 22, useLowLatencyRateControl: false)
        defer { encoder.stop() }
        let submitted = DispatchSemaphore(value: 0), encoded = DispatchSemaphore(value: 0)
        let controlsStarted = DispatchSemaphore(value: 0), controlsFinished = DispatchSemaphore(value: 0)
        encoder.onEncoded = { _ in encoded.signal() }
        submissionGate.arm()
        DispatchQueue.global().async {
            encoder.encode(source, forceKeyframe: true) { submitted.signal() }
        }
        precondition(submissionGate.entered.wait(timeout: .now() + 10) == .success,
                     "Native-density first frame was never submitted")
        DispatchQueue.global().async {
            controlsStarted.signal()
            encoder.setBitrate(59_000_000)
            encoder.setMaxQP(21)
            controlsFinished.signal()
        }
        precondition(controlsStarted.wait(timeout: .now() + 2) == .success)
        let earlyControl = controlsFinished.wait(timeout: .now() + .milliseconds(100))
        let overlapped = submissionGate.hadOverlap()
        submissionGate.release.signal()
        precondition(submitted.wait(timeout: .now() + 10) == .success,
                     "First native-density frame did not complete")
        precondition(encoded.wait(timeout: .now() + 10) == .success,
                     "First native-density frame produced no H.264 output")
        if earlyControl != .success {
            precondition(controlsFinished.wait(timeout: .now() + 10) == .success)
        }
        guard !overlapped else {
            fatalError("Live bitrate/QP writes overlapped VT frame submission")
        }
        precondition(earlyControl == .timedOut, "Control writes bypassed the submission boundary")
        precondition(submissionGate.controls().bitrates == [60_000_000], "Startup controls must wait for output")
        precondition(submissionGate.controls().qps == [22], "Startup QP writes must wait for output")
        _ = encode(source, with: encoder)
        precondition(submissionGate.controls().bitrates == [60_000_000, 59_000_000])
        precondition(submissionGate.controls().qps == [22, 21])
        encoder.setBitrate(58_000_000)
        encoder.setBitrate(60_000_000)
        encoder.setMaxQP(22)
        _ = encode(source, with: encoder)
        precondition(submissionGate.controls().bitrates == [60_000_000, 59_000_000, 60_000_000],
                     "Pending control changes must coalesce to their latest value")
        precondition(submissionGate.controls().qps == [22, 21, 22])
        print("Native-density first submission serializes and defers live controls until output")
    }

    private static func verifyConcurrentStarts(_ source: CVPixelBuffer) {
        for _ in 0..<5 {
            let encoder = H264Encoder(fps: 60, bitrate: 60_000_000, maxQP: 22, useLowLatencyRateControl: false)
            let work = DispatchGroup(), output = DispatchSemaphore(value: 0)
            encoder.onEncoded = { _ in output.signal() }
            work.enter()
            DispatchQueue.global().async {
                for frame in 0..<12 {
                    encoder.encode(source, forceKeyframe: frame == 0)
                    Thread.sleep(forTimeInterval: 1.0 / 120)
                }
                work.leave()
            }
            work.enter()
            DispatchQueue.global().async {
                for control in 0..<20 {
                    encoder.setBitrate(control.isMultiple(of: 2) ? 60_000_000 : 59_000_000)
                    encoder.setMaxQP(control.isMultiple(of: 2) ? 22 : 21)
                    Thread.sleep(forTimeInterval: 1.0 / 240)
                }
                work.leave()
            }
            precondition(work.wait(timeout: .now() + 10) == .success, "Concurrent VT control/submission stalled")
            for _ in 0..<12 {
                precondition(output.wait(timeout: .now() + 10) == .success, "Concurrent native-density encode lost output")
            }
            let counters = encoder.counters()
            precondition(counters.submitted == 12 && counters.emitted == 12 && counters.droppedByEncoder == 0)
            encoder.stop()
        }
        print("Five concurrent native-density encoder starts emitted all 60 submitted frames")
    }

    private static func encode(_ source: CVPixelBuffer, with encoder: H264Encoder) -> H264Encoder.Encoded {
        let result = Result(), finished = DispatchSemaphore(value: 0)
        encoder.onEncoded = result.store
        encoder.encode(source, forceKeyframe: true) { finished.signal() }
        precondition(finished.wait(timeout: .now() + 10) == .success, "Encoder timed out")
        guard let encoded = result.take() else { fatalError("Encoder returned no frame") }
        return encoded
    }

    private static func parameterSets(_ data: Data) -> [Data] {
        let bytes = [UInt8](data)
        var offset = 6, result: [Data] = []
        for _ in 0..<(Int(bytes[5]) & 31) {
            let size = Int(bytes[offset]) << 8 | Int(bytes[offset + 1]); offset += 2
            result.append(Data(bytes[offset..<(offset + size)])); offset += size
        }
        let count = Int(bytes[offset]); offset += 1
        for _ in 0..<count {
            let size = Int(bytes[offset]) << 8 | Int(bytes[offset + 1]); offset += 2
            result.append(Data(bytes[offset..<(offset + size)])); offset += size
        }
        return result
    }

    private static func formatDescription(_ data: Data) throws -> CMVideoFormatDescription {
        let sets = parameterSets(data)
        var format: CMVideoFormatDescription?
        let status = sets[0].withUnsafeBytes { sps in sets[1].withUnsafeBytes { pps in
            let pointers = [sps.baseAddress!.assumingMemoryBound(to: UInt8.self), pps.baseAddress!.assumingMemoryBound(to: UInt8.self)]
            let sizes = sets.map(\.count)
            return CMVideoFormatDescriptionCreateFromH264ParameterSets(allocator: nil, parameterSetCount: 2,
                parameterSetPointers: pointers, parameterSetSizes: sizes, nalUnitHeaderLength: 4, formatDescriptionOut: &format)
        } }
        precondition(status == noErr && format != nil)
        return format!
    }

    private static func chunks(_ encoded: H264Encoder.Encoded) -> [(tag: UInt8, payload: Data)] {
        let bytes = [UInt8](encoded.envelope)
        var offset = 0, result: [(UInt8, Data)] = []
        while offset + 5 <= bytes.count {
            let size = bytes[offset..<(offset + 4)].reduce(0) { ($0 << 8) | Int($1) }
            precondition(size > 0 && offset + 4 + size <= bytes.count)
            result.append((bytes[offset + 4], Data(bytes[(offset + 5)..<(offset + 4 + size)])))
            offset += 4 + size
        }
        precondition(offset == bytes.count)
        return result
    }

    private static func timing(_ encoded: H264Encoder.Encoded) -> [UInt64] {
        let frames = chunks(encoded)
        guard let chunk = frames.first, chunk.tag == 0x08, chunk.payload.count == 24 else {
            fatalError("Every encoded picture must carry frame-bound host-clock timing")
        }
        precondition(frames.last?.tag == (encoded.kind == .keyframe ? 0x02 : 0x03))
        let bytes = [UInt8](chunk.payload)
        return stride(from: 0, to: 24, by: 8).map { offset in
            bytes[offset..<(offset + 8)].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        }
    }

    private static func annexB(_ encoded: H264Encoder.Encoded) -> Data {
        var output = Data()
        for set in parameterSets(encoded.description!) { output.append(contentsOf: [0, 0, 0, 1]); output.append(set) }
        for chunk in chunks(encoded) where [0x02, 0x03, 0x06].contains(chunk.tag) {
            let bytes = [UInt8](chunk.payload)
            var offset = 0
            while offset + 4 <= bytes.count {
                let size = bytes[offset..<(offset + 4)].reduce(0) { ($0 << 8) | Int($1) }; offset += 4
                output.append(contentsOf: [0, 0, 0, 1]); output.append(contentsOf: bytes[offset..<(offset + size)]); offset += size
            }
        }
        return output
    }
}
