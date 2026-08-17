import CoreVideo
import Foundation

/// Self-test for the encode-time downscale.
///
/// The properties that matter are the ones that would silently damage the image
/// rather than fail loudly: cropping instead of scaling, upscaling a small
/// device, or producing odd dimensions that H.264 chroma cannot represent.
@main
private enum FrameScalerSelftest {
    static func buffer(_ width: Int, _ height: Int) -> CVPixelBuffer {
        var out: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
            [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &out
        )
        precondition(status == kCVReturnSuccess, "failed to allocate \(width)x\(height)")
        return out!
    }

    static func main() {
        capsTheLongEdge()
        preservesAspectRatio()
        neverUpscales()
        alwaysEven()
        scalesARealBuffer()
        passesThroughASmallBuffer()
        print("FrameScaler self-test passed")
    }

    /// An iPad Pro framebuffer is brought under the cap.
    static func capsTheLongEdge() {
        let scaler = FrameScaler(maxDimension: 1280)
        let target = scaler.targetSize(width: 2064, height: 2752)
        precondition(max(target.width, target.height) == 1280,
                     "long edge must equal the cap, got \(target)")
        precondition(target == (960, 1280), "expected 960x1280, got \(target)")
    }

    /// Landscape and portrait both keep their shape — a crop would not.
    static func preservesAspectRatio() {
        let scaler = FrameScaler(maxDimension: 1280)
        for (w, h) in [(2064, 2752), (2752, 2064), (1179, 2556)] {
            let target = scaler.targetSize(width: w, height: h)
            let sourceRatio = Double(w) / Double(h)
            let targetRatio = Double(target.width) / Double(target.height)
            precondition(abs(sourceRatio - targetRatio) < 0.01,
                         "aspect drifted for \(w)x\(h): \(target)")
        }
    }

    /// A device already smaller than the cap is passed through untouched.
    static func neverUpscales() {
        let scaler = FrameScaler(maxDimension: 1280)
        precondition(scaler.targetSize(width: 396, height: 484) == (396, 484))
        precondition(scaler.targetSize(width: 1280, height: 720) == (1280, 720))
    }

    /// Odd dimensions make VideoToolbox pad the chroma planes, which shows as a
    /// smeared or green final row.
    static func alwaysEven() {
        for cap in [200, 641, 1000, 1281] {
            let scaler = FrameScaler(maxDimension: cap)
            for (w, h) in [(2064, 2752), (1179, 2556), (2752, 2064)] {
                let target = scaler.targetSize(width: w, height: h)
                precondition(target.width % 2 == 0 && target.height % 2 == 0,
                             "odd dimension at cap \(cap): \(target)")
            }
        }
    }

    /// End to end through VTPixelTransferSession, not just the arithmetic.
    static func scalesARealBuffer() {
        let scaler = FrameScaler(maxDimension: 1280)
        let scaled = scaler.scale(buffer(2064, 2752))
        precondition(CVPixelBufferGetWidth(scaled) == 960,
                     "got width \(CVPixelBufferGetWidth(scaled))")
        precondition(CVPixelBufferGetHeight(scaled) == 1280,
                     "got height \(CVPixelBufferGetHeight(scaled))")
        precondition(scaler.stats().scaled == 1)
        precondition(scaler.stats().failed == 0)
    }

    /// A small frame comes back as the SAME buffer — no pool churn, no copy.
    static func passesThroughASmallBuffer() {
        let scaler = FrameScaler(maxDimension: 1280)
        let source = buffer(396, 484)
        let result = scaler.scale(source)
        precondition(result === source, "small frames must pass through untouched")
        precondition(scaler.stats().passedThrough == 1)
        precondition(scaler.stats().scaled == 0)
    }
}
