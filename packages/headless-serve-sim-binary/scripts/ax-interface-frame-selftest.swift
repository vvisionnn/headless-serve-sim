import Foundation

@main
private enum AXInterfaceFrameSelftest {
    static func main() {
        // The open Duo reports its application in the inner panel's fixed
        // portrait space while every element inside is laid out wide.
        let duoApp = NSRect(x: 0, y: 0, width: 669, height: 951)
        let duoScreen = CGSize(width: 951, height: 669)
        precondition(AXInterfaceFrame.normalize(duoApp, interfaceOrientation: "landscape_right", screen: duoScreen)
            == NSRect(x: 0, y: 0, width: 951, height: 669), "A landscape interface gets a landscape app frame")
        precondition(AXInterfaceFrame.normalize(duoApp, interfaceOrientation: "landscape_left", screen: duoScreen)
            == NSRect(x: 0, y: 0, width: 951, height: 669))
        // Frames that already agree are left alone.
        let wide = NSRect(x: 0, y: 0, width: 912, height: 420)
        precondition(AXInterfaceFrame.normalize(wide, interfaceOrientation: "landscape_left", screen: duoScreen) == wide)
        precondition(AXInterfaceFrame.normalize(duoApp, interfaceOrientation: "portrait", screen: CGSize(width: 669, height: 951)) == duoApp)
        precondition(AXInterfaceFrame.normalize(duoApp, interfaceOrientation: "portrait_upside_down", screen: CGSize(width: 669, height: 951)) == duoApp)
        precondition(AXInterfaceFrame.normalize(wide, interfaceOrientation: "portrait", screen: CGSize(width: 420, height: 912))
            == NSRect(x: 0, y: 0, width: 420, height: 912), "A portrait interface gets a portrait app frame")
        // A Stage Manager window can stand upright on a landscape screen.
        let window = NSRect(x: 0, y: 0, width: 610, height: 671)
        precondition(AXInterfaceFrame.normalize(window, interfaceOrientation: "landscape_left", screen: CGSize(width: 1376, height: 1032))
            == window, "Only a screen-filling app frame is turned")
        // Unknown orientation: trust iOS.
        precondition(AXInterfaceFrame.normalize(duoApp, interfaceOrientation: nil, screen: duoScreen) == duoApp)

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

        // Hit-tests take fixed points: toFixed undoes fromFixed.
        let safari = NSRect(x: 936.5, y: 785, width: 68, height: 68)
        for orientation in ["portrait", "portrait_upside_down", "landscape_left", "landscape_right"] {
            let shown = fixed(safari, orientation)
            precondition(AXInterfaceFrame.toFixed(shown, screen: ipad, interfaceOrientation: orientation) == safari,
                         "\(orientation) round trip")
            let center = CGPoint(x: shown.midX, y: shown.midY)
            precondition(AXInterfaceFrame.toFixed(center, screen: ipad, interfaceOrientation: orientation)
                == CGPoint(x: safari.midX, y: safari.midY), "\(orientation) point")
        }
        // The landscape_left point measured on the simulator: interface
        // (616, 470) hits the fixed point (470, 760).
        precondition(AXInterfaceFrame.toFixed(CGPoint(x: 616, y: 470), screen: ipad, interfaceOrientation: "landscape_left")
            == CGPoint(x: 470, y: 760))
        print("AX interface frame self-test passed")
    }
}
