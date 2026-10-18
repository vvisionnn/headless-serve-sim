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

    /// Map an interface-space touch (upright as the user sees it) onto the raw
    /// panel. Ordinary simulators mirror the client's `rawPointForDisplayPoint`
    /// for the orientation /config publishes (rot90 = "landscape_right").
    /// Multi-panel devices follow the composition's own projection
    /// (RawPanelRenderer quads, `swipeHome`), which turns the other way for the
    /// same rotation. Edges turn with the point, as IndigoHIDEdge values the way
    /// HIDInjector defines them (1 top, 2 left, 3 bottom, 4 right).
    static func nativeTouch(x: Double, y: Double, edge: UInt32, rotation: Int,
                            hasMultipleIntegratedDisplays: Bool) -> (point: CGPoint, edge: UInt32) {
        let turn = ((rotation % 360) + 360) % 360 / 90
        switch hasMultipleIntegratedDisplays ? (4 - turn) % 4 : turn {
        case 1: // landscape_right
            return (CGPoint(x: 1 - y, y: x), [1: 4, 2: 1, 3: 2, 4: 3][edge] ?? edge)
        case 2: // portrait_upside_down
            return (CGPoint(x: 1 - x, y: 1 - y), [1: 3, 2: 4, 3: 1, 4: 2][edge] ?? edge)
        case 3: // landscape_left
            return (CGPoint(x: y, y: 1 - x), [1: 2, 2: 3, 3: 4, 4: 1][edge] ?? edge)
        default:
            return (CGPoint(x: x, y: y), edge)
        }
    }
}
