import Foundation

@main
private enum HIDDisplayInputSelftest {
    static func main() {
        precondition(!HIDDisplayInput.prefersLegacyHome(button: "home", hasMultipleIntegratedDisplays: false))
        precondition(HIDDisplayInput.prefersLegacyHome(button: "home", hasMultipleIntegratedDisplays: true), "Multi-integrated Home must use the proven legacy hardware route")
        for button in ["lock", "siri", "side_button", "app_switcher", "swipe_home"] {
            precondition(!HIDDisplayInput.prefersLegacyHome(button: button, hasMultipleIntegratedDisplays: true))
        }
        precondition(HIDDisplayInput.prefersLegacyKeyboard(hasMultipleIntegratedDisplays: true), "Multi-panel keyboards must use the consumed keyboard builder")
        precondition(!HIDDisplayInput.prefersLegacyKeyboard(hasMultipleIntegratedDisplays: false), "Ordinary keyboard route must remain unchanged")
        let upright = HIDDisplayInput.SwipeHome(start: CGPoint(x: 0.5, y: 0.95), end: CGPoint(x: 0.5, y: 0.35), edge: 3)
        let expected: [(Int, HIDDisplayInput.SwipeHome)] = [
            (0, upright),
            (90, .init(start: CGPoint(x: 0.95, y: 0.5), end: CGPoint(x: 0.35, y: 0.5), edge: 4)),
            (180, .init(start: CGPoint(x: 0.5, y: 0.05), end: CGPoint(x: 0.5, y: 0.65), edge: 1)),
            (270, .init(start: CGPoint(x: 0.05, y: 0.5), end: CGPoint(x: 0.65, y: 0.5), edge: 2)),
        ]
        for (rotation, gesture) in expected {
            check(HIDDisplayInput.swipeHome(rotation: rotation, hasMultipleIntegratedDisplays: true), expected: gesture, message: "Multi-integrated swipe must follow the logical bottom edge at rotation \(rotation)")
            check(HIDDisplayInput.swipeHome(rotation: rotation, hasMultipleIntegratedDisplays: false), expected: upright, message: "Single-screen swipe must preserve legacy coordinates")
        }
        print("HID display input self-test passed")
    }

    private static func check(_ gesture: HIDDisplayInput.SwipeHome, expected: HIDDisplayInput.SwipeHome, message: String) {
        precondition(abs(gesture.start.x - expected.start.x) < 0.000001 && abs(gesture.start.y - expected.start.y) < 0.000001, message)
        precondition(abs(gesture.end.x - expected.end.x) < 0.000001 && abs(gesture.end.y - expected.end.y) < 0.000001, message)
        precondition(gesture.edge == expected.edge, message)
    }
}
