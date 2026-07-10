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
        /// Length-prefixed AVCC NAL bytes (not Annex-B start codes).
        let avcc: Data
        enum Kind { case keyframe, delta }
    }

    var onEncoded: ((Encoded) -> Void)?

    private let lock = NSLock()
    private var session: VTCompressionSession?
    private var width: Int32 = 0
    private var height: Int32 = 0
    private let fps: Int32
    private var bitrate: Int
    private var maxQP: Int
    private let keyframeIntervalSeconds: Int
    private let stateQueue = DispatchQueue(label: "H264Encoder.state")
    private var emittedDescription = false
    private var frameCount: Int64 = 0

    init(fps: Int = 60, bitrate: Int = 8_000_000, maxQP: Int = 48, keyframeIntervalSeconds: Int = 2) {
        self.fps = Int32(fps)
        self.bitrate = bitrate
        self.maxQP = maxQP
        self.keyframeIntervalSeconds = keyframeIntervalSeconds
    }

    deinit {
        if let session { VTCompressionSessionInvalidate(session) }
    }

    /// Submit a frame. Returns immediately; `onEncoded` fires on VT's queue.
    func encode(_ source: CVPixelBuffer, forceKeyframe: Bool = false, completion: (() -> Void)? = nil) {
        lock.lock()
        let w = Int32(CVPixelBufferGetWidth(source))
        let h = Int32(CVPixelBufferGetHeight(source))
        if session == nil || w != width || h != height {
            width = w
            height = h
            rebuildSession()
        }
        guard let session else {
            lock.unlock()
            completion?()
            return
        }

        frameCount += 1
        let pts = CMTime(value: frameCount, timescale: fps)
        let frameProps: NSDictionary? = forceKeyframe
            ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue!] as NSDictionary
            : nil
        lock.unlock()

        let status = VTCompressionSessionEncodeFrame(
            session,
            imageBuffer: source,
            presentationTimeStamp: pts,
            duration: .invalid,
            frameProperties: frameProps,
            infoFlagsOut: nil
        ) { [weak self] status, _, sampleBuffer in
            defer { completion?() }
            guard let self, status == noErr, let sb = sampleBuffer else { return }
            if let encoded = self.extract(from: sb) { self.onEncoded?(encoded) }
        }
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
        guard let session else { return }
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: NSNumber(value: clamped))
    }

    /// Live-update the max frame QP (sharpness ceiling, 1–51). Lower = sharper
    /// but larger; the controller raises it under congestion to keep frame rate.
    func setMaxQP(_ qp: Int) {
        lock.lock(); defer { lock.unlock() }
        let clamped = min(51, max(1, qp))
        guard clamped != maxQP else { return }
        maxQP = clamped
        guard let session else { return }
        applyMaxQP(clamped, to: session)
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
        var status = create(spec: lowLatencySpec)
        var lowLatency = true
        if status != noErr || sess == nil {
            lowLatency = false
            sess = nil
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
            (kVTCompressionPropertyKey_ExpectedFrameRate, NSNumber(value: fps)),
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
        // Sharpness ceiling for screen-content text; the adaptive controller
        // relaxes this under congestion to protect frame rate over sharpness.
        applyMaxQP(maxQP, to: sess)
        VTCompressionSessionPrepareToEncodeFrames(sess)
        session = sess
        stateQueue.sync {
            emittedDescription = false
        }

    }

    private func extract(from sample: CMSampleBuffer) -> Encoded? {
        let isKeyframe = !notSync(sample)
        guard let dataBuf = CMSampleBufferGetDataBuffer(sample) else { return nil }

        var totalLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        guard CMBlockBufferGetDataPointer(
            dataBuf, atOffset: 0, lengthAtOffsetOut: nil,
            totalLengthOut: &totalLength, dataPointerOut: &dataPointer
        ) == noErr, let dataPointer else { return nil }
        let avcc = Data(bytes: dataPointer, count: totalLength)

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
        return Encoded(description: description, kind: isKeyframe ? .keyframe : .delta, avcc: avcc)
    }

    private func notSync(_ sample: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false),
              CFArrayGetCount(attachments) > 0,
              let dict = CFArrayGetValueAtIndex(attachments, 0) else { return false }
        let cfDict = unsafeBitCast(dict, to: CFDictionary.self)
        return CFDictionaryContainsKey(cfDict, Unmanaged.passUnretained(kCMSampleAttachmentKey_NotSync).toOpaque())
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

        let sps = UnsafeBufferPointer(start: spsPtr, count: spsSize)
        let pps = UnsafeBufferPointer(start: ppsPtr, count: ppsSize)
        var blob = Data()
        blob.append(0x01)
        blob.append(sps[1]); blob.append(sps[2]); blob.append(sps[3])
        blob.append(0xFF)
        blob.append(0xE1)
        blob.append(UInt8((spsSize >> 8) & 0xFF)); blob.append(UInt8(spsSize & 0xFF))
        blob.append(contentsOf: sps)
        blob.append(0x01)
        blob.append(UInt8((ppsSize >> 8) & 0xFF)); blob.append(UInt8(ppsSize & 0xFF))
        blob.append(contentsOf: pps)
        return blob
    }
}
