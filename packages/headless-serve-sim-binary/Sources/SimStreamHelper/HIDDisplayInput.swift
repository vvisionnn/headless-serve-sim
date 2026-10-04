import Foundation

enum HIDDisplayInput {
    static func prefersLegacyKeyboard(hasMultipleIntegratedDisplays: Bool) -> Bool {
        hasMultipleIntegratedDisplays
    }

    static func prefersLegacyHome(button: String, hasMultipleIntegratedDisplays: Bool) -> Bool {
        button == "home" && hasMultipleIntegratedDisplays
    }

    struct SwipeHome {
        let start: CGPoint
        let end: CGPoint
        let edge: UInt32
    }

    /// Map the logical bottom-up gesture back to the active raw framebuffer.
    /// Ordinary simulators keep their existing raw-coordinate gesture.
    static func swipeHome(rotation: Int, hasMultipleIntegratedDisplays: Bool) -> SwipeHome {
        switch hasMultipleIntegratedDisplays ? rotation : 0 {
        case 90:
            return SwipeHome(start: CGPoint(x: 0.95, y: 0.5), end: CGPoint(x: 0.35, y: 0.5), edge: 4)
        case 180:
            return SwipeHome(start: CGPoint(x: 0.5, y: 0.05), end: CGPoint(x: 0.5, y: 0.65), edge: 1)
        case 270:
            return SwipeHome(start: CGPoint(x: 0.05, y: 0.5), end: CGPoint(x: 0.65, y: 0.5), edge: 2)
        default:
            return SwipeHome(start: CGPoint(x: 0.5, y: 0.95), end: CGPoint(x: 0.5, y: 0.35), edge: 3)
        }
    }
}
