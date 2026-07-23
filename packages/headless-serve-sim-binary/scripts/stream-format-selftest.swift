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
        print("Stream format self-test passed")
    }
}
