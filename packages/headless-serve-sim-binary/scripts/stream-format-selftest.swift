import Foundation

@main
private enum StreamFormatSelftest {
    static func main() {
        let heartbeat = AVCCEnvelope.heartbeat()
        precondition(Array(heartbeat) == [0, 0, 0, 1, 0x05])

        let delta = AVCCEnvelope.delta(avcc: Data([0x11, 0x22]))
        precondition(Array(delta) == [0, 0, 0, 3, 0x03, 0x11, 0x22])
        let disposable = AVCCEnvelope.disposableDelta(avcc: Data([0x33]))
        precondition(Array(disposable) == [0, 0, 0, 2, 0x06, 0x33])
        let timing = AVCCEnvelope.timing(timestamp: 0x0102030405060708, duration: 16_667, sequence: 2)
        precondition(Array(timing) == [0, 0, 0, 25, 0x08,
            1, 2, 3, 4, 5, 6, 7, 8,
            0, 0, 0, 0, 0, 0, 0x41, 0x1b,
            0, 0, 0, 0, 0, 0, 0, 2])
        print("Stream format self-test passed")
    }
}
