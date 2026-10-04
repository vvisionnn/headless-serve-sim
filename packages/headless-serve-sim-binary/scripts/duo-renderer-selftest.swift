import CoreGraphics
import CoreVideo
import Foundation
import simd

@available(macOS 15.0, *)
@main struct DuoRendererSelfTest {
    private static let colors: [[UInt8]] = [
        [40, 80, 160, 255], [90, 190, 70, 255],
        [170, 60, 30, 255], [150, 150, 150, 255],
    ]

    @MainActor static func main() async throws {
        let center = DuoRenderer.project([0, 0, 0], cameraDistance: 10, fieldOfView: 35, aspect: 2)
        precondition(center == [0.5, 0.5])
        let right = DuoRenderer.project([1, 0, 0], cameraDistance: 10, fieldOfView: 35, aspect: 2)
        let top = DuoRenderer.project([0, 1, 0], cameraDistance: 10, fieldOfView: 35, aspect: 2)
        let near = DuoRenderer.project([1, 0, 2], cameraDistance: 10, fieldOfView: 35, aspect: 2)
        precondition(right[0] > 0.5 && right[1] == 0.5)
        precondition(top[0] == 0.5 && top[1] < 0.5 && near[0] > right[0])
        precondition(abs((0.5 - top[1]) / (right[0] - 0.5) - 2) < 0.00001)
        let bounds = DuoRenderer.bounds(of: [[0.2, 0.3], [0.8, 0.7]])
        precondition(zip(bounds, [0.2, 0.3, 0.6, 0.4]).allSatisfy { abs($0 - $1) < 0.000001 })
        precondition(DuoRenderer.bounds(of: []) == [0, 0, 0, 0])
        print("Projection center, axes, perspective, aspect and bounds passed")
        try testSilhouette()
        for aspect: Float in [0.5, 1, 1280.0 / 900] {
            for rotation: Float in [0, .pi / 4, .pi / 2] {
                let turn = simd_quatf(angle: rotation, axis: [0, 0, 1])
                let corners = [-1.0, 1.0].flatMap { x in [-2.0, 2.0].flatMap { y in [-0.2, 0.2].map { z in
                    turn.act(SIMD3<Float>(Float(x), Float(y), Float(z)))
                } } }
                let distance = DuoRenderer.fittedDistance(points: corners, fieldOfView: 35, aspect: aspect, scale: 2)
                let projected = corners.map { DuoRenderer.project($0, cameraDistance: distance, fieldOfView: 35, aspect: aspect) }
                precondition(projected.allSatisfy { $0.allSatisfy { $0 >= 0.0099 && $0 <= 0.9901 } })
                let fitted = DuoRenderer.bounds(of: projected)
                precondition(abs(max(fitted[2], fitted[3]) - 0.98) < 0.0003)
            }
        }
        print("Perspective camera fit contains depth, portrait and rotated corners; zoom2 clamps passed")

        let sourceURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/SimStreamHelper/DuoRenderer.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)
        precondition(source.contains("\"region\": region") && !source.contains("\"rect\": rect"),
                     "projection producer must emit wire-schema region directly")
        guard CommandLine.arguments.count == 2 else { return }
        let renderer = try await DuoRenderer(modelURL: URL(fileURLWithPath: CommandLine.arguments[1]))
        renderer.update(angle: 180, rotation: 0, width: 3420, height: 3420)
        _ = try await renderer.render(panels: [:])
        precondition(renderer.buttonProjections.count == 3, "Native bezel must project power and both volume buttons")
        for button in renderer.buttonProjections {
            precondition((button["point"] as! [Double]).allSatisfy { $0.isFinite && $0 > 0 && $0 < 1 })
        }
        let openDistance = renderer.cameraDistance
        for angle in [130.0, 90, 45, 0] {
            renderer.update(angle: angle, rotation: 0, width: 3420, height: 3420)
            _ = try await renderer.render(panels: [:])
            precondition(abs(renderer.cameraDistance - openDistance) < 0.001,
                         "Folding must not zoom the native camera at \(angle) degrees")
        }
        print("Fold camera distance stays fixed through inner/cover focus passed")
        renderer.update(angle: 70, rotation: 0)
        _ = try await renderer.render(panels: [:])
        let leafQuads = renderer.projectionPieces.filter { $0["displayId"] as? Int == 3 }
            .map { $0["quad"] as! [[Double]] }
        let widths = leafQuads.map { DuoRenderer.bounds(of: $0)[2] }
        guard abs(widths[0] - widths[1]) < 0.003 else {
            fatalError("balanced fold leaves must have equal projected widths: \(widths)")
        }
        print("Balanced native fold projection passed")
        let cover = makeBuffer(width: 1398, height: 2034)
        let inner = makeBuffer(width: 2007, height: 2853)
        let panels = [1: cover, 3: inner]
        for (angle, rotation) in [(0.0, 0.0), (80, 0), (100, 0), (130, 0), (180, 0),
                                  (180, 90), (180, 180), (180, 270)] {
            renderer.update(angle: angle, rotation: rotation, scale: 1)
            let output = try await renderer.render(panels: panels)
            precondition(CVPixelBufferGetWidth(output) == 1280 && CVPixelBufferGetHeight(output) == 900)
            precondition(CVPixelBufferGetIOSurface(output) != nil)
            precondition(pixel(output, x: 0, y: 0) == [0, 0, 0, 0])
            precondition(renderer.projectionPieces.count == 3)
            precondition(renderer.frameBounds.allSatisfy(\.isFinite))
            precondition(!renderer.alphaMask.isEmpty)
            let path = maskPath(renderer.alphaMask)
            precondition(!path.contains(CGPoint(x: 0, y: 0), using: .evenOdd))
            let pieces = renderer.projectionPieces.filter { $0["displayId"] as? Int == (angle == 0 ? 1 : 3) }
            for piece in pieces {
                let quad = piece["quad"] as! [[Double]], rect = piece["region"] as! [Double]
                for u in [0.25, 0.75] { for v in [0.25, 0.75] {
                    // Interior samples stay away from the crease and rounded corners.
                    let point = (0..<2).map { axis in
                        (1 - v) * ((1 - u) * quad[0][axis] + u * quad[1][axis])
                            + v * ((1 - u) * quad[3][axis] + u * quad[2][axis])
                    }
                    let x = Int(point[0] * Double(CVPixelBufferGetWidth(output)))
                    let y = Int(point[1] * Double(CVPixelBufferGetHeight(output)))
                    let rawX = rect[0] + u * rect[2], rawY = rect[1] + v * rect[3]
                    let expected = colors[(rawY < 0.5 ? 0 : 2) + (rawX < 0.5 ? 0 : 1)]
                    precondition(path.contains(CGPoint(x: point[0], y: point[1]), using: .evenOdd))
                    precondition(piece["slotRotation"] as? Double == (angle == 0 ? 0 : 270))
                    let actual = pixel(output, x: x, y: y)
                    precondition(zip(actual, expected).allSatisfy { abs(Int($0) - Int($1)) <= 2 },
                                 "Projection/color mismatch: angle \(angle), rotation \(rotation), \(actual) != \(expected)")
                } }
            }
        }
        renderer.update(angle: 0, rotation: 0)
        _ = try await renderer.render(panels: panels)
        let coverPiece = renderer.projectionPieces.first { $0["displayId"] as? Int == 1 }!
        let coverQuad = coverPiece["quad"] as! [[Double]]
        let midpoint = (0..<2).map { axis in coverQuad.reduce(0) { $0 + $1[axis] } / 4 }
        var blanked: CVPixelBuffer? = try await renderer.render(panels: panels, blankedDisplays: [1])
        let sampleX = Int(midpoint[0] * Double(CVPixelBufferGetWidth(blanked!)))
        let sampleY = Int(midpoint[1] * Double(CVPixelBufferGetHeight(blanked!)))
        guard pixel(blanked!, x: sampleX, y: sampleY).prefix(3).allSatisfy({ $0 == 0 }) else {
            fatalError("inactive-on cover must render black, not cached lock screen pixels")
        }
        blanked = nil
        _ = try await renderer.render(panels: panels)
        print("Native fold/roll, projection-to-raw correspondence, sRGB swatches and alpha passed")
        var largestMask = 0
        for angle in [0.0, 45, 90, 130, 180] {
            for rotation in [0.0, 45, 90, 135] {
                renderer.update(angle: angle, rotation: rotation)
                _ = try await renderer.render(panels: [:])
                let bounds = renderer.frameBounds
                precondition(bounds[0] > 0 && bounds[1] > 0 && bounds[0] + bounds[2] < 1 && bounds[1] + bounds[3] < 1)
                if angle == 180 { precondition(max(bounds[2], bounds[3]) > 0.80) }
                precondition(renderer.renderedScale == 0.85)
                largestMask = max(largestMask, renderer.alphaMask.utf8.count)
            }
        }
        print("Open 0.85 fit fills >80% and all folds stay inside output; largest SVG mask \(largestMask) bytes")
        for angle in [0.0, 90, 180] { for rotation in [0.0, 45, 90] {
            renderer.update(angle: angle, rotation: rotation, scale: 2)
            _ = try await renderer.render(panels: [:])
            let bounds = renderer.frameBounds
            precondition(bounds[0] >= 0.009 && bounds[1] >= 0.009)
            precondition(bounds[0] + bounds[2] <= 0.991 && bounds[1] + bounds[3] <= 0.991)
            precondition(renderer.renderedScale == 0.98)
        } }
        print("Native zoom2 clamped at 0.98 without shell clipping passed")

