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
        // Interface-space touches: identity when upright, either device kind.
        for multi in [false, true] {
            let upright = HIDDisplayInput.nativeTouch(x: 0.2, y: 0.7, edge: 3, rotation: 0, hasMultipleIntegratedDisplays: multi)
            precondition(close(upright.point, CGPoint(x: 0.2, y: 0.7)) && upright.edge == 3, "Upright interface touches must pass through unchanged")
        }
        // Ordinary simulators mirror the client's rawPointForDisplayPoint for the
        // /config label (rot90 = landscape_right, rot270 = landscape_left).
        let ordinary: [(Int, CGPoint, UInt32)] = [
            (90, CGPoint(x: 0.3, y: 0.2), 2),   // landscape_right: (1-y, x); bottom → left
            (180, CGPoint(x: 0.8, y: 0.3), 1),  // (1-x, 1-y); bottom → top
            (270, CGPoint(x: 0.7, y: 0.8), 4),  // landscape_left: (y, 1-x); bottom → right
        ]
        for (rotation, point, edge) in ordinary {
            let native = HIDDisplayInput.nativeTouch(x: 0.2, y: 0.7, edge: 3, rotation: rotation, hasMultipleIntegratedDisplays: false)
            precondition(close(native.point, point) && native.edge == edge, "Single-screen interface touch must mirror the client mapping at rotation \(rotation)")
        }
        // Multi-panel devices follow the composition projection, so the logical
        // bottom-centre lands exactly where the proven swipe-home gesture starts.
        for rotation in [0, 90, 180, 270] {
            let swipe = HIDDisplayInput.swipeHome(rotation: rotation, hasMultipleIntegratedDisplays: true)
            let native = HIDDisplayInput.nativeTouch(x: 0.5, y: 0.95, edge: 3, rotation: rotation, hasMultipleIntegratedDisplays: true)
            precondition(close(native.point, swipe.start) && native.edge == swipe.edge, "Multi-integrated interface touch must follow the logical bottom edge at rotation \(rotation)")
        }
        // Every edge stays an edge and no two collapse onto one.
        for multi in [false, true] {
            for rotation in [90, 180, 270] {
                let mapped = Set((1...4).map { HIDDisplayInput.nativeTouch(x: 0, y: 0, edge: UInt32($0), rotation: rotation, hasMultipleIntegratedDisplays: multi).edge })
                precondition(mapped == [1, 2, 3, 4], "Edge mapping must be a permutation at rotation \(rotation)")
                precondition(HIDDisplayInput.nativeTouch(x: 0, y: 0, edge: 0, rotation: rotation, hasMultipleIntegratedDisplays: multi).edge == 0, "No-edge touches must stay edgeless")
            }
        }
        print("HID display input self-test passed")
    }

    private static func close(_ a: CGPoint, _ b: CGPoint) -> Bool {
        abs(a.x - b.x) < 0.000001 && abs(a.y - b.y) < 0.000001
    }

    private static func check(_ gesture: HIDDisplayInput.SwipeHome, expected: HIDDisplayInput.SwipeHome, message: String) {
        precondition(abs(gesture.start.x - expected.start.x) < 0.000001 && abs(gesture.start.y - expected.start.y) < 0.000001, message)
        precondition(abs(gesture.end.x - expected.end.x) < 0.000001 && abs(gesture.end.y - expected.end.y) < 0.000001, message)
        precondition(gesture.edge == expected.edge, message)
    }
}
