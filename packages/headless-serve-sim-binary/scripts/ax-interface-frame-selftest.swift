import Foundation

@main
private enum AXInterfaceFrameSelftest {
    static func main() {
        // The open Duo reports its application in the inner panel's fixed
        // portrait space while every element inside is laid out wide.
        let duoApp = NSRect(x: 0, y: 0, width: 669, height: 951)
        precondition(AXInterfaceFrame.normalize(duoApp, interfaceOrientation: "landscape_right")
            == NSRect(x: 0, y: 0, width: 951, height: 669), "A landscape interface gets a landscape app frame")
        precondition(AXInterfaceFrame.normalize(duoApp, interfaceOrientation: "landscape_left")
            == NSRect(x: 0, y: 0, width: 951, height: 669))
        // Frames that already agree are left alone.
        let wide = NSRect(x: 0, y: 0, width: 912, height: 420)
        precondition(AXInterfaceFrame.normalize(wide, interfaceOrientation: "landscape_left") == wide)
        precondition(AXInterfaceFrame.normalize(duoApp, interfaceOrientation: "portrait") == duoApp)
        precondition(AXInterfaceFrame.normalize(duoApp, interfaceOrientation: "portrait_upside_down") == duoApp)
        precondition(AXInterfaceFrame.normalize(wide, interfaceOrientation: "portrait")
            == NSRect(x: 0, y: 0, width: 420, height: 912), "A portrait interface gets a portrait app frame")
        // Unknown orientation: trust iOS.
        precondition(AXInterfaceFrame.normalize(duoApp, interfaceOrientation: nil) == duoApp)

        // SpringBoard lays every frame out in the fixed portrait screen. These
        // are the 13" iPad's Safari and Settings icons, checked on screenshots.
        let ipad = CGSize(width: 1032, height: 1376)
        func fixed(_ frame: NSRect, _ orientation: String?) -> NSRect {
            AXInterfaceFrame.fromFixed(frame, screen: ipad, interfaceOrientation: orientation)
        }
        precondition(fixed(NSRect(x: 936.5, y: 785, width: 68, height: 68), "landscape_left")
            == NSRect(x: 523, y: 936.5, width: 68, height: 68), "The dock runs along the bottom")
        precondition(fixed(NSRect(x: 710, y: 1146, width: 95.5, height: 72), "landscape_left")
            == NSRect(x: 158, y: 710, width: 72, height: 95.5), "An icon and its label stand upright")
        precondition(fixed(NSRect(x: 28, y: 469, width: 68, height: 68), "landscape_right")
            == NSRect(x: 469, y: 936, width: 68, height: 68))
        precondition(fixed(NSRect(x: 667, y: 28, width: 68, height: 68), "portrait_upside_down")
            == NSRect(x: 297, y: 1280, width: 68, height: 68))
        let icon = NSRect(x: 10, y: 20, width: 30, height: 40)
        precondition(fixed(icon, "portrait") == icon)
        precondition(fixed(icon, nil) == icon)

        // Every frame in a serialized tree moves, children included.
        // serialize() writes CGFloat frames.
        var tree: [String: Any] = [
            "frame": ["x": 0, "y": 0, "width": 1032, "height": 1376] as [String: CGFloat],
            "children": [["frame": ["x": 667, "y": 28, "width": 68, "height": 68] as [String: CGFloat],
                          "children": [[String: Any]]()]],
        ]
        AXInterfaceFrame.mapFrames(in: &tree) { fixed($0, "portrait_upside_down") }
        let child = (tree["children"] as! [[String: Any]])[0]["frame"] as! [String: CGFloat]
        precondition(child == ["x": 297, "y": 1280, "width": 68, "height": 68])
        print("AX interface frame self-test passed")
    }
}