        let held = try await renderer.render(panels: [:])
        let before = bytes(held)
        for angle in [0.0, 130, 180] {
            renderer.update(angle: angle, rotation: 0, scale: 1)
            _ = try await renderer.render(panels: [:])
        }
        precondition(bytes(held) == before)
        var additional: [CVPixelBuffer] = []
        // Three encodes + pending + JPEG + a replacement must all fit without
        // ever recycling a buffer still retained by an encoder.
        for _ in 0..<5 { additional.append(try await renderer.render(panels: [:])) }
        do {
            _ = try await renderer.render(panels: [:])
            preconditionFailure("Retained output exceeded the bounded pool")
        } catch DuoRenderer.RenderError.outputBuffersBusy {}
        additional.removeAll()
        _ = try await renderer.render(panels: [:])
        withExtendedLifetime(held) {}
        print("Held output immutability, six-buffer ownership budget and released-buffer reuse passed")

        renderer.update(angle: 180, rotation: 0, scale: 1.1, width: 640, height: 480)
        let resized = try await renderer.render(panels: [:])
        precondition(CVPixelBufferGetWidth(resized) == 640 && CVPixelBufferGetHeight(resized) == 480)
        precondition(renderer.frameBounds.allSatisfy(\.isFinite))
        print("Output resize and camera zoom passed")

