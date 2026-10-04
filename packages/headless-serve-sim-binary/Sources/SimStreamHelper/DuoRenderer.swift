// Copyright 2026 Evan Bacon
// SPDX-License-Identifier: Apache-2.0
// Fold pose, UV skin projection and color conversion adapted from EvanBacon/serve-sim,
// commit 0eac9ed32a6df06384dd3967fe89868ec9bf6da9. See the repository LICENSE.
// Modified for owned pixel-buffer input, persistent textures and bounded codec output.

import CoreImage
import CoreVideo
import Foundation
import Metal
import RealityKit
import simd

@available(macOS 15.0, *)
@MainActor final class DuoRenderer {
    enum RenderError: Error {
        case unavailable, invalidModel, invalidFrame, renderInProgress, outputBuffersBusy
    }

    private struct Screen {
        let entity: ModelEntity
        let material: Int
        var texture: LowLevelTexture
        var uploadTexture: any MTLTexture
        var width: Int
        var height: Int
        var lastFrame: CVPixelBuffer?
        var blanked = false
        let projection: ScreenProjection
    }

    private struct Pose: Equatable {
        var angle: Double = 0
        var rotation: Double = 0
        var yaw: Double = 0
        var scale: Double = 0.85
        var width = 1280
        var height = 900
    }

    private let device: any MTLDevice
    private let commandQueue: any MTLCommandQueue
    private let textureCache: CVMetalTextureCache
    private let context: CIContext
    private let renderer: RealityRenderer
    private let controller: AnimationPlaybackController
    private let rest = Entity()
    private let wrapper = Entity()
    private let camera = PerspectiveCamera()
    private let frameGeometry: [FrameProjection]
    private let buttons: [ButtonProjection]
    private var fittedPose: Pose?
    private var openGeometry: [SIMD3<Float>] = []
    private(set) var cameraDistance: Float = 1
    private var screens: [Int: Screen]
    private var pose = Pose()
    private var lastAngle: Double = .nan
    private var maskPose: Pose?
    private var rendering = false
    private var target: (texture: any MTLTexture, output: RealityRenderer.CameraOutput)?
    private var pool: CVPixelBufferPool?
    private var poolWidth = 0
    private var poolHeight = 0
    // Device Hub's cited 36 mm sensor, with upstream's longer 200 mm lens.
    private let fieldOfView: Float = 2 * atan(36 / (2 * 200.0)) * 180 / .pi
    private let outputColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    /// Metadata describes the last completed frame, never the pending pose.
    private(set) var projectionPieces: [[String: Any]] = []
    private(set) var buttonProjections: [[String: Any]] = []
    private(set) var frameBounds: [Double] = [0, 0, 0, 0]
    private(set) var renderedScale: Double = 0.85
    /// SVG path in normalized output coordinates; use clipPathUnits="objectBoundingBox".
    private(set) var alphaMask = ""

