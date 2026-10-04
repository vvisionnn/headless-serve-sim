import Foundation
import CoreVideo
import ImageIO

@main
private enum JPEGCompositionSelftest {
    static func main() {
        let ordinary = encode(composition: nil)
        precondition(composition(in: ordinary) == nil, "ordinary JPEG must have no composition metadata")
        precondition(CGImageSourceCreateWithData(ordinary as CFData, nil) != nil)

        let metadata = Data(#"{"displayId":3,"mask":"M0 0Z"}"#.utf8)
        let jpeg = encode(composition: metadata)
        precondition(composition(in: jpeg) == metadata, "JPEG must retain its own composition attachment")
        precondition(CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithData(jpeg as CFData, nil)!, 0, nil) != nil,
                     "APP15 metadata must preserve JPEG decoding")

        let large = Data((#"{"displayId":1,"mask":""# + String(repeating: "M0 0L1 1", count: 16000) + #""}"#).utf8)
        let largeJPEG = encode(composition: large)
        precondition(composition(in: largeJPEG) == large, "composition over 64KB must round-trip across APP15 segments")
        precondition(composition(in: jpeg) == metadata, "a later frame must not change an earlier JPEG's metadata")
        precondition(CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithData(largeJPEG as CFData, nil)!, 0, nil) != nil)
        print("JPEG composition self-test passed")
    }

    static func encode(composition: Data?) -> Data {
        var pixelBuffer: CVPixelBuffer?
        precondition(CVPixelBufferCreate(kCFAllocatorDefault, 2, 2, kCVPixelFormatType_32BGRA,
                                        [kCVPixelBufferCGImageCompatibilityKey: true] as CFDictionary,
                                        &pixelBuffer) == kCVReturnSuccess)
        let buffer = pixelBuffer!
        CVPixelBufferLockBaseAddress(buffer, [])
        memset(CVPixelBufferGetBaseAddress(buffer)!, 255, CVPixelBufferGetBytesPerRow(buffer) * 2)
        CVPixelBufferUnlockBaseAddress(buffer, [])
        if let composition {
            CVBufferSetAttachment(buffer, "headless-serve-sim.composition" as CFString,
                                  composition as CFData, .shouldPropagate)
        }
        let encoder = VideoEncoder()
        var output: Data?
        encoder.setup(width: 2, height: 2, fps: 60) { output = $0 }
        encoder.encode(pixelBuffer: buffer)
        precondition(output != nil, "test buffer must encode as JPEG")
        return output!
    }

    static func composition(in jpeg: Data) -> Data? {
        let bytes = [UInt8](jpeg)
        let magic = [UInt8]("SSCM1".utf8)
        var offset = 2
        var result = Data()
        var segments = 0
        var expectedCount = 0
        while offset + 4 <= bytes.count {
            guard bytes[offset] == 0xff else { return nil }
            let marker = bytes[offset + 1]
            if marker == 0xda || marker == 0xd9 { break }
            let length = Int(bytes[offset + 2]) << 8 | Int(bytes[offset + 3])
            guard length >= 2, offset + 2 + length <= bytes.count else { return nil }
            if marker == 0xef, length >= 11, Array(bytes[(offset + 4)..<(offset + 9)]) == magic {
                precondition(length < 65535, "APP15 segment length must remain below 65535")
                let index = Int(bytes[offset + 9]) << 8 | Int(bytes[offset + 10])
                let count = Int(bytes[offset + 11]) << 8 | Int(bytes[offset + 12])
                precondition(index == segments && count > 0)
                if segments == 0 { expectedCount = count }
                precondition(count == expectedCount)
                result.append(contentsOf: bytes[(offset + 13)..<(offset + 2 + length)])
                segments += 1
            }
            offset += 2 + length
        }
        return segments > 0 && segments == expectedCount ? result : nil
    }
}
