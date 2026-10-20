import Foundation

@main
private enum HIDTouchTargetSelftest {
    static func main() {
        precondition(HIDTouchTarget.select(displayID: nil) == 0x32)
        precondition(HIDTouchTarget.select(displayID: 3) == 0x40000003)
        precondition(HIDTouchTarget.select(displayID: 1) == 0x40000001)
        precondition(HIDTouchTarget.select(displayID: 0) == 0x32)
        precondition(HIDTouchTarget.select(displayID: -1) == 0x32)
        precondition(HIDTouchTarget.select(displayID: Int.max) == 0x32)

        // A finger stays on the panel and rotation it went down on, even when
        // the active display switches mid-gesture (a Duo folding).
        var pin = HIDTouchPin()
        let inner = HIDTouchPin.Route(target: 0x40000003, rotation: 90)
        let outer = HIDTouchPin.Route(target: 0x40000001, rotation: 0)
        precondition(pin.resolve(type: "begin", current: inner) == inner)
        precondition(pin.resolve(type: "move", current: outer) == inner, "A move must stay on the begin's panel")
        precondition(pin.resolve(type: "end", current: outer) == inner, "The end must lift the finger that went down")
        precondition(pin.resolve(type: "move", current: outer) == outer, "After the end, input follows the active panel again")
        precondition(pin.resolve(type: "end", current: outer) == outer, "A stray end goes to the active panel")
        precondition(pin.resolve(type: "begin", current: outer) == outer)
        precondition(pin.resolve(type: "begin", current: inner) == inner, "A new begin re-pins")
        print("HID touch target self-test passed")
    }
}
