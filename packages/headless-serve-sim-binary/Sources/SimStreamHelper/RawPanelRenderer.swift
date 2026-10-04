import CoreImage
import CoreVideo
import Foundation

@MainActor final class RawPanelRenderer {
    enum RenderError: Error { case invalidFrame, unavailable, outputBuffersBusy }

    private let context = CIContext()
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    private var pool: CVPixelBufferPool?
    private var poolWidth = 0
    private var poolHeight = 0
    private let maximumOutputBuffers: Int

    init(maximumOutputBuffers: Int = 6) {
        self.maximumOutputBuffers = max(1, maximumOutputBuffers)
    }
    private(set) var projectionPieces: [[String: Any]] = []
    private(set) var frameBounds: [Double] = [0, 0, 1, 1]
    private(set) var renderedScale = 0.85
    private(set) var alphaMask = ""

    /// Input is an owned raw BGRA panel. Output stays retained until its encoder completes.
    func render(_ panel: CVPixelBuffer, displayId: Int, rotation: Int, scale: Double = 0.85,
                width: Int = 1280, height: Int = 900, blanked: Bool = false) throws -> CVPixelBuffer {
        guard CVPixelBufferGetPixelFormatType(panel) == kCVPixelFormatType_32BGRA,
              width > 0, height > 0, scale.isFinite, scale > 0 else { throw RenderError.invalidFrame }
        try prepareOutput(width: width, height: height)
        var output: CVPixelBuffer?
        guard let pool,
              CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(nil, pool,
                [kCVPixelBufferPoolAllocationThresholdKey as String: maximumOutputBuffers] as CFDictionary,
                &output) == kCVReturnSuccess, let output else { throw RenderError.outputBuffersBusy }
        let turn = ((rotation % 360) + 360) % 360
        let orientation: CGImagePropertyOrientation
        switch turn {
        case 90: orientation = .right
        case 180: orientation = .down
        case 270: orientation = .left
        default: orientation = .up
        }
        let image = CIImage(cvPixelBuffer: panel, options: [.colorSpace: colorSpace]).oriented(orientation)
        let occupancy = min(0.98, scale)
        let fit = min(Double(width) / image.extent.width, Double(height) / image.extent.height) * occupancy
        let screenWidth = image.extent.width * fit, screenHeight = image.extent.height * fit
        let x = (Double(width) - screenWidth) / 2, y = (Double(height) - screenHeight) / 2
        let content = blanked ? CIImage(color: .black).cropped(to: image.extent) : image
        let screen = content.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
            .transformed(by: CGAffineTransform(scaleX: fit, y: fit))
            .transformed(by: CGAffineTransform(translationX: x, y: y))
        let bounds = CGRect(x: 0, y: 0, width: width, height: height)
        let clear = CIImage(color: .clear).cropped(to: bounds)
        context.render(screen.composited(over: clear), to: output, bounds: bounds, colorSpace: colorSpace)
        CVBufferSetAttachment(output, kCVImageBufferCGColorSpaceKey, colorSpace, .shouldPropagate)
        CVBufferSetAttachment(output, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(output, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_sRGB, .shouldPropagate)
        frameBounds = [x / Double(width), y / Double(height), screenWidth / Double(width), screenHeight / Double(height)]
        let quad = [[0.0, 0.0], [1, 0], [1, 1], [0, 1]].map { point -> [Double] in
            let p: [Double]
            switch turn {
            case 90: p = [1 - point[1], point[0]]
            case 180: p = [1 - point[0], 1 - point[1]]
            case 270: p = [point[1], 1 - point[0]]
            default: p = point
            }
            return [frameBounds[0] + p[0] * frameBounds[2], frameBounds[1] + p[1] * frameBounds[3]]
        }
        projectionPieces = [["displayId": displayId, "quad": quad, "region": [0.0, 0, 1, 1]]]
        let left = frameBounds[0], top = frameBounds[1]
        let right = left + frameBounds[2], bottom = top + frameBounds[3]
        alphaMask = "M\(left) \(top)L\(right) \(top)L\(right) \(bottom)L\(left) \(bottom)Z"
        renderedScale = occupancy
        return output
    }

    private func prepareOutput(width: Int, height: Int) throws {
        if poolWidth == width, poolHeight == height { return }
        let attributes: [String: Any] = [
            kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferMetalCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        var next: CVPixelBufferPool?
        guard CVPixelBufferPoolCreate(nil,
            [kCVPixelBufferPoolMinimumBufferCountKey as String: 3] as CFDictionary,
            attributes as CFDictionary, &next) == kCVReturnSuccess, let next else { throw RenderError.unavailable }
        pool = next
        poolWidth = width
        poolHeight = height
    }
}
