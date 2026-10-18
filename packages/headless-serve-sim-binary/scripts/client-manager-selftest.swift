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
        precondition(plain.screenConfig()["interfaceOrientation"] as? String == "portrait_upside_down")
        let unsized = plain.screenConfig()["activeDisplay"] as? [String: Any]
        precondition(unsized?["id"] as? Int == 1 && unsized?["rotation"] as? Int == 180
                     && unsized?["orientation"] as? String == "portrait_upside_down"
                     && unsized?["width"] == nil && unsized?["height"] == nil,
                     "an active display without a known size must omit width/height")
        plain.setDisplay(id: 1, rotation: 180, width: 1080, height: 2400)
        let sized = plain.screenConfig()["activeDisplay"] as? [String: Any]
        precondition(sized?["width"] as? Int == 1080 && sized?["height"] as? Int == 2400)
        let unbound = ClientManager()
        precondition(unbound.screenConfig()["activeDisplay"] == nil, "no active display until one is bound")
        precondition(unbound.screenConfig()["interfaceOrientation"] as? String == "portrait")
        unbound.stop()
        // Composition keeps the composed video upright but still reports the
        // real interface orientation, and pushes rotation changes over /ws.
        let composed = ClientManager()
        composed.setDeviceComposition(true)
        let watcher = WebSocketSession()
        composed.addWSClient(watcher)
        flush(composed)
        let before = watcher.writtenFrames().count
        composed.setDisplay(id: 3, rotation: 270, width: 1350, height: 1800)
        precondition(composed.screenConfig()["orientation"] as? String == "portrait")
        precondition(composed.screenConfig()["interfaceOrientation"] as? String == "landscape_left")
        flush(composed)
        let pushed = watcher.writtenFrames()
        precondition(pushed.count == before + 1, "a rotation change must push one config update")
        let pushedConfig = try JSONSerialization.jsonObject(with: Data(pushed.last!.dropFirst())) as! [String: Any]
        precondition(pushedConfig["interfaceOrientation"] as? String == "landscape_left")
        precondition((pushedConfig["activeDisplay"] as? [String: Any])?["rotation"] as? Int == 270)
        composed.setDisplay(id: 3, rotation: 270, width: 1350, height: 1800)
        flush(composed)
        precondition(watcher.writtenFrames().count == before + 1, "an unchanged display must not re-push config")
        composed.stop()
        let rawTouch = try JSONDecoder().decode(TouchEventPayload.self, from: Data(#"{"type":"begin","x":0.1,"y":0.2}"#.utf8))
        let interfaceTouch = try JSONDecoder().decode(TouchEventPayload.self, from: Data(#"{"type":"begin","x":0.1,"y":0.2,"space":"interface"}"#.utf8))
        precondition(rawTouch.space == nil && interfaceTouch.space == "interface", "touch space must be opt-in")
        let rawPinch = try JSONDecoder().decode(MultiTouchEventPayload.self, from: Data(#"{"type":"begin","x1":0.1,"y1":0.2,"x2":0.3,"y2":0.4}"#.utf8))
        let interfacePinch = try JSONDecoder().decode(MultiTouchEventPayload.self, from: Data(#"{"type":"begin","x1":0.1,"y1":0.2,"x2":0.3,"y2":0.4,"space":"interface"}"#.utf8))
        precondition(rawPinch.space == nil && interfacePinch.space == "interface", "multi-touch space must be opt-in")
        plain.stop()
        manager.stop()
        print("Client manager shared bezel config, duplicate suppression, orientation labels, active display, touch space and scroll payload self-test passed")
    }
}
#endif
