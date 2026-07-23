import CoreVideo
import Foundation
import IOSurface

/// Copies a framebuffer-backed pixel buffer into memory owned by the stream.
///
/// SimulatorKit recycles one IOSurface in place. Consumers run asynchronously,
/// so passing that surface beyond the capture callback lets the next display
/// update overwrite rows while an encoder is reading them. A snapshot closes
/// that lifetime boundary once, then both encoders can safely share the result.
final class FrameSnapshotter {
    struct Stats {
        let snapshots: UInt64
        let nanoseconds: UInt64
        let failedSnapshots: UInt64
        let retriedSnapshots: UInt64
    }

    private var pool: CVPixelBufferPool?
    private var width = 0
    private var height = 0
    private let maximumAttempts: Int
    private let statsLock = NSLock()
    private var completedSnapshots: UInt64 = 0
    private var snapshotNanoseconds: UInt64 = 0
    private var failedSnapshots: UInt64 = 0
    private var retriedSnapshots: UInt64 = 0

    init(maximumAttempts: Int = 3) {
        self.maximumAttempts = max(1, maximumAttempts)
    }

    /// Returns an owned BGRA buffer whose bytes no longer alias `source`.
    /// A changed IOSurface seed means the producer completed an update during
    /// the copy; retry rather than ever handing a mixed-generation frame out.
    func snapshot(_ source: CVPixelBuffer) -> CVPixelBuffer? {
        let w = CVPixelBufferGetWidth(source)
        let h = CVPixelBufferGetHeight(source)
        guard w > 0, h > 0,
              CVPixelBufferGetPixelFormatType(source) == kCVPixelFormatType_32BGRA,
              preparePool(width: w, height: h),
              let surface = CVPixelBufferGetIOSurface(source)?.takeUnretainedValue()
        else { return nil }

        for attempt in 0..<maximumAttempts {
            let started = DispatchTime.now().uptimeNanoseconds
            var destination: CVPixelBuffer?
            guard let pool,
                  CVPixelBufferPoolCreatePixelBuffer(
                    kCFAllocatorDefault, pool, &destination
                  ) == kCVReturnSuccess,
                  let destination
            else { return nil }

            var seedAtLock: UInt32 = 0
            guard IOSurfaceLock(surface, .readOnly, &seedAtLock) == 0 else { continue }

            var copied = false
            if CVPixelBufferLockBaseAddress(destination, []) == kCVReturnSuccess {
                let sourceAddress = IOSurfaceGetBaseAddress(surface)
                if let destinationAddress = CVPixelBufferGetBaseAddress(destination) {
                    let sourceStride = IOSurfaceGetBytesPerRow(surface)
                    let destinationStride = CVPixelBufferGetBytesPerRow(destination)
                    if sourceStride == destinationStride {
                        memcpy(destinationAddress, sourceAddress, sourceStride * h)
                    } else {
                        let bytesPerRow = min(sourceStride, destinationStride)
                        for row in 0..<h {
                            memcpy(
                                destinationAddress + row * destinationStride,
                                sourceAddress + row * sourceStride,
                                bytesPerRow
                            )
                        }
                    }
                    copied = true
                }
                CVPixelBufferUnlockBaseAddress(destination, [])
            }

            var seedAtUnlock: UInt32 = 0
            let unlockStatus = IOSurfaceUnlock(surface, .readOnly, &seedAtUnlock)
            if copied, unlockStatus == 0, seedAtLock == seedAtUnlock {
                recordSuccess(nanoseconds: DispatchTime.now().uptimeNanoseconds - started)
                return destination
            }
            if attempt + 1 < maximumAttempts { recordRetry() }
        }
        recordFailure()
        return nil
    }

    func stats() -> Stats {
        statsLock.lock()
        defer { statsLock.unlock() }
        return Stats(
            snapshots: completedSnapshots,
            nanoseconds: snapshotNanoseconds,
            failedSnapshots: failedSnapshots,
            retriedSnapshots: retriedSnapshots
        )
    }

    private func preparePool(width: Int, height: Int) -> Bool {
        if pool != nil, self.width == width, self.height == height { return true }

        let attributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        var nextPool: CVPixelBufferPool?
        guard CVPixelBufferPoolCreate(
            kCFAllocatorDefault, nil, attributes as CFDictionary, &nextPool
        ) == kCVReturnSuccess, let nextPool else { return false }

        pool = nextPool
        self.width = width
        self.height = height
        return true
    }

    private func recordSuccess(nanoseconds: UInt64) {
        statsLock.lock()
        completedSnapshots += 1
        snapshotNanoseconds &+= nanoseconds
        statsLock.unlock()
    }

    private func recordRetry() {
        statsLock.lock()
        retriedSnapshots += 1
        statsLock.unlock()
    }

    private func recordFailure() {
        statsLock.lock()
        failedSnapshots += 1
        statsLock.unlock()
    }
}