    init(modelURL: URL) async throws {
        guard let device = MTLCreateSystemDefaultDevice(),
              let commandQueue = device.makeCommandQueue() else { throw RenderError.unavailable }
        self.device = device
        self.commandQueue = commandQueue
        var cache: CVMetalTextureCache?
        guard CVMetalTextureCacheCreate(nil, nil, device, nil, &cache) == kCVReturnSuccess,
              let cache else { throw RenderError.unavailable }
        textureCache = cache
        context = CIContext(mtlDevice: device)
        renderer = try RealityRenderer()
        let catalog = try await Entity.ConfigurationCatalog(from: modelURL)
        let loaded = try await Entity(from: catalog, configurations: ["color": "Dark"])
        let subject = loaded.findEntity(named: "root") ?? loaded
        guard let clip = subject.availableAnimations.first(where: { $0.name == "book_close" && $0.definition.duration.isFinite }),
              let cover = Self.screen(in: subject, named: "YqugYDOqMSOpqyA"),
              let inner = Self.screen(in: subject, named: "CvyXbAGXoolRUYl") else {
            throw RenderError.invalidModel
        }
        DuoShellMaterials.apply(to: subject)
        try Self.rotateInnerUVs(on: inner.0, material: inner.1)
        screens = [:]
        for (id, slot, width, height) in [(1, cover, 1398, 2034), (3, inner, 2007, 2853)] {
            let texture = try Self.makeScreenTexture(width: width, height: height)
            let projection = try ScreenProjection(slot: slot, inner: id == 3)
            screens[id] = Screen(entity: slot.0, material: slot.1, texture: texture,
                                 uploadTexture: try Self.makeUploadTexture(device: device, width: width, height: height),
                                 width: width, height: height, projection: projection)
            var material = UnlitMaterial(applyPostProcessToneMap: false)
            material.color = .init(tint: .white, texture: .init(try await TextureResource(from: texture)))
            slot.0.model!.materials[slot.1] = material
        }
        subject.removeFromParent()
        rest.addChild(subject)
        wrapper.addChild(rest)
        rest.orientation = simd_quatf(angle: .pi / 2, axis: [1, 0, 0])
        subject.position -= subject.visualBounds(relativeTo: rest).center
        let models = Self.modelEntities(in: subject)
        frameGeometry = models.map { FrameProjection(entity: $0) }
        buttons = [("lock", "oknVLIOxyFKJJzk"), ("volume_up", "xsdEUgktlZKTjeM"),
                   ("volume_down", "oRVcvMIHfnBuWqp")].compactMap { name, joint in
            models.compactMap { ButtonProjection(entity: $0, joint: joint, name: name) }.first
        }
        renderer.entities.append(wrapper)
        camera.camera.fieldOfViewInDegrees = fieldOfView
        camera.camera.near = 0.001
        camera.camera.far = 10000
        renderer.entities.append(camera)
        renderer.activeCamera = camera
        renderer.lighting.resource = EnvironmentResource.duoObjectLighting()
        renderer.cameraSettings.antialiasing = .none
        renderer.cameraSettings.colorBackground = .color(CGColor(red: 0, green: 0, blue: 0, alpha: 0))
        controller = subject.playAnimation(clip, transitionDuration: 0, startsPaused: true)
        try await clearScreens()
        try prepareOutput(width: pose.width, height: pose.height)
        controller.time = 0
        try await renderScene(output: target!.output)
        try await renderScene(output: target!.output)
        let points = frameGeometry.flatMap { $0.points() }
        let lo = points.reduce(SIMD3<Float>(repeating: .infinity), simd_min)
        let hi = points.reduce(SIMD3<Float>(repeating: -.infinity), simd_max)
        let center = SIMD3<Float>((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0)
        openGeometry = points.map { $0 - center }
    }

    /// Rotation is clockwise degrees; scale is frame occupancy, capped at 0.98 to prevent clipping.
    func update(angle: Double, rotation: Double, scale: Double = 0.85, width: Int = 1280, height: Int = 900, yaw: Double? = nil) {
        let focusYaw = yaw ?? (angle == 0 ? 90 : 0)
        guard angle.isFinite, rotation.isFinite, focusYaw.isFinite, scale.isFinite, scale > 0, width > 0, height > 0 else { return }
        pose = Pose(angle: min(180, max(0, angle)), rotation: rotation, yaw: focusYaw, scale: scale,
                    width: width, height: height)
    }

    /// Input must be owned, IOSurface-backed BGRA/sRGB snapshots. Call serially.
    /// The bounded pool never recycles output while an encoder retains it.
    func render(panels: [Int: CVPixelBuffer], blankedDisplays: Set<Int> = []) async throws -> CVPixelBuffer {
        guard !rendering else { throw RenderError.renderInProgress }
        rendering = true
        defer { rendering = false }
        let requested = pose
        try prepareOutput(width: requested.width, height: requested.height)
        var output: CVPixelBuffer?
        guard let pool,
              CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(nil, pool,
                [kCVPixelBufferPoolAllocationThresholdKey as String: 3] as CFDictionary,
                &output) == kCVReturnSuccess, let output else { throw RenderError.outputBuffersBusy }
        for id in [1, 3] {
            if blankedDisplays.contains(id) {
                if !screens[id]!.blanked {
                    try await clearScreens(displayIds: [id])
                    screens[id]!.blanked = true
                    screens[id]!.lastFrame = nil
                }
            } else if let buffer = panels[id] {
                try await upload(buffer, displayId: id)
                screens[id]!.blanked = false
            }
        }
        let progress = (180 - requested.angle) / 180
        controller.time = progress * 0.923 * controller.duration
        rest.orientation = simd_quatf(angle: Float(requested.yaw * .pi / 180), axis: [0, 1, 0])
            * simd_quatf(angle: .pi / 2, axis: [1, 0, 0])
        rest.position = rest.orientation.act(SIMD3<Float>(0, -4.28 * Float(progress), 0))
        wrapper.orientation = simd_quatf(angle: Float(-requested.rotation * .pi / 180), axis: [0, 0, 1])
        guard let target else { throw RenderError.unavailable }
        // Settle the paused clip before measuring its real skinned shell.
        if lastAngle != requested.angle { try await renderScene(output: target.output) }
        let aspect = Float(requested.width) / Float(requested.height)
        if fittedPose != requested {
            wrapper.position = .zero
            let points = frameGeometry.flatMap { $0.points() }
            let lo = points.reduce(SIMD3<Float>(repeating: .infinity), simd_min)
            let hi = points.reduce(SIMD3<Float>(repeating: -.infinity), simd_max)
            let center = SIMD3<Float>((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0)
            wrapper.position = -center
            let openDistance = Self.fittedDistance(points: openGeometry.map { wrapper.orientation.act($0) },
                fieldOfView: fieldOfView, aspect: aspect, scale: requested.scale)
            cameraDistance = max(openDistance, Self.fittedDistance(points: points.map { $0 - center },
                fieldOfView: fieldOfView, aspect: aspect, scale: requested.scale))
            fittedPose = requested
        }
        camera.position = [0, 0, cameraDistance]
        try await renderScene(output: target.output)
        lastAngle = requested.angle
        // Sampling an sRGB-format target yields linear Display P3 values.
        guard let image = CIImage(mtlTexture: target.texture, options: [
            .colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!
        ])?.oriented(.downMirrored) else { throw RenderError.invalidFrame }
        context.render(image, to: output, bounds: image.extent, colorSpace: outputColorSpace)
        CVBufferSetAttachment(output, kCVImageBufferCGColorSpaceKey, outputColorSpace, .shouldPropagate)
        CVBufferSetAttachment(output, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(output, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_sRGB, .shouldPropagate)
        projectionPieces = [1, 3].flatMap { id in
            screens[id]!.projection.pieces(cameraDistance: cameraDistance, fieldOfView: fieldOfView,
                                           aspect: aspect).map { quad, rect in
                ["displayId": id, "quad": quad, "rect": rect, "slotRotation": id == 1 ? 0.0 : 270.0] as [String: Any]
            }
        }
        buttonProjections = buttons.map { button in
            let matrix = button.matrix()
            let origin = matrix * SIMD4<Float>(0, 0, 0, 1)
            let outward = matrix * SIMD4<Float>(1, 0, 0, 1)
            let along = matrix * SIMD4<Float>(0, 0, 1, 1)
            return ["button": button.name,
                "point": Self.project(SIMD3(origin.x, origin.y, origin.z), cameraDistance: cameraDistance, fieldOfView: fieldOfView, aspect: aspect),
                "outward": Self.project(SIMD3(outward.x, outward.y, outward.z), cameraDistance: cameraDistance, fieldOfView: fieldOfView, aspect: aspect),
                "along": Self.project(SIMD3(along.x, along.y, along.z), cameraDistance: cameraDistance, fieldOfView: fieldOfView, aspect: aspect)] as [String: Any]
        }
        if maskPose != requested {
            let silhouette = try Self.silhouette(output)
            alphaMask = silhouette.path
            frameBounds = silhouette.bounds
            maskPose = requested
        }
        renderedScale = min(0.98, requested.scale)
        return output
    }

    private func renderScene(output: RealityRenderer.CameraOutput) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            do {
                try renderer.updateAndRender(deltaTime: 1 / 60, cameraOutput: output,
                    onComplete: { _ in continuation.resume() })
            } catch { continuation.resume(throwing: error) }
        }
    }

    nonisolated static func fittedDistance(points: [SIMD3<Float>], fieldOfView: Float, aspect: Float, scale: Double) -> Float {
        let tangent = tan(fieldOfView * .pi / 360) * Float(min(0.98, scale))
        return points.reduce(Float(0.001)) { distance, point in
            max(distance, point.z + max(abs(point.x) / aspect, abs(point.y)) / tangent + 0.001)
        }
    }

    private func prepareOutput(width: Int, height: Int) throws {
        if poolWidth == width, poolHeight == height { return }
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm_srgb,
                                                                 width: width, height: height, mipmapped: false)
        descriptor.storageMode = .shared
        descriptor.usage = [.renderTarget, .shaderRead]
        guard let texture = device.makeTexture(descriptor: descriptor) else { throw RenderError.unavailable }
        let nextTarget = (texture, try RealityRenderer.CameraOutput(.singleProjection(colorTexture: texture)))
        let attributes: [String: Any] = [
            kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferMetalCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        var nextPool: CVPixelBufferPool?
        guard CVPixelBufferPoolCreate(nil,
            [kCVPixelBufferPoolMinimumBufferCountKey as String: 3] as CFDictionary,
            attributes as CFDictionary, &nextPool) == kCVReturnSuccess, let nextPool else {
            throw RenderError.unavailable
        }
        pool = nextPool
        target = nextTarget
        poolWidth = width
        poolHeight = height
    }

    private static func makeScreenTexture(width: Int, height: Int) throws -> LowLevelTexture {
        try LowLevelTexture(descriptor: .init(pixelFormat: .bgra8Unorm_srgb, width: width, height: height,
                                             textureUsage: [.shaderRead, .shaderWrite, .renderTarget]))
    }

    private static func makeUploadTexture(device: any MTLDevice, width: Int, height: Int) throws -> any MTLTexture {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm_srgb,
                                                                 width: width, height: height, mipmapped: false)
        descriptor.usage = [.shaderRead, .shaderWrite, .renderTarget]
        guard let texture = device.makeTexture(descriptor: descriptor) else { throw RenderError.unavailable }
        return texture
    }

