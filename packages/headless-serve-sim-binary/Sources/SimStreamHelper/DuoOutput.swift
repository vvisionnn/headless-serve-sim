import Foundation

/// The composed Duo frame is square so fold and rotation never change its size.
/// Its side follows the largest viewer instead of native panel density: pixels
/// the browser would only scale away still cost encode, transport and decode.
enum DuoOutput {
    static let minimumSide = 512
    static let defaultSide = 1536
    /// Low-latency H.264 on Apple silicon takes at most a 4K UHD frame
    /// (8,294,400 px, 2880²); past it VideoToolbox accepts every frame and
    /// emits nothing, so a large Retina window froze the stream.
    static let maximumSide = 2880
    private static let step = 128

    /// Rounds up to a coarse step so window resizes rarely rebuild the encoder.
    static func side(requested: Int?) -> Int {
        guard let requested else { return defaultSide }
        let rounded = (requested + step - 1) / step * step
        return min(maximumSide, max(minimumSide, rounded))
    }

    static func renderScale(for _: Double) -> Double { 0.85 }
}
