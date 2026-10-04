import CoreGraphics
import CoreVideo
import Foundation

@main struct RawPanelRendererSelftest {
    @MainActor static func main() throws {
        let renderer = RawPanelRenderer(maximumOutputBuffers: 3)
        let panel = makePanel()
        let input = bytes(panel)
        for rotation in [0, 90, 180, 270] {
            let output = try renderer.render(panel, displayId: 3, rotation: rotation)
            precondition(CVPixelBufferGetWidth(output) == 1280 && CVPixelBufferGetHeight(output) == 900,
                         "Screen-only output must keep the bounded composition dimensions")
            precondition(CVPixelBufferGetIOSurface(output) != nil)
            precondition(pixel(output, x: 0, y: 0) == [0, 0, 0, 0], "Letterbox must stay transparent")
            let piece = renderer.projectionPieces[0]
            precondition(piece["displayId"] as? Int == 3 && piece["region"] as? [Double] == [0, 0, 1, 1])
            let quad = piece["quad"] as! [[Double]]
            for (u, v, expected) in [(0.25, 0.25, [40, 80, 160, 255]), (0.75, 0.25, [90, 190, 70, 255]),
                                     (0.25, 0.75, [170, 60, 30, 255]), (0.75, 0.75, [150, 150, 150, 255])] {
                let point = (0..<2).map { axis in
                    (1-u)*(1-v)*quad[0][axis] + u*(1-v)*quad[1][axis]
                        + u*v*quad[2][axis] + (1-u)*v*quad[3][axis]
                }
                let actual = pixel(output, x: Int(point[0] * 1280), y: Int(point[1] * 900))
                precondition(zip(actual, expected).allSatisfy { abs(Int($0)-$1) <= 1 },
                             "Raw pixel projection/color mismatch at \(rotation): \(actual) != \(expected)")
            }
            precondition(!renderer.alphaMask.isEmpty && renderer.frameBounds.allSatisfy(\.isFinite))
            let bounds = renderer.frameBounds
            precondition(abs(max(bounds[2], bounds[3]) - 0.85) < 0.000001)
            precondition(bytes(panel) == input, "Composition changed its owned input")
            let blanked = try renderer.render(panel, displayId: 3, rotation: rotation, blanked: true)
            precondition(pixel(blanked, x: 640, y: 450) == [0, 0, 0, 255],
                         "Display-off must not show the cached raw panel at \(rotation)")
            precondition(renderer.frameBounds == bounds, "Blanking changed screen geometry")
            precondition(pixel(blanked, x: 0, y: 0) == [0, 0, 0, 0], "Blanking filled transparent padding")
            let awake = try renderer.render(panel, displayId: 3, rotation: rotation)
            precondition(pixel(awake, x: 640, y: 450) == pixel(output, x: 640, y: 450),
                         "Wake must restore the unchanged raw panel")
            precondition(bytes(panel) == input, "Blanking changed its owned input")
        }
        let held = try renderer.render(panel, displayId: 1, rotation: 0)
        let previous = bytes(held)
        var others: [CVPixelBuffer] = []
        for rotation in [90, 180] { others.append(try renderer.render(panel, displayId: 1, rotation: rotation)) }
        do {
            _ = try renderer.render(panel, displayId: 1, rotation: 270)
            preconditionFailure("Screen-only output exceeded the three-buffer pool")
        } catch RawPanelRenderer.RenderError.outputBuffersBusy {}
        precondition(bytes(held) == previous, "Retained output was recycled")
        others.removeAll()
        _ = try renderer.render(panel, displayId: 1, rotation: 270, scale: 2)
        precondition(renderer.renderedScale == 0.98)
        let small = try renderer.render(panel, displayId: 1, rotation: 0, width: 640, height: 480)
        precondition(CVPixelBufferGetWidth(small) == 640 && CVPixelBufferGetHeight(small) == 480)
        withExtendedLifetime(held) {}
        let productionPool = RawPanelRenderer()
        var inFlightAndPending: [CVPixelBuffer] = []
        for _ in 0..<3 { inFlightAndPending.append(try productionPool.render(panel, displayId: 3, rotation: 0)) }
        for rotation in [90, 180, 270] {
            do {
                inFlightAndPending.append(try productionPool.render(panel, displayId: 3, rotation: rotation))
            } catch {
                preconditionFailure("in-flight encodes must leave room for pending/JPEG/replacement output: \(error)")
            }
        }
        do {
            _ = try productionPool.render(panel, displayId: 3, rotation: 0)
            preconditionFailure("encoder ownership budget must stay bounded at six outputs")
        } catch RawPanelRenderer.RenderError.outputBuffersBusy {}
        inFlightAndPending.removeLast()
        let replacement = try productionPool.render(panel, displayId: 3, rotation: 0)
        precondition(CVPixelBufferGetWidth(replacement) == 1280)
        withExtendedLifetime(inFlightAndPending) {}
        let sourceURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/SimStreamHelper/main.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)
        precondition(source.contains("ownedFrameHandler(buffer"),
                     "independently owned composition must not re-enter the recycled-framebuffer snapshot boundary")
        print("Raw panel renderer rotation, projection, sRGB, transparent fit and bounded ownership passed")
    }

    private static func makePanel() -> CVPixelBuffer {
        var buffer: CVPixelBuffer?
        precondition(CVPixelBufferCreate(nil, 24, 36, kCVPixelFormatType_32BGRA,
            [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary, &buffer) == kCVReturnSuccess)
        let panel = buffer!
        precondition(CVPixelBufferLockBaseAddress(panel, []) == kCVReturnSuccess)
        let base = CVPixelBufferGetBaseAddress(panel)!.assumingMemoryBound(to: UInt8.self)
        let stride = CVPixelBufferGetBytesPerRow(panel)
        let colors: [[UInt8]] = [[40, 80, 160, 255], [90, 190, 70, 255], [170, 60, 30, 255], [150, 150, 150, 255]]
        for y in 0..<36 { for x in 0..<24 {
            let color = colors[(y < 18 ? 0 : 2) + (x < 12 ? 0 : 1)]
            for channel in 0..<4 { base[y*stride+x*4+channel] = color[channel] }
        } }
        CVPixelBufferUnlockBaseAddress(panel, [])
        return panel
    }

    private static func pixel(_ buffer: CVPixelBuffer, x: Int, y: Int) -> [UInt8] {
        precondition(CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
        return Array(UnsafeBufferPointer(start: base+y*CVPixelBufferGetBytesPerRow(buffer)+x*4, count: 4))
    }

    private static func bytes(_ buffer: CVPixelBuffer) -> Data {
        precondition(CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        return Data(bytes: CVPixelBufferGetBaseAddress(buffer)!, count: CVPixelBufferGetBytesPerRow(buffer)*CVPixelBufferGetHeight(buffer))
    }
}
