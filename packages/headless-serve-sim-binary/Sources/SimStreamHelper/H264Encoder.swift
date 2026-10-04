import Foundation
import CoreVideo
import CoreMedia
import VideoToolbox

/// Real-time H.264 encoder backed by `VTCompressionSession`, producing AVCC
/// (length-prefixed NAL) output for the `/stream.avcc` endpoint.
///
/// Submission is fire-and-forget: the caller hands a `CVPixelBuffer` in and
/// the encoded chunk comes back via `onEncoded` on VideoToolbox's own queue.
/// The incoming buffer is an owned `FrameSnapshotter` result, so it cannot be
/// changed by SimulatorKit while VideoToolbox holds it asynchronously.
final class H264Encoder {
    struct Encoded {
        /// avcC parameter-set blob — emitted once on the first IDR per session.
        let description: Data?
        let kind: Kind
        /// Complete serve-sim envelope ready for the socket queue.
        let envelope: Data
        /// Temporal enhancement frame that future frames do not reference.
        let disposable: Bool
        enum Kind { case keyframe, delta }
    }

    var onEncoded: ((Encoded) -> Void)?

    /// Submission accounting. VideoToolbox may accept a frame and then produce no
    /// output for it — the callback fires with a nil sample buffer. That is a
    /// silent frame loss: admission is released, the viewer simply never sees the
    /// picture. Counting it separates "we never offered the frame" from "the
    /// encoder swallowed it", which look identical in a delivered-FPS number.
    struct Counters {
        let submitted: UInt64
        let submitFailed: UInt64
        let emitted: UInt64
        let droppedByEncoder: UInt64
        /// Callback fired with no sample buffer — VideoToolbox discarded it.
        let nilSampleBuffer: UInt64
        /// Sample buffer arrived but carried no extractable data.
        let unextractable: UInt64
    }

    private let countersLock = NSLock()
    private var submittedCount: UInt64 = 0
    private var submitFailedCount: UInt64 = 0
    private var emittedCount: UInt64 = 0
    private var droppedByEncoderCount: UInt64 = 0
    private var nilSampleBufferCount: UInt64 = 0
    private var unextractableCount: UInt64 = 0

    func counters() -> Counters {
        countersLock.lock()
        defer { countersLock.unlock() }
        return Counters(
            submitted: submittedCount,
            submitFailed: submitFailedCount,
            emitted: emittedCount,
            droppedByEncoder: droppedByEncoderCount,
            nilSampleBuffer: nilSampleBufferCount,
            unextractable: unextractableCount
        )
    }

    private let lock = NSLock()
    private var session: VTCompressionSession?
    private var width: Int32 = 0
    private var height: Int32 = 0
    private struct ColorMetadata: Equatable {
        let primaries: String?
        let transfer: String?
        let matrix: String?

        init(_ source: CVPixelBuffer) {
            primaries = CVBufferCopyAttachment(source, kCVImageBufferColorPrimariesKey, nil) as? String
            transfer = CVBufferCopyAttachment(source, kCVImageBufferTransferFunctionKey, nil) as? String
            let attachedMatrix = CVBufferCopyAttachment(source, kCVImageBufferYCbCrMatrixKey, nil) as? String
            matrix = attachedMatrix ?? (primaries == kCVImageBufferColorPrimaries_ITU_R_709_2 as String
                ? kCVImageBufferYCbCrMatrix_ITU_R_709_2 as String : nil)
        }
    }
    private var colorMetadata: ColorMetadata?
    private let fps: Int32
    private var bitrate: Int
    private var maxQP: Int
    private var appliedBitrate: Int = 0
    private var appliedMaxQP: Int = 0
    private let keyframeIntervalSeconds: Int
    /// Fraction of the frame rate carried by the reference base layer. `nil`
    /// disables the temporal hierarchy entirely.
    private let baseLayerFrameRateFraction: Double?
    /// Whether to request VideoToolbox's low-latency rate control.
    private let useLowLatencyRateControl: Bool
    /// What we tell VideoToolbox to expect. The simulator can offer more than
    /// this (a ProMotion iPad produced ~69 changed frames/s), and an
    /// under-declared rate makes the rate controller budget bits for a slower
    /// stream than it is actually being handed.
    private let expectedFrameRate: Int32
    private let stateQueue = DispatchQueue(label: "H264Encoder.state")
    private var emittedDescription = false
    private var frameCount: Int64 = 0
    private var encodedSequence: UInt64 = 0

