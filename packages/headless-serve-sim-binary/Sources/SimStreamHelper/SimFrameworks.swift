import Foundation

/// Loads the private simulator frameworks into the process.
///
/// CoreSimulator and SimulatorKit are used purely through the Objective-C
/// runtime (`NSClassFromString` / selectors / `dlsym`), never imported, so they
/// are `dlopen`'d from the active Xcode instead of being linked in
/// `Package.swift`. That is deliberate: a link-time dependency bakes an
/// `@rpath/SimulatorKit.framework` load command pointing at whatever Xcode built
/// the binary, and the framework's location is not stable across toolchains —
/// Xcode 27 moved SimulatorKit from `Developer/Library/PrivateFrameworks` to
/// `Contents/SharedFrameworks`. Loading by path at runtime means a binary built
/// against any Xcode runs against any other.
enum SimFrameworks {
    private static var loaded = false

    static func load() {
        guard !loaded else { return }
        loaded = true

        let dev = FrameCapture.getDeveloperDir()
        // CoreSimulator is installed system-wide; SimulatorKit lives inside Xcode
        // and moved in 27. Try every known location — a miss is harmless.
        let candidates = [
            "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
            "\(dev)/Library/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
            "\(dev)/../SharedFrameworks/SimulatorKit.framework/SimulatorKit", // Xcode 27+
            "\(dev)/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit", // Xcode 26 and older
        ]
        for path in candidates { _ = dlopen(path, RTLD_NOW) }
    }
}
