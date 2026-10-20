import Foundation

@main
private enum GuestMotionSelftest {
    static func main() {
        // 0x07 carries a UIDeviceOrientation; the motion sensor takes its name.
        precondition(GuestMotion.sensorOrientation(deviceOrientation: 1) == "portrait")
        precondition(GuestMotion.sensorOrientation(deviceOrientation: 2) == "portraitUpsideDown")
        precondition(GuestMotion.sensorOrientation(deviceOrientation: 3) == "landscapeLeft")
        precondition(GuestMotion.sensorOrientation(deviceOrientation: 4) == "landscapeRight")
        precondition(GuestMotion.sensorOrientation(deviceOrientation: 0) == nil)
        precondition(GuestMotion.sensorOrientation(deviceOrientation: 5) == nil)
        // No usable binary, no session: callers fall back to the GSEvent route.
        precondition(GuestMotion(deviceUDID: "X", binaryPath: nil) == nil)
        precondition(GuestMotion(deviceUDID: "X", binaryPath: "/nonexistent/motion") == nil)
        print("Guest motion self-test passed")
    }
}