    private func clearScreens(displayIds: Set<Int> = [1, 3]) async throws {
        guard let command = commandQueue.makeCommandBuffer() else { throw RenderError.unavailable }
        for id in displayIds {
            guard let screen = screens[id] else { continue }
            let pass = MTLRenderPassDescriptor()
            pass.colorAttachments[0].texture = screen.texture.replace(using: command)
            pass.colorAttachments[0].loadAction = .clear
            pass.colorAttachments[0].storeAction = .store
            pass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 1)
            guard let encoder = command.makeRenderCommandEncoder(descriptor: pass) else { throw RenderError.unavailable }
            encoder.endEncoding()
        }
        try await complete(command)
    }

    private func upload(_ buffer: CVPixelBuffer, displayId: Int) async throws {
        guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_32BGRA,
              CVPixelBufferGetIOSurface(buffer) != nil, var screen = screens[displayId] else {
            throw RenderError.invalidFrame
        }
        if screen.lastFrame === buffer { return }
        let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
        var cached: CVMetalTexture?
        guard CVMetalTextureCacheCreateTextureFromImage(nil, textureCache, buffer, nil,
            .bgra8Unorm_srgb, width, height, 0, &cached) == kCVReturnSuccess,
              let cached, let source = CVMetalTextureGetTexture(cached) else { throw RenderError.invalidFrame }
        if screen.width != width || screen.height != height {
            screen.texture = try Self.makeScreenTexture(width: width, height: height)
            screen.uploadTexture = try Self.makeUploadTexture(device: device, width: width, height: height)
            screen.width = width
            screen.height = height
            var material = UnlitMaterial(applyPostProcessToneMap: false)
            material.color = .init(tint: .white, texture: .init(try await TextureResource(from: screen.texture)))
            screen.entity.model!.materials[screen.material] = material
            screens[displayId] = screen
        }
        // LowLevelTexture color resources use Display P3, unlike CGImage-backed resources.
        // Convert sampled linear input before the blit, not after it has lost its gamut tag.
        guard let image = CIImage(mtlTexture: source, options: [
            .colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!
        ]), let command = commandQueue.makeCommandBuffer() else { throw RenderError.invalidFrame }
        context.render(image, to: screen.uploadTexture, commandBuffer: command, bounds: image.extent,
                       colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!)
        guard let encoder = command.makeBlitCommandEncoder() else { throw RenderError.unavailable }
        encoder.copy(from: screen.uploadTexture, to: screen.texture.replace(using: command))
        encoder.endEncoding()
        try await complete(command)
        screen.lastFrame = buffer
        screens[displayId] = screen
        withExtendedLifetime(cached) {}
    }

    private func complete(_ command: any MTLCommandBuffer) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            command.addCompletedHandler { completed in
                if let error = completed.error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            }
            command.commit()
        }
    }

    nonisolated static func project(_ point: SIMD3<Float>, cameraDistance: Float, fieldOfView: Float, aspect: Float) -> [Double] {
        let scale: Float = 1 / tan(fieldOfView * .pi / 360)
        let depth = max(0.001, cameraDistance - point.z)
        return [Double(0.5 + point.x * scale / depth / aspect / 2), Double(0.5 - point.y * scale / depth / 2)]
    }

    nonisolated static func bounds(of points: [[Double]]) -> [Double] {
        guard let first = points.first else { return [0, 0, 0, 0] }
        var lo = first, hi = first
        for point in points {
            lo[0] = min(lo[0], point[0]); lo[1] = min(lo[1], point[1])
            hi[0] = max(hi[0], point[0]); hi[1] = max(hi[1], point[1])
        }
        return [lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1]]
    }

    /// Trace alpha>=128 pixel boundaries, including holes, then simplify within 0.49px.
    nonisolated static func silhouette(_ buffer: CVPixelBuffer) throws -> (path: String, bounds: [Double]) {
        guard CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess else { throw RenderError.invalidFrame }
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
        guard let base = CVPixelBufferGetBaseAddress(buffer)?.assumingMemoryBound(to: UInt8.self) else {
            throw RenderError.invalidFrame
        }
        let stride = CVPixelBufferGetBytesPerRow(buffer), pitch = width + 1
        let alphaBit = SIMD16<UInt32>(repeating: 0x80000000)
        let empty = SIMD16<UInt32>(repeating: 0)
        var rows: [[Range<Int>]] = []
        rows.reserveCapacity(height)
        var minX = width, minY = height, maxX = 0, maxY = 0
        for y in 0..<height {
            let row = UnsafeRawPointer(base + y * stride)
            var runs: [Range<Int>] = [], start: Int?, x = 0
            while x + 16 <= width {
                let bits = row.loadUnaligned(fromByteOffset: x * 4, as: SIMD16<UInt32>.self) & alphaBit
                if bits == empty {
                    if let first = start { runs.append(first..<x); start = nil }
                } else if bits == alphaBit {
                    if start == nil { start = x }
                } else {
                    for offset in 0..<16 {
                        if bits[offset] != 0 {
                            if start == nil { start = x + offset }
                        } else if let first = start {
                            runs.append(first..<(x + offset)); start = nil
                        }
                    }
                }
                x += 16
            }
            while x < width {
                if base[y * stride + x * 4 + 3] >= 128 {
                    if start == nil { start = x }
                } else if let first = start { runs.append(first..<x); start = nil }
                x += 1
            }
            if let first = start { runs.append(first..<width) }
            if let first = runs.first, let last = runs.last {
                minX = min(minX, first.lowerBound); maxX = max(maxX, last.upperBound)
                minY = min(minY, y); maxY = y + 1
            }
            rows.append(runs)
        }
        guard maxX > minX else { return ("", [0, 0, 0, 0]) }
        var edges: [Int: [Int]] = [:]
        func horizontal(_ run: Range<Int>, neighbors: [Range<Int>], row: Int, reversed: Bool) {
            var cursor = run.lowerBound
            func add(_ end: Int) {
                guard end > cursor else { return }
                let a = row * pitch + cursor, b = row * pitch + end
                edges[reversed ? b : a, default: []].append(reversed ? a : b)
            }
            for neighbor in neighbors {
                if neighbor.upperBound <= cursor { continue }
                if neighbor.lowerBound >= run.upperBound { break }
                add(min(neighbor.lowerBound, run.upperBound))
                cursor = max(cursor, neighbor.upperBound)
                if cursor >= run.upperBound { return }
            }
            add(run.upperBound)
        }
        for y in minY..<maxY {
            for run in rows[y] {
                let a = y * pitch + run.lowerBound, b = y * pitch + run.upperBound
                edges[a + pitch, default: []].append(a)
                edges[b, default: []].append(b + pitch)
                horizontal(run, neighbors: y > 0 ? rows[y - 1] : [], row: y, reversed: false)
                horizontal(run, neighbors: y + 1 < height ? rows[y + 1] : [], row: y + 1, reversed: true)
            }
        }
        func point(_ key: Int) -> SIMD2<Double> { SIMD2(Double(key % pitch), Double(key / pitch)) }
        func direction(_ from: Int, _ to: Int) -> Int {
            let delta = to - from
            return delta > 0 && delta < pitch ? 0 : delta == pitch ? 1 : delta < 0 && delta > -pitch ? 2 : 3
        }
        var paths: [String] = []
        while let start = edges.keys.min() {
            var previous = start - 1, current = start, contour: [SIMD2<Double>] = []
            repeat {
                contour.append(point(current))
                guard var candidates = edges[current], !candidates.isEmpty else { throw RenderError.invalidFrame }
                let incoming = direction(previous, current)
                // Rightmost turn keeps diagonally touching foreground islands separate.
                let best = candidates.indices.min { left, right in
                    func rank(_ index: Int) -> Int {
                        let turn = (direction(current, candidates[index]) - incoming + 4) % 4
                        return turn == 1 ? 0 : turn == 0 ? 1 : turn == 3 ? 2 : 3
                    }
                    return rank(left) < rank(right)
                }!
                let next = candidates.remove(at: best)
                if candidates.isEmpty { edges.removeValue(forKey: current) }
                else { edges[current] = candidates }
                previous = current
                current = next
            } while current != start
            guard contour.count >= 3 else { continue }
            let middle = contour.count / 2
            let first = simplify(Array(contour[...middle]))
            let second = simplify(Array(contour[middle...]) + [contour[0]])
            let simplified = Array(first.dropLast()) + Array(second.dropLast())
            let coordinates = simplified.map { point in
                "\((point.x / Double(width) * 10_000_000).rounded() / 10_000_000) \((point.y / Double(height) * 10_000_000).rounded() / 10_000_000)"
            }
            paths.append("M" + coordinates.joined(separator: "L") + "Z")
        }
        return (paths.joined(), [Double(minX) / Double(width), Double(minY) / Double(height),
                                Double(maxX - minX) / Double(width), Double(maxY - minY) / Double(height)])
    }

    private nonisolated static func simplify(_ points: [SIMD2<Double>]) -> [SIMD2<Double>] {
        guard points.count > 2 else { return points }
        var keep = [Bool](repeating: false, count: points.count)
        keep[0] = true; keep[points.count - 1] = true
        // Bound each exact-error scan so staircase contours cannot make it quadratic.
        var pending: [(Int, Int)] = []
        for first in stride(from: 0, to: points.count - 1, by: 128) {
            let last = min(first + 128, points.count - 1)
            keep[first] = true; keep[last] = true
            pending.append((first, last))
        }
        while let (first, last) = pending.popLast() {
            guard last > first + 1 else { continue }
            let a = points[first], delta = points[last] - a, length = simd_length_squared(delta)
            var greatest = 0.49 * 0.49, selected: Int?
            for index in (first + 1)..<last {
                let t = length == 0 ? 0 : min(1, max(0, simd_dot(points[index] - a, delta) / length))
                let distance = simd_distance_squared(points[index], a + delta * t)
                if distance > greatest { greatest = distance; selected = index }
            }
            if let selected {
                keep[selected] = true
                pending.append((first, selected)); pending.append((selected, last))
            }
        }
        return points.indices.filter { keep[$0] }.map { points[$0] }
    }

    private static func screen(in entity: Entity, named name: String) -> (ModelEntity, Int)? {
        if let model = entity as? ModelEntity,
           let index = model.model?.materials.firstIndex(where: { $0.name == name }) { return (model, index) }
        for child in entity.children { if let result = screen(in: child, named: name) { return result } }
        return nil
    }

    private static func modelEntities(in entity: Entity) -> [ModelEntity] {
        ((entity as? ModelEntity).map { [$0] } ?? []) + entity.children.flatMap { modelEntities(in: $0) }
    }

    private static func rotateInnerUVs(on entity: ModelEntity, material: Int) throws {
        guard let model = entity.model else { throw RenderError.invalidModel }
        var contents = model.mesh.contents
        contents.models = .init(contents.models.map { mesh in
            var mesh = mesh
            mesh.parts = .init(mesh.parts.map { part in
                guard part.materialIndex == material, let coordinates = part.textureCoordinates else { return part }
                var part = part
                part.textureCoordinates = .init(coordinates.elements.map { SIMD2<Float>(1 - $0.y, $0.x) })
                return part
            })
            return mesh
        })
        try model.mesh.replace(with: contents)
        entity.model = model
    }

    @MainActor private struct ButtonProjection {
        let entity: ModelEntity
        let name: String
        let joints: [MeshResource.Skeleton.Joint]
        let indices: [Int?]

        init?(entity: ModelEntity, joint: String, name: String) {
            let contents = entity.model!.mesh.contents
            guard let id = contents.models.flatMap({ Array($0.parts) }).first?.skeletonID,
                  let skeleton = contents.skeletons[id],
                  let index = skeleton.joints.firstIndex(where: { $0.name.split(separator: "/").last.map(String.init) == joint }) else { return nil }
            self.entity = entity
            self.name = name
            var chain = [Int](), current: Int? = index
            while let value = current { chain.append(value); current = skeleton.joints[value].parentIndex }
            joints = chain.reversed().map { skeleton.joints[$0] }
            indices = joints.map { entity.jointNames.firstIndex(of: $0.name) }
        }

        func matrix() -> simd_float4x4 {
            let transforms = entity.jointTransforms
            return joints.indices.reduce(entity.transformMatrix(relativeTo: nil)) { matrix, index in
                matrix * (indices[index].flatMap { $0 < transforms.count ? transforms[$0].matrix : nil }
                    ?? joints[index].restPoseTransform.matrix)
            }
        }
    }

    @MainActor private struct Skin {
        let entity: ModelEntity
        let joints: [MeshResource.Skeleton.Joint]
        let indices: [Int?]

        init(entity: ModelEntity, skeleton: MeshResource.Skeleton) {
            self.entity = entity
            joints = skeleton.joints
            indices = joints.map { entity.jointNames.firstIndex(of: $0.name) }
        }

        func matrices() -> [simd_float4x4] {
            let transforms = entity.jointTransforms
            var global = [simd_float4x4](repeating: matrix_identity_float4x4, count: joints.count)
            for index in joints.indices {
                let local = indices[index].flatMap { $0 < transforms.count ? transforms[$0].matrix : nil }
                    ?? joints[index].restPoseTransform.matrix
                global[index] = joints[index].parentIndex.map { global[$0] * local } ?? local
            }
            let world = entity.transformMatrix(relativeTo: nil)
            return joints.indices.map { world * global[$0] * joints[$0].inverseBindPoseMatrix }
        }
    }

    private struct Sample {
        let position: SIMD3<Float>
        let uv: SIMD2<Float>
        let influences: [MeshJointInfluence]

        func position(matrices: [simd_float4x4]) -> SIMD3<Float> {
            var point = SIMD4<Float>(repeating: 0)
            for influence in influences where influence.weight > 0 {
                point += (matrices[influence.jointIndex] * SIMD4(position, 1)) * influence.weight
            }
            return SIMD3(point.x, point.y, point.z)
        }
    }

    @MainActor private struct FrameProjection {
        let skin: Skin
        let samples: [Sample]

        init(entity: ModelEntity) {
            let contents = entity.model!.mesh.contents
            let parts = contents.models.flatMap { Array($0.parts) }
            let skeleton = contents.skeletons[parts.first!.skeletonID!]!
            skin = Skin(entity: entity, skeleton: skeleton)
            samples = parts.flatMap { part in
                let positions = Array(part.positions.elements)
                let weights = Array(part.jointInfluences!.influences.elements)
                let count = weights.count / positions.count
                return positions.indices.map { index in
                    Sample(position: positions[index], uv: .zero,
                           influences: Array(weights[(index * count)..<((index + 1) * count)]))
                }
            }
        }

        func points() -> [SIMD3<Float>] {
            let matrices = skin.matrices()
            return samples.map { $0.position(matrices: matrices) }
        }
    }

    @MainActor private struct ScreenProjection {
        let skin: Skin
        let leaves: [(samples: [Sample], region: SIMD4<Float>)]

        init(slot: (ModelEntity, Int), inner: Bool) throws {
            let contents = slot.0.model!.mesh.contents
            guard let part = contents.models.flatMap({ Array($0.parts) }).first(where: { $0.materialIndex == slot.1 }),
                  let coordinates = part.textureCoordinates, let skeletonID = part.skeletonID,
                  let skeleton = contents.skeletons[skeletonID], let influences = part.jointInfluences else {
                throw RenderError.invalidModel
            }
            skin = Skin(entity: slot.0, skeleton: skeleton)
            let positions = Array(part.positions.elements), uvs = Array(coordinates.elements)
            let weights = Array(influences.influences.elements), count = weights.count / positions.count
            let samples = positions.indices.map { index in
                Sample(position: positions[index], uv: SIMD2(uvs[index].x, 1 - uvs[index].y),
                       influences: Array(weights[(index * count)..<((index + 1) * count)]))
            }
            let regions: [SIMD4<Float>] = inner ? [SIMD4(0, 0.5, 1, 0.5), SIMD4(0, 0, 1, 0.5)] : [SIMD4(0, 0, 1, 1)]
            leaves = try regions.map { region in
                let candidates = inner ? samples.filter { $0.uv.y > region.y + 0.02 && $0.uv.y < region.y + region.w - 0.02 } : samples
                let selected = [SIMD2<Float>(0.15, 0.2), SIMD2<Float>(0.85, 0.2), SIMD2<Float>(0.15, 0.8)].compactMap { target in
                    let uv = SIMD2(target.x, region.y + target.y * region.w)
                    return candidates.min { simd_distance_squared($0.uv, uv) < simd_distance_squared($1.uv, uv) }
                }
                guard selected.count == 3 else { throw RenderError.invalidModel }
                let u = selected[1].uv - selected[0].uv, v = selected[2].uv - selected[0].uv
                guard abs(u.x * v.y - u.y * v.x) > 0.000001 else { throw RenderError.invalidModel }
                return (selected, region)
            }
        }

        func pieces(cameraDistance: Float, fieldOfView: Float, aspect: Float) -> [(quad: [[Double]], rect: [Double])] {
            let matrices = skin.matrices()
            return leaves.map { samples, region in
                let a = samples[0].position(matrices: matrices), b = samples[1].position(matrices: matrices), c = samples[2].position(matrices: matrices)
                let u = samples[1].uv - samples[0].uv, v = samples[2].uv - samples[0].uv
                let determinant = u.x * v.y - u.y * v.x
                func project(_ uv: SIMD2<Float>) -> [Double] {
                    let delta = uv - samples[0].uv
                    let point = a + (b - a) * ((delta.x * v.y - delta.y * v.x) / determinant)
                        + (c - a) * ((u.x * delta.y - u.y * delta.x) / determinant)
                    return DuoRenderer.project(point, cameraDistance: cameraDistance, fieldOfView: fieldOfView, aspect: aspect)
                }
                return ([project(SIMD2(region.x, region.y)), project(SIMD2(region.x + region.z, region.y)),
                         project(SIMD2(region.x + region.z, region.y + region.w)), project(SIMD2(region.x, region.y + region.w))],
                        [Double(region.x), Double(region.y), Double(region.z), Double(region.w)])
            }
        }
    }

}