    init(
        fps: Int = 60,
        bitrate: Int = 8_000_000,
        maxQP: Int = 48,
        keyframeIntervalSeconds: Int = 2,
        baseLayerFrameRateFraction: Double? = nil,
        useLowLatencyRateControl: Bool = true,
        expectedFrameRate: Int? = nil
    ) {
        self.fps = Int32(fps)
        self.bitrate = bitrate
        self.maxQP = maxQP
        self.keyframeIntervalSeconds = keyframeIntervalSeconds
        self.baseLayerFrameRateFraction = baseLayerFrameRateFraction
        self.useLowLatencyRateControl = useLowLatencyRateControl
        self.expectedFrameRate = Int32(expectedFrameRate ?? fps)
    }

    deinit {
        if let session { VTCompressionSessionInvalidate(session) }
    }

    /// Submit a frame. Returns immediately; `onEncoded` fires on VT's queue.
    func encode(_ source: CVPixelBuffer, forceKeyframe: Bool = false, completion: (() -> Void)? = nil) {
        lock.lock()
        let w = Int32(CVPixelBufferGetWidth(source))
        let h = Int32(CVPixelBufferGetHeight(source))
        let nextColor = ColorMetadata(source)
        if session == nil || w != width || h != height || colorMetadata != nextColor {
            width = w
            height = h
            colorMetadata = nextColor
            rebuildSession()
        }
        guard let session else {
            lock.unlock()
            completion?()
            return
        }

        // The remote encoder can still be initializing after the first submit
        // returns. Apply queued controls only once this session has output.
        if stateQueue.sync(execute: { emittedDescription }) {
            if appliedBitrate != bitrate {
                VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: NSNumber(value: bitrate))
                appliedBitrate = bitrate
            }
            if appliedMaxQP != maxQP {
                applyMaxQP(maxQP, to: session)
                appliedMaxQP = maxQP
            }
        }
        frameCount += 1
        // Presentation time is the HOST CLOCK, not a frame counter.
        //
        // A counter at `timescale: fps` asserts every frame is exactly 1/60 s
        // after the last one. Real captures are not evenly spaced — a scrolling
        // simulator hands over 67-81 changed frames/s in clumps — so the counter
        // drifts away from wall clock and VideoToolbox's real-time rate control
        // is modelling a stream that does not exist. Measured effect: it silently
        // discarded ~25% of accepted frames (the callback fires with a nil sample
        // buffer). Stamping the real capture instant also lets the viewer present
        // on true timing instead of assuming a fixed cadence.
        let pts = CMClockGetTime(CMClockGetHostTimeClock())
        let frameProps: NSDictionary? = forceKeyframe
            ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue!] as NSDictionary
            : nil
        // Property writes and invalidation must not overlap synchronous submission;
        // VideoToolbox's asynchronous output does not take this session lock.
        let status = VTCompressionSessionEncodeFrame(
            session,
            imageBuffer: source,
            presentationTimeStamp: pts,
            duration: .invalid,
            frameProperties: frameProps,
            infoFlagsOut: nil
        ) { [weak self] status, _, sampleBuffer in
            defer { completion?() }
            guard let self else { return }
            guard status == noErr, let sb = sampleBuffer else {
                self.countersLock.lock()
                self.droppedByEncoderCount += 1
                self.nilSampleBufferCount += 1
                self.countersLock.unlock()
                return
            }
            if let encoded = self.extract(from: sb, source: source) {
                self.countersLock.lock()
                self.emittedCount += 1
                self.countersLock.unlock()
                self.onEncoded?(encoded)
            } else {
                self.countersLock.lock()
                self.droppedByEncoderCount += 1
                self.unextractableCount += 1
                self.countersLock.unlock()
            }
        }
        lock.unlock()
        countersLock.lock()
        if status == noErr { submittedCount += 1 } else { submitFailedCount += 1 }
        countersLock.unlock()
        if status != noErr {
            completion?()
        }
    }

    func stop() {
        lock.lock()
        defer { lock.unlock() }
        if let session {
            VTCompressionSessionInvalidate(session)
            self.session = nil
        }
    }

    /// Live-update the target bitrate (and its peak cap). Called by the adaptive
    /// controller as link conditions change. Safe to call between frames.
    func setBitrate(_ bps: Int) {
        lock.lock(); defer { lock.unlock() }
        let clamped = max(80_000, bps)
        // No-op when unchanged — the adaptive controller calls this ~3×/sec and
        // pins at the ceiling on a healthy link, so skip the redundant VT writes.
        guard clamped != bitrate else { return }
        bitrate = clamped
    }

    /// Live-update the max frame QP (sharpness ceiling, 1–51). Lower = sharper
    /// but larger; the controller raises it under congestion to keep frame rate.
    func setMaxQP(_ qp: Int) {
        lock.lock(); defer { lock.unlock() }
        let clamped = min(51, max(1, qp))
        guard clamped != maxQP else { return }
        maxQP = clamped
    }

    // MARK: - private

    private func applyMaxQP(_ qp: Int, to session: VTCompressionSession) {
        if #available(macOS 12.0, *) {
            VTSessionSetProperty(session, key: kVTCompressionPropertyKey_MaxAllowedFrameQP, value: NSNumber(value: qp))
        }
    }

    private func rebuildSession() {
        if let session {
            VTCompressionSessionInvalidate(session)
            self.session = nil
        }

        // Low-latency rate control puts VideoToolbox in its real-time/low-delay
        // pipeline and, crucially, emits a bitstream the *decoder* treats as
        // low-latency (small max_dec_frame_buffering). Without it the decoder
        // fills a large DPB before emitting, adding ~300ms of latency on the
        // client even though the stream carries no B-frames. Falls back to the
        // default spec on the rare hardware that rejects it.
        let lowLatencySpec: NSDictionary = [
            kVTVideoEncoderSpecification_EnableLowLatencyRateControl: kCFBooleanTrue!,
        ]
        var sess: VTCompressionSession?
        func create(spec: CFDictionary?) -> OSStatus {
            VTCompressionSessionCreate(
                allocator: kCFAllocatorDefault,
                width: width, height: height,
                codecType: kCMVideoCodecType_H264,
                encoderSpecification: spec,
                imageBufferAttributes: nil,
                compressedDataAllocator: kCFAllocatorDefault,
                outputCallback: nil,
                refcon: nil,
                compressionSessionOut: &sess
            )
        }
        var status: OSStatus
        var lowLatency = useLowLatencyRateControl
        if useLowLatencyRateControl {
            status = create(spec: lowLatencySpec)
            if status != noErr || sess == nil {
                lowLatency = false
                sess = nil
                status = create(spec: nil)
            }
        } else {
            status = create(spec: nil)
        }
        guard status == noErr, let sess else { return }
        if !lowLatency {
            print("[h264] WARNING: low-latency rate control unavailable; using default spec")
        }

        let props: [(CFString, Any)] = [
            (kVTCompressionPropertyKey_RealTime, kCFBooleanTrue!),
            (kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel),
            (kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse!),
            (kVTCompressionPropertyKey_AverageBitRate, NSNumber(value: bitrate)),
            (kVTCompressionPropertyKey_ExpectedFrameRate, NSNumber(value: expectedFrameRate)),
            // NOTE: deliberately NO kVTCompressionPropertyKey_DataRateLimits. It
            // is a HARD cap over a 1s window; a fast/erratic scroll produces a
            // burst of large frames that blow past it, and VideoToolbox obeys the
            // cap by DELAYING encodes — collapsing the frame rate to single
            // digits. AverageBitRate (soft) lets VT instead raise QP to fit, so a
            // burst stays at 60fps (briefly softer). Bandwidth is bounded by the
            // adaptive AverageBitRate + the per-client send-queue drop policy.
            // Shorter keyframe interval bounds how long a lost reference can
            // ghost before the next self-healing IDR (we also force one on
            // demand from the client now).
            (kVTCompressionPropertyKey_MaxKeyFrameInterval, NSNumber(value: Int(fps) * keyframeIntervalSeconds)),
        ]
        for (key, value) in props {
            VTSessionSetProperty(sess, key: key, value: value as CFTypeRef)
        }
        if let colorMetadata {
            for (key, value) in [
                (kVTCompressionPropertyKey_ColorPrimaries, colorMetadata.primaries),
                (kVTCompressionPropertyKey_TransferFunction, colorMetadata.transfer),
                (kVTCompressionPropertyKey_YCbCrMatrix, colorMetadata.matrix),
            ] {
                if let value { VTSessionSetProperty(sess, key: key, value: value as CFString) }
            }
        }
        // Split the stream into a reference base layer plus disposable
        // enhancement frames, so congestion can shed the enhancement layer
        // without breaking prediction. OFF by default: under RealTime pressure
        // VideoToolbox sheds that layer ITSELF, which pins the delivered rate at
        // the base-layer fraction — measured 60 fps in, ~33 fps out on a 5.7 MP
        // framebuffer. The send queue already drops plain deltas under backlog,
        // so the hierarchy costs frame rate to buy a redundant safety valve.
        if let fraction = baseLayerFrameRateFraction {
            VTSessionSetProperty(
                sess,
                key: kVTCompressionPropertyKey_BaseLayerFrameRateFraction,
                value: NSNumber(value: fraction)
            )
        }
        // Sharpness ceiling for screen-content text; the adaptive controller
        // relaxes this under congestion to protect frame rate over sharpness.
        applyMaxQP(maxQP, to: sess)
        appliedBitrate = bitrate
        appliedMaxQP = maxQP
        VTCompressionSessionPrepareToEncodeFrames(sess)
        session = sess
        stateQueue.sync {
            emittedDescription = false
        }

    }

    private func extract(from sample: CMSampleBuffer, source: CVPixelBuffer) -> Encoded? {
        let isKeyframe = !notSync(sample)
        guard let dataBuf = CMSampleBufferGetDataBuffer(sample) else { return nil }

        var totalLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        guard CMBlockBufferGetDataPointer(
            dataBuf, atOffset: 0, lengthAtOffsetOut: nil,
            totalLengthOut: &totalLength, dataPointerOut: &dataPointer
        ) == noErr, let dataPointer else { return nil }
        let disposable = !isKeyframe && isDroppable(sample)
        let tag: UInt8 = isKeyframe
            ? AVCCEnvelope.keyframeTag
            : (disposable ? AVCCEnvelope.disposableDeltaTag : AVCCEnvelope.deltaTag)
        var envelope = AVCCEnvelope.wrap(
            tag: tag,
            payloadPointer: UnsafeRawPointer(dataPointer),
            payloadCount: totalLength
        )
        if let metadata = CVBufferCopyAttachment(source, "headless-serve-sim.composition" as CFString, nil) as? Data {
            envelope = AVCCEnvelope.wrap(tag: 0x07, payload: metadata) + envelope
        }
        let timestamp = CMTimeConvertScale(CMSampleBufferGetPresentationTimeStamp(sample),
                                           timescale: 1_000_000, method: .default)
        guard timestamp.isNumeric, timestamp.value >= 0 else { return nil }
        let duration = CMTimeConvertScale(CMSampleBufferGetDuration(sample), timescale: 1_000_000, method: .default)
        let sequence = stateQueue.sync { () -> UInt64 in
            encodedSequence &+= 1
            return encodedSequence
        }
        envelope = AVCCEnvelope.timing(timestamp: UInt64(timestamp.value),
            duration: duration.isNumeric && duration.value > 0 ? UInt64(duration.value) : UInt64((1_000_000.0 / Double(fps)).rounded()),
            sequence: sequence) + envelope

        var description: Data?
        if isKeyframe, let format = CMSampleBufferGetFormatDescription(sample) {
            let nextDescription = avcCBlob(from: format)
            let shouldEmit = stateQueue.sync { () -> Bool in
                if emittedDescription { return false }
                emittedDescription = nextDescription != nil
                return nextDescription != nil
            }
            if shouldEmit {
                description = nextDescription
            }
        }
        return Encoded(
            description: description,
            kind: isKeyframe ? .keyframe : .delta,
            envelope: envelope,
            disposable: disposable
        )
    }

    private func notSync(_ sample: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false),
              CFArrayGetCount(attachments) > 0,
              let dict = CFArrayGetValueAtIndex(attachments, 0) else { return false }
        let cfDict = unsafeBitCast(dict, to: CFDictionary.self)
        return CFDictionaryContainsKey(cfDict, Unmanaged.passUnretained(kCMSampleAttachmentKey_NotSync).toOpaque())
    }

    private func isDroppable(_ sample: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false),
              CFArrayGetCount(attachments) > 0,
              let raw = CFArrayGetValueAtIndex(attachments, 0) else { return false }
        let dictionary = unsafeBitCast(raw, to: CFDictionary.self) as NSDictionary
        guard let dependedOn = dictionary[kCMSampleAttachmentKey_IsDependedOnByOthers] as? Bool else {
            return false
        }
        return !dependedOn
    }

    /// Add the VUI output-order bound omitted by the default VT encoder.
    /// Pixels and reference pictures are unchanged; unknown SPS forms pass through.
    static func lowDelaySPS(_ original: Data) -> Data {
        guard original.count >= 4, original[1] == 100 else { return original }
        var rbsp: [UInt8] = [], zeros = 0
        for byte in original {
            if zeros >= 2 && byte == 3 { zeros = 0; continue }
            rbsp.append(byte)
            zeros = byte == 0 ? zeros + 1 : 0
        }
        var bits = rbsp.flatMap { byte in (0..<8).reversed().map { Int((byte >> $0) & 1) } }
        var offset = 32
        func read(_ count: Int = 1) -> Int? {
            guard offset + count <= bits.count else { return nil }
            defer { offset += count }
            return bits[offset..<(offset + count)].reduce(0) { ($0 << 1) | $1 }
        }
        func ue() -> Int? {
            var count = 0
            while let bit = read() {
                if bit == 1 {
                    guard let suffix = read(count) else { return nil }
                    return (1 << count) - 1 + suffix
                }
                count += 1
                if count > 30 { return nil }
            }
            return nil
        }
        guard ue() != nil, ue() == 1, ue() == 0, ue() == 0,
              read() != nil, read() == 0, ue() != nil, let order = ue() else { return original }
        if order == 0 { guard ue() != nil else { return original } }
        else if order != 2 { return original }
        guard let references = ue(), references <= 16, read() != nil,
              ue() != nil, ue() != nil, let frameOnly = read() else { return original }
        if frameOnly == 0 { guard read() != nil else { return original } }
        guard read() != nil, let crop = read() else { return original }
        if crop == 1 { for _ in 0..<4 { guard ue() != nil else { return original } } }
        guard let vui = read() else { return original }
        if vui == 1 {
            guard let aspect = read() else { return original }
            if aspect == 1 {
                guard let id = read(8) else { return original }
                if id == 255 { guard read(32) != nil else { return original } }
            }
            guard let overscan = read() else { return original }
            if overscan == 1 { guard read() != nil else { return original } }
            guard let video = read() else { return original }
            if video == 1 {
                guard read(4) != nil, let color = read() else { return original }
                if color == 1 { guard read(24) != nil else { return original } }
            }
            guard let chroma = read() else { return original }
            if chroma == 1 { guard ue() != nil, ue() != nil else { return original } }
            guard let timing = read() else { return original }
            if timing == 1 { guard read(32) != nil, read(32) != nil, read() != nil else { return original } }
            guard read() == 0, read() == 0, read() != nil, read() == 0 else { return original }
            bits = Array(bits.prefix(offset - 1))
        } else {
            bits = Array(bits.prefix(offset - 1)) + [1, 0, 0, 0, 0, 0, 0, 0, 0]
        }
        bits += [1, 1] // bitstream restriction; motion vectors may cross picture edges.
        for value in [0, 0, 16, 16, 0, max(1, references)] {
            let binary = String(value + 1, radix: 2).map { $0 == "1" ? 1 : 0 }
            bits += Array(repeating: 0, count: binary.count - 1) + binary
        }
        bits.append(1)
        while !bits.count.isMultiple(of: 8) { bits.append(0) }
        var output = Data()
        zeros = 0
        for index in stride(from: 0, to: bits.count, by: 8) {
            let byte = UInt8(bits[index..<(index + 8)].reduce(0) { ($0 << 1) | $1 })
            if zeros >= 2 && byte <= 3 { output.append(3); zeros = 0 }
            output.append(byte)
            zeros = byte == 0 ? zeros + 1 : 0
        }
        return output
    }

    /// avcC parameter-set blob (ISO/IEC 14496-15 §5.2.4.1) carrying SPS + PPS.
    private func avcCBlob(from format: CMFormatDescription) -> Data? {
        var spsCount = 0
        var spsPtr: UnsafePointer<UInt8>?
        var spsSize = 0
        var nalSize: Int32 = 0
        guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format, parameterSetIndex: 0,
            parameterSetPointerOut: &spsPtr, parameterSetSizeOut: &spsSize,
            parameterSetCountOut: &spsCount, nalUnitHeaderLengthOut: &nalSize
        ) == noErr, let spsPtr, spsSize >= 4 else { return nil }

        var ppsPtr: UnsafePointer<UInt8>?
        var ppsSize = 0
        guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format, parameterSetIndex: 1,
            parameterSetPointerOut: &ppsPtr, parameterSetSizeOut: &ppsSize,
            parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil
        ) == noErr, let ppsPtr else { return nil }

        let sps = Self.lowDelaySPS(Data(bytes: spsPtr, count: spsSize))
        let pps = UnsafeBufferPointer(start: ppsPtr, count: ppsSize)
        var blob = Data()
        blob.append(0x01)
        blob.append(sps[1]); blob.append(sps[2]); blob.append(sps[3])
        blob.append(0xFF)
        blob.append(0xE1)
        blob.append(UInt8((sps.count >> 8) & 0xFF)); blob.append(UInt8(sps.count & 0xFF))
        blob.append(contentsOf: sps)
        blob.append(0x01)
        blob.append(UInt8((ppsSize >> 8) & 0xFF)); blob.append(UInt8(ppsSize & 0xFF))
        blob.append(contentsOf: pps)
        return blob
    }
}
