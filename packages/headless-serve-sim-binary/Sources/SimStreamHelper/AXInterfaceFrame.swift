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

    /// SpringBoard reports every frame in the fixed portrait `screen`, however
    /// the interface is turned. Move one into the interface orientation.
    static func fromFixed(_ frame: NSRect, screen: CGSize, interfaceOrientation: String?) -> NSRect {
        let (x, y, w, h) = (frame.origin.x, frame.origin.y, frame.width, frame.height)
        switch interfaceOrientation {
        case "landscape_left": return NSRect(x: screen.height - y - h, y: x, width: h, height: w)
        case "landscape_right": return NSRect(x: y, y: screen.width - x - w, width: h, height: w)
        case "portrait_upside_down": return NSRect(x: screen.width - x - w, y: screen.height - y - h, width: w, height: h)
        default: return frame
        }
    }

    /// Apply `transform` to the frame of `node` and of every descendant.
    static func mapFrames(in node: inout [String: Any], _ transform: (NSRect) -> NSRect) {
        if let f = node["frame"] as? [String: CGFloat], let x = f["x"], let y = f["y"],
           let w = f["width"], let h = f["height"] {
            let r = transform(NSRect(x: x, y: y, width: w, height: h))
            node["frame"] = ["x": r.origin.x, "y": r.origin.y, "width": r.width, "height": r.height]
        }
        guard var children = node["children"] as? [[String: Any]] else { return }
        for i in children.indices { mapFrames(in: &children[i], transform) }
        node["children"] = children
    }
}
