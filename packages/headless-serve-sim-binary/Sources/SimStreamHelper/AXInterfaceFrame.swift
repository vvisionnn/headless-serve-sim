import CoreGraphics
import Foundation

/// Element frames from the AX translator are in interface space, but the open
/// Duo reports its application element in the inner panel's fixed portrait
/// space. Turn the app frame to the published interface orientation so the
/// root agrees with its children (and the grid pass probes the real screen).
enum AXInterfaceFrame {
    /// `screen`, the interface screen's size: only a frame that fills it once
    /// turned is turned (a Stage Manager window may well stand upright).
    static func normalize(_ frame: NSRect, interfaceOrientation: String?, screen: CGSize?) -> NSRect {
        guard let interfaceOrientation else { return frame }
        let landscape = interfaceOrientation.hasPrefix("landscape")
        guard landscape != (frame.width > frame.height), frame.width != frame.height else { return frame }
        if let screen, abs(frame.height - screen.width) >= 1 || abs(frame.width - screen.height) >= 1 { return frame }
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

    /// The inverse of fromFixed: hit-tests take points in the fixed screen.
    static func toFixed(_ frame: NSRect, screen: CGSize, interfaceOrientation: String?) -> NSRect {
        let (x, y, w, h) = (frame.origin.x, frame.origin.y, frame.width, frame.height)
        switch interfaceOrientation {
        case "landscape_left": return NSRect(x: y, y: screen.height - x - w, width: h, height: w)
        case "landscape_right": return NSRect(x: screen.width - y - h, y: x, width: h, height: w)
        case "portrait_upside_down": return NSRect(x: screen.width - x - w, y: screen.height - y - h, width: w, height: h)
        default: return frame
        }
    }

    static func toFixed(_ point: CGPoint, screen: CGSize, interfaceOrientation: String?) -> CGPoint {
        toFixed(NSRect(origin: point, size: .zero), screen: screen, interfaceOrientation: interfaceOrientation).origin
    }
}
