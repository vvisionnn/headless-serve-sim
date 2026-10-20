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
        print("AX interface frame self-test passed")
    }
}
