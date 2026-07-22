import Foundation

@main
private enum KeyframeRequestSelftest {
    static func main() {
        let request = KeyframeRequest()
        precondition(!request.isPending())
        request.request()
        request.request()
        precondition(request.isPending())
        precondition(request.consume())
        precondition(!request.consume())
        precondition(!request.isPending())
        print("Keyframe request self-test passed")
    }
}
