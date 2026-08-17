import CoreVideo
import Foundation
import VideoToolbox

/// Downscales a captured frame before it is encoded.
///
/// The stream was being encoded, transmitted, decoded and drawn at the
/// simulator's native framebuffer size. On an iPad Pro that is 2064x2752 —
/// 5.7 megapixels — while the preview canvas is displayed at roughly 322x429
/// CSS pixels. Measured on a real page: a 2064x2752 canvas backing store for a
/// 322x429 box, i.e. **41x more pixels than the display can show**.
///
/// Every one of those pixels is paid for four times: VideoToolbox encodes them,
/// the socket carries them, the browser's `VideoDecoder` decodes them, and
/// `drawImage` blits them into an oversized canvas that the compositor then has
/// to scale down again. At ~38 fps that is ~216 megapixels/second of decode and
/// the same again of canvas fill, to fill a thumbnail. It is the reason the
/// stream feels less smooth than Simulator.app, which draws its window at the
/// window's own scale and never handles the full framebuffer for display.
///
/// Scaling here costs one hardware pixel-transfer per frame and removes that
/// work from all four stages at once.
///
/// Note this is a DOWNSCALE only: a frame already at or below the cap is passed
/// through untouched, so a small device (a Watch, an iPhone SE) is unaffected
/// and never upscaled.
final class FrameScaler {
    struct Stats {
        let scaled: UInt64
        let passedThrough: UInt64
        let failed: UInt64
        let nanoseconds: UInt64
    }

    /// Longest edge, in pixels, that will be encoded. 1280 keeps a 2064x2752
    /// framebuffer at 960x1280 — still ~3x the pixels the preview shows at its
    /// default size, so there is headroom for a Retina display or an enlarged
    /// panel, while cutting encode/decode work by ~4x.
    private let maxDimension: Int

    private var transferSession: VTPixelTransferSession?
    private var pool: CVPixelBufferPool?
    private var poolWidth = 0
    private var poolHeight = 0

    private let lock = NSLock()
    private var scaledCount: UInt64 = 0
    private var passedThroughCount: UInt64 = 0
    private var failedCount: UInt64 = 0
    private var nanoseconds: UInt64 = 0

    init(maxDimension: Int) {
        self.maxDimension = max(64, maxDimension)
    }

    deinit {
        if let transferSession { VTPixelTransferSessionInvalidate(transferSession) }
    }

    /// The size `source` will be encoded at.
    func targetSize(width: Int, height: Int) -> (width: Int, height: Int) {
        let longest = max(width, height)
        guard longest > maxDimension, longest > 0 else { return (width, height) }
        let scale = Double(maxDimension) / Double(longest)
        // Even dimensions: H.264 chroma is subsampled 2x2, and an odd edge makes
        // VideoToolbox pad, which shows up as a green or smeared final row.
        let w = max(2, (Int((Double(width) * scale).rounded()) / 2) * 2)
        let h = max(2, (Int((Double(height) * scale).rounded()) / 2) * 2)
        return (w, h)
    }

    /// Returns a downscaled copy, or `source` itself when it is already small
    /// enough. A transfer failure also returns `source`: a full-size frame is
    /// far better than a dropped one.
    func scale(_ source: CVPixelBuffer) -> CVPixelBuffer {
        let sourceWidth = CVPixelBufferGetWidth(source)
        let sourceHeight = CVPixelBufferGetHeight(source)
        let target = targetSize(width: sourceWidth, height: sourceHeight)
        guard target.width != sourceWidth || target.height != sourceHeight else {
            lock.lock(); passedThroughCount += 1; lock.unlock()
            return source
        }

        let started = DispatchTime.now().uptimeNanoseconds
        guard preparePool(width: target.width, height: target.height),
              let session = prepareSession(),
              let pool
        else {
            lock.lock(); failedCount += 1; lock.unlock()
            return source
        }

        var destination: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &destination)
                == kCVReturnSuccess,
              let destination
        else {
            lock.lock(); failedCount += 1; lock.unlock()
            return source
        }

        guard VTPixelTransferSessionTransferImage(session, from: source, to: destination) == noErr
        else {
            lock.lock(); failedCount += 1; lock.unlock()
            return source
        }

        lock.lock()
        scaledCount += 1
        nanoseconds &+= DispatchTime.now().uptimeNanoseconds &- started
        lock.unlock()
        return destination
    }

    func stats() -> Stats {
        lock.lock()
        defer { lock.unlock() }
        return Stats(
            scaled: scaledCount,
            passedThrough: passedThroughCount,
            failed: failedCount,
            nanoseconds: nanoseconds
        )
    }

    // MARK: - private

    private func prepareSession() -> VTPixelTransferSession? {
        if let transferSession { return transferSession }
        var session: VTPixelTransferSession?
        guard VTPixelTransferSessionCreate(allocator: kCFAllocatorDefault,
                                           pixelTransferSessionOut: &session) == noErr,
              let session
        else { return nil }
        // Normal copies the full width and height into the destination. Trim and
        // CropSourceToCleanAperture both CROP to fit, which would silently shave
        // the edges off the simulator screen; Letterbox would pad it with black.
        VTSessionSetProperty(session,
                             key: kVTPixelTransferPropertyKey_ScalingMode,
                             value: kVTScalingMode_Normal)
        // Screen content is text and hard edges. The default (Decimate) throws
        // samples away, which aliases small type into noise; Average resamples
        // and keeps it legible at a reduced size.
        VTSessionSetProperty(session,
                             key: kVTPixelTransferPropertyKey_DownsamplingMode,
                             value: kVTDownsamplingMode_Average)
        transferSession = session
        return session
    }

    private func preparePool(width: Int, height: Int) -> Bool {
        if pool != nil, poolWidth == width, poolHeight == height { return true }
        let attributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        var nextPool: CVPixelBufferPool?
        guard CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attributes as CFDictionary, &nextPool)
                == kCVReturnSuccess,
              let nextPool
        else { return false }
        pool = nextPool
        poolWidth = width
        poolHeight = height
        return true
    }
}