        let smallCover = makeBuffer(width: 96, height: 144)
        let smallInner = makeBuffer(width: 128, height: 192)
        _ = try await renderer.render(panels: [1: smallCover, 3: smallInner])
        _ = try await renderer.render(panels: panels)
        print("Panel texture resize and original-size restoration passed")
    }

    private static func maskPath(_ string: String) -> CGPath {
        let path = CGMutablePath()
        for contour in string.split(separator: "Z") {
            for (index, pair) in contour.dropFirst().split(separator: "L").enumerated() {
                let values = pair.split(separator: " ").map { Double($0)! }
                let point = CGPoint(x: values[0], y: values[1])
                if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
            path.closeSubpath()
        }
        return path
    }

    private static func testSilhouette() throws {
        let buffer = makeBuffer(width: 12, height: 10)
        precondition(CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess)
        let base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        for y in 0..<10 { for x in 0..<12 {
            let outer = x >= 1 && x < 9 && y >= 1 && y < 9
            let hole = x >= 4 && x < 6 && y >= 4 && y < 6
            let island = x == 10 && y == 0
            base[y * stride + x * 4 + 3] = (outer && !hole) || island ? 255 : 0
        } }
        CVPixelBufferUnlockBaseAddress(buffer, [])
        let silhouette = try DuoRenderer.silhouette(buffer)
        let path = maskPath(silhouette.path)
        for y in 0..<10 { for x in 0..<12 {
            let expected = pixel(buffer, x: x, y: y)[3] >= 128
            precondition(path.contains(CGPoint(x: (Double(x) + 0.5) / 12,
                                              y: (Double(y) + 0.5) / 10), using: .evenOdd) == expected)
        } }
        precondition(silhouette.bounds == [1.0 / 12, 0, 10.0 / 12, 0.9])
        precondition(CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess)
        for y in 0..<10 { for x in 0..<12 { base[y * stride + x * 4 + 3] = 0 } }
        base[2 * stride + 2 * 4 + 3] = 128
        base[3 * stride + 3 * 4 + 3] = 255
        CVPixelBufferUnlockBaseAddress(buffer, [])
        let diagonal = try DuoRenderer.silhouette(buffer)
        let diagonalPath = maskPath(diagonal.path)
        precondition(diagonal.path.filter { $0 == "M" }.count == 2)
        precondition(diagonalPath.contains(CGPoint(x: 2.5 / 12, y: 2.5 / 10), using: .evenOdd))
        precondition(diagonalPath.contains(CGPoint(x: 3.5 / 12, y: 3.5 / 10), using: .evenOdd))
        precondition(CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess)
        base[2 * stride + 2 * 4 + 3] = 0
        base[3 * stride + 3 * 4 + 3] = 0
        CVPixelBufferUnlockBaseAddress(buffer, [])
        let empty = try DuoRenderer.silhouette(buffer)
        precondition(empty.path.isEmpty)
        let diagonalBuffer = makeBuffer(width: 1280, height: 900)
        precondition(CVPixelBufferLockBaseAddress(diagonalBuffer, []) == kCVReturnSuccess)
        let diagonalBase = CVPixelBufferGetBaseAddress(diagonalBuffer)!.assumingMemoryBound(to: UInt8.self)
        let diagonalStride = CVPixelBufferGetBytesPerRow(diagonalBuffer)
        for y in 0..<900 { for x in 0..<1280 {
            diagonalBase[y * diagonalStride + x * 4 + 3] = x > y && x < y + 200 ? 255 : 0
        } }
        CVPixelBufferUnlockBaseAddress(diagonalBuffer, [])
        _ = try DuoRenderer.silhouette(diagonalBuffer)
        let started = ProcessInfo.processInfo.systemUptime
        for _ in 0..<10 { _ = try DuoRenderer.silhouette(diagonalBuffer) }
        let mean = (ProcessInfo.processInfo.systemUptime - started) / 10
        precondition(mean < 0.008, "Diagonal native mask exceeds 8ms frame budget: \(mean * 1000)ms")
        print("Alpha contour bounds, islands, hole, empty mask and diagonal frame budget passed")
        for testWidth in [15, 16, 17, 31, 32, 33, 65] {
            let testHeight = 23, randomBuffer = makeBuffer(width: testWidth, height: testHeight)
            precondition(CVPixelBufferLockBaseAddress(randomBuffer, []) == kCVReturnSuccess)
            let randomBase = CVPixelBufferGetBaseAddress(randomBuffer)!.assumingMemoryBound(to: UInt8.self)
            let randomStride = CVPixelBufferGetBytesPerRow(randomBuffer)
            var state = UInt64(testWidth), expected: [Bool] = []
            for y in 0..<testHeight { for x in 0..<testWidth {
                state = state &* 6364136223846793005 &+ 1
                let filled = state >> 62 != 0
                expected.append(filled)
                randomBase[y * randomStride + x * 4 + 3] = filled ? 128 : 127
            } }
            CVPixelBufferUnlockBaseAddress(randomBuffer, [])
            let randomPath = maskPath(try DuoRenderer.silhouette(randomBuffer).path)
            for y in 0..<testHeight { for x in 0..<testWidth {
                precondition(randomPath.contains(CGPoint(x: (Double(x) + 0.5) / Double(testWidth),
                                                        y: (Double(y) + 0.5) / Double(testHeight)), using: .evenOdd) == expected[y * testWidth + x],
                             "SIMD contour changed pixel occupancy at \(testWidth): \(x),\(y)")
            } }
        }
        print("Every pixel center preserved across SIMD tails, alpha threshold, holes and diagonal islands")
        let nativeBuffer = makeBuffer(width: 3420, height: 3420)
        for diagonal in [false, true] {
            precondition(CVPixelBufferLockBaseAddress(nativeBuffer, []) == kCVReturnSuccess)
            let nativeBase = CVPixelBufferGetBaseAddress(nativeBuffer)!.assumingMemoryBound(to: UInt8.self)
            let nativeStride = CVPixelBufferGetBytesPerRow(nativeBuffer)
            for y in 0..<3420 { for x in 0..<3420 {
                let filled = diagonal ? x > y / 2 && x < y / 2 + 1600 : x >= 100 && x < 3320 && y >= 100 && y < 3320
                let hole = x >= 1400 && x < 1600 && y >= 1400 && y < 1600
                nativeBase[y * nativeStride + x * 4 + 3] = filled && !hole ? 128 : 127
            } }
            CVPixelBufferUnlockBaseAddress(nativeBuffer, [])
            let nativeMask = try DuoRenderer.silhouette(nativeBuffer)
            let nativePath = maskPath(nativeMask.path)
            for y in Swift.stride(from: 0, to: 3420, by: 23) { for x in Swift.stride(from: 0, to: 3420, by: 23) {
                let filled = diagonal ? x > y / 2 && x < y / 2 + 1600 : x >= 100 && x < 3320 && y >= 100 && y < 3320
                let hole = x >= 1400 && x < 1600 && y >= 1400 && y < 1600
                precondition(nativePath.contains(CGPoint(x: (Double(x) + 0.5) / 3420,
                                                        y: (Double(y) + 0.5) / 3420), using: .evenOdd) == (filled && !hole))
            } }
            let nativeStarted = ProcessInfo.processInfo.systemUptime
            for _ in 0..<10 { _ = try DuoRenderer.silhouette(nativeBuffer) }
            let nativeMean = (ProcessInfo.processInfo.systemUptime - nativeStarted) / 10
            print("Native 3420 square mask \(diagonal ? "diagonal" : "rectangle") mean: \(nativeMean * 1000)ms")
            precondition(nativeMean < 0.008, "Native-density mask exceeds 8ms frame budget")
        }
    }

    private static func makeBuffer(width: Int, height: Int) -> CVPixelBuffer {
        let attributes: [String: Any] = [
            kCVPixelBufferMetalCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        var output: CVPixelBuffer?
        precondition(CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32BGRA,
                                        attributes as CFDictionary, &output) == kCVReturnSuccess)
        let buffer = output!
        precondition(CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess)
        let base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        for y in 0..<height { for x in 0..<width {
            let color = colors[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)]
            for channel in 0..<4 { base[y * stride + x * 4 + channel] = color[channel] }
        } }
        CVPixelBufferUnlockBaseAddress(buffer, [])
        return buffer
    }

    private static func pixel(_ buffer: CVPixelBuffer, x: Int, y: Int) -> [UInt8] {
        precondition(x >= 0 && y >= 0 && x < CVPixelBufferGetWidth(buffer) && y < CVPixelBufferGetHeight(buffer))
        precondition(CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
        let offset = y * CVPixelBufferGetBytesPerRow(buffer) + x * 4
        return Array(UnsafeBufferPointer(start: base + offset, count: 4))
    }

    private static func bytes(_ buffer: CVPixelBuffer) -> Data {
        precondition(CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        return Data(bytes: CVPixelBufferGetBaseAddress(buffer)!,
                    count: CVPixelBufferGetBytesPerRow(buffer) * CVPixelBufferGetHeight(buffer))
    }
}
