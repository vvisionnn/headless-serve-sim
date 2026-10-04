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
        print("HID touch target self-test passed")
    }
}
