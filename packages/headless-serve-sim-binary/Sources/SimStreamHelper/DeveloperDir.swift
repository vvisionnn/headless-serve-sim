import Foundation

/// Resolves the active Xcode's Developer directory (`xcode-select -p`).
///
/// Split out of `FrameCapture` so the launch-failure path is reachable from a
/// self-test: `tool` is injectable, and every failure mode has to land on
/// `fallback` rather than trapping or returning an empty path that would make
/// `SimFrameworks` build framework paths rooted at `/`.
enum DeveloperDir {
    static let fallback = "/Applications/Xcode.app/Contents/Developer"

    static func resolve(tool: String = "/usr/bin/xcode-select") -> String {
        let pipe = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = ["-p"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        // Only wait/read once the process actually launched. `waitUntilExit()`
        // on an unstarted Process traps, so a missing or non-executable
        // xcode-select would abort the helper instead of falling back.
        do {
            try process.run()
        } catch {
            return fallback
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return fallback }
        let out = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let out, !out.isEmpty else { return fallback }
        return out
    }
}
