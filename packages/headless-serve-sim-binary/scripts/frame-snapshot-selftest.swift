import CoreVideo
import Foundation
import IOSurface

private func makeSurface(width: Int, height: Int) -> IOSurface {
    let properties: [String: Any] = [
        kIOSurfaceWidth as String: width,
        kIOSurfaceHeight as String: height,
        kIOSurfaceBytesPerElement as String: 4,
        kIOSurfaceBytesPerRow as String: width * 4,
        kIOSurfacePixelFormat as String: kCVPixelFormatType_32BGRA,
    ]
    guard let surface = IOSurfaceCreate(properties as CFDictionary) else {
        fatalError("could not create test IOSurface")
    }
    return surface
}

private func fill(_ surface: IOSurface, bytes: (UInt8, UInt8, UInt8, UInt8)) {
    precondition(IOSurfaceLock(surface, [], nil) == 0)
    defer { precondition(IOSurfaceUnlock(surface, [], nil) == 0) }
    let base = IOSurfaceGetBaseAddress(surface).assumingMemoryBound(to: UInt8.self)
    let width = IOSurfaceGetWidth(surface)
    let height = IOSurfaceGetHeight(surface)
    let stride = IOSurfaceGetBytesPerRow(surface)
    for y in 0..<height {
        for x in 0..<width {
            let pixel = base + y * stride + x * 4
            pixel[0] = bytes.0
            pixel[1] = bytes.1
            pixel[2] = bytes.2
            pixel[3] = bytes.3
        }
    }
}

private func assertPixels(
    _ buffer: CVPixelBuffer,
    equal expected: (UInt8, UInt8, UInt8, UInt8)
) {
    precondition(CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    let base = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    for y in 0..<height {
        for x in 0..<width {
            let pixel = base + y * stride + x * 4
            precondition(
                pixel[0] == expected.0 && pixel[1] == expected.1 &&
                pixel[2] == expected.2 && pixel[3] == expected.3,
                "snapshot changed after source reuse at (\(x), \(y))"
            )
        }
    }
}

@main
private enum FrameSnapshotSelftest {
    static func main() {
        let surface = makeSurface(width: 64, height: 96)
        fill(surface, bytes: (10, 20, 30, 255))

        var wrapped: Unmanaged<CVPixelBuffer>?
        precondition(CVPixelBufferCreateWithIOSurface(
            kCFAllocatorDefault,
            surface,
            [kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA] as CFDictionary,
            &wrapped
        ) == kCVReturnSuccess)
        let source = wrapped!.takeRetainedValue()

        let snapshotter = FrameSnapshotter()
        guard let snapshot = snapshotter.snapshot(source) else {
            fatalError("snapshot failed")
        }

        fill(surface, bytes: (90, 100, 110, 255))
        assertPixels(snapshot, equal: (10, 20, 30, 255))
        print("FRAME SNAPSHOT SELFTEST PASSED")
    }
}
