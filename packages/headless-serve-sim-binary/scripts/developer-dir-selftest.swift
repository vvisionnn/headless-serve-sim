import Foundation

@main
private enum DeveloperDirSelftest {
    /// Writes an executable shell script to a temp path and returns it.
    static func stub(_ body: String) -> String {
        let path = NSTemporaryDirectory() + "developer-dir-selftest-\(UUID().uuidString)"
        try! "#!/bin/sh\n\(body)\n".write(toFile: path, atomically: true, encoding: .utf8)
        try! FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: path)
        return path
    }

    static func main() {
        // A tool that can't be launched must fall back, not trap. Before this
        // was guarded, `waitUntilExit()` ran on an unstarted Process and
        // aborted the whole helper.
        precondition(DeveloperDir.resolve(tool: "/nonexistent/xcode-select") == DeveloperDir.fallback)

        // A path that exists but isn't executable fails at spawn too.
        let notExecutable = NSTemporaryDirectory() + "developer-dir-selftest-\(UUID().uuidString)"
        try! "not a program".write(toFile: notExecutable, atomically: true, encoding: .utf8)
        try! FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: notExecutable)
        precondition(DeveloperDir.resolve(tool: notExecutable) == DeveloperDir.fallback)

        // A normal answer is returned verbatim, minus surrounding whitespace.
        let ok = stub("echo '/Applications/Xcode-beta.app/Contents/Developer'")
        precondition(DeveloperDir.resolve(tool: ok) == "/Applications/Xcode-beta.app/Contents/Developer")

        // No Xcode selected: xcode-select exits non-zero. An empty developer
        // dir would make SimFrameworks dlopen paths rooted at `/`, so this has
        // to fall back rather than return "".
        let failing = stub("exit 2")
        precondition(DeveloperDir.resolve(tool: failing) == DeveloperDir.fallback)

        // Exit 0 with no output is the same hazard.
        let silent = stub("exit 0")
        precondition(DeveloperDir.resolve(tool: silent) == DeveloperDir.fallback)

        for path in [notExecutable, ok, failing, silent] {
            try? FileManager.default.removeItem(atPath: path)
        }
        print("DeveloperDir self-test passed")
    }
}
