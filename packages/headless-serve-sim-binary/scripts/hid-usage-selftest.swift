import Foundation

@main
private enum HIDUsageSelftest {
    static func main() {
        // Every hardware button the CLI exposes must map to a consumer usage,
        // so it routes through the portable arbitrary-HID path rather than the
        // legacy per-plane Indigo targets Xcode 27 stopped consuming.
        precondition(HIDUsage.consumerUsage(forButton: "home") == HIDUsage.menu)
        precondition(HIDUsage.consumerUsage(forButton: "lock") == HIDUsage.power)
        precondition(HIDUsage.consumerUsage(forButton: "siri") == HIDUsage.voiceCommand)
        precondition(HIDUsage.consumerUsage(forButton: "side_button") == HIDUsage.power)
        precondition(HIDUsage.consumerUsage(forButton: "volume_up") == HIDUsage.volumeUp)
        precondition(HIDUsage.consumerUsage(forButton: "volume_down") == HIDUsage.volumeDown)

        // `swipe_home` is a touch gesture and `app_switcher` is a double press;
        // neither is a single consumer usage, so both must fall through.
        precondition(HIDUsage.consumerUsage(forButton: "swipe_home") == nil)
        precondition(HIDUsage.consumerUsage(forButton: "app_switcher") == nil)
        precondition(HIDUsage.consumerUsage(forButton: "nonsense") == nil)

        // Usage pages and directions are USB HID spec values, not Apple's — they
        // must not drift.
        precondition(HIDUsage.consumerPage == 0x0C)
        precondition(HIDUsage.keyboardPage == 0x07)
        precondition(HIDUsage.down == 1 && HIDUsage.up == 2)

        print("HID usage self-test passed")
    }
}
