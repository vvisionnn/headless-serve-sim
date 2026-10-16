import Foundation

/// The composed Duo frame is square so fold and rotation never change its size.
/// Its side follows the largest viewer instead of native panel density: pixels
/// the browser would only scale away still cost encode, transport and decode.
enum DuoOutput {
    static let minimumSide = 512
    static let defaultSide = 1536
    /// H.264 level 5.1/5.2 limit (36864 macroblocks); beyond it the low-latency
    /// encoder emits nothing.
    static let maximumSide = 3072
    private static let step = 128

    /// Rounds up to a coarse step so window resizes rarely rebuild the encoder.
    static func side(requested: Int?) -> Int {
        guard let requested else { return defaultSide }
        let rounded = (requested + step - 1) / step * step
        return min(maximumSide, max(minimumSide, rounded))
    }

    static func renderScale(for _: Double) -> Double { 0.85 }
}
