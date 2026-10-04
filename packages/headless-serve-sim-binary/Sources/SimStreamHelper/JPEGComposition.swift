import Foundation

enum JPEGComposition {
    private static let magic = Data("SSCM1".utf8)
    private static let chunkSize = 65534 - 2 - 5 - 4

    static func embed(_ metadata: Data?, in jpeg: Data) -> Data {
        guard let metadata, !metadata.isEmpty, jpeg.starts(with: [0xff, 0xd8]) else { return jpeg }
        let count = (metadata.count + chunkSize - 1) / chunkSize
        guard count <= Int(UInt16.max) else { return jpeg }
        var output = Data([0xff, 0xd8])
        for index in 0..<count {
            let start = index * chunkSize
            let end = min(start + chunkSize, metadata.count)
            let length = end - start + 2 + magic.count + 4
            output.append(contentsOf: [0xff, 0xef, UInt8(length >> 8), UInt8(length & 0xff)])
            output.append(magic)
            output.append(contentsOf: [UInt8(index >> 8), UInt8(index & 0xff), UInt8(count >> 8), UInt8(count & 0xff)])
            output.append(metadata.subdata(in: start..<end))
        }
        output.append(jpeg.dropFirst(2))
        return output
    }
}
