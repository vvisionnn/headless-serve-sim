import Foundation

#if SWIFTER_STUB
// Only the external socket writer is replaced; exercise production ClientManager.
public final class WebSocketSession {
    private let lock = NSLock()
    private var frames: [[UInt8]] = []
    public init() {}
    public func writeBinary(_ frame: [UInt8]) { lock.lock(); frames.append(frame); lock.unlock() }
    public func writtenFrames() -> [[UInt8]] { lock.lock(); defer { lock.unlock() }; return frames }
}
#else
import Swifter

enum HIDInjector {
    static let orientationPortrait: UInt32 = 1
    static let orientationPortraitUpsideDown: UInt32 = 2
    static let orientationLandscapeLeft: UInt32 = 4
    static let orientationLandscapeRight: UInt32 = 3
}

/// Socket writes run in blocks on the manager's serial queue; a synchronous
/// call on that queue returns only after every earlier block has run.
func flush(_ manager: ClientManager) { _ = manager.avccTransportMetrics() }

@main enum ClientManagerSelftest {
    static func main() throws {
        let manager = ClientManager()
        precondition(manager.screenConfig()["includeFrame"] == nil, "ordinary config must not gain a bezel preference")
        manager.setDeviceComposition(true)
        precondition(manager.screenConfig()["includeFrame"] as? Bool == true, "composition config must publish its shared bezel default")
        let first = WebSocketSession(), second = WebSocketSession()
        manager.addWSClient(first)
        manager.addWSClient(second)
        flush(manager)
        manager.onDeviceView = { view in
            if let includeFrame = view.includeFrame { manager.setDeviceView(includeFrame: includeFrame) }
        }
        let hide = Data([0x0f]) + Data(#"{"includeFrame":false}"#.utf8)
        manager.handleMessage(from: first, data: hide)
        manager.handleMessage(from: second, data: hide)
        flush(manager)
        for session in [first, second] {
            let frames = session.writtenFrames()
            precondition(frames.count == 2, "both tabs must receive one genuine shared preference transition, not duplicate echoes")
            let config = try JSONSerialization.jsonObject(with: Data(frames.last!.dropFirst())) as! [String: Any]
            precondition(config["includeFrame"] as? Bool == false)
        }
        manager.handleMessage(from: second, data: Data([0x0f]) + Data(#"{"includeFrame":true}"#.utf8))
        flush(manager)
        precondition(first.writtenFrames().count == 3 && second.writtenFrames().count == 3)
        let legacy = try JSONDecoder().decode(ScrollEventPayload.self, from: Data(#"{"dx":10,"dy":20}"#.utf8))
        let targeted = try JSONDecoder().decode(ScrollEventPayload.self, from: Data(#"{"dx":10,"dy":20,"displayId":3}"#.utf8))
        precondition(legacy.displayId == nil && targeted.displayId == 3, "scroll targeting must preserve legacy payloads")
        // Labels match what clients send to rotate: "landscape_left" is the
        // device turned clockwise (interface rot90 → content drawn rot270).
        let plain = ClientManager()
        plain.setDisplay(id: 1, rotation: 90)
        precondition(plain.screenConfig()["orientation"] as? String == "landscape_right",
                     "a display drawn rot90 is the device turned counter-clockwise")
        plain.setDisplay(id: 1, rotation: 270)
        precondition(plain.screenConfig()["orientation"] as? String == "landscape_left",
                     "a display drawn rot270 is the device turned clockwise")
        plain.setDisplay(id: 1, rotation: 180)
        precondition(plain.screenConfig()["orientation"] as? String == "portrait_upside_down")
        plain.stop()
        manager.stop()
        print("Client manager shared bezel config, duplicate suppression, orientation labels and scroll payload self-test passed")
    }
}
#endif
