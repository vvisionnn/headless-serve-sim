import CoreGraphics
import Foundation

/// Element frames from the AX translator are in interface space, but the open
/// Duo reports its application element in the inner panel's fixed portrait
/// space. Turn the app frame to the published interface orientation so the
/// root agrees with its children (and the grid pass probes the real screen).
enum AXInterfaceFrame {
    static func normalize(_ frame: NSRect, interfaceOrientation: String?) -> NSRect {
        guard let interfaceOrientation else { return frame }
        let landscape = interfaceOrientation.hasPrefix("landscape")
        guard landscape != (frame.width > frame.height), frame.width != frame.height else { return frame }
        return NSRect(x: frame.origin.x, y: frame.origin.y, width: frame.height, height: frame.width)
    }
}
