// swift-tools-version: 5.9
import PackageDescription

// CoreSimulator and SimulatorKit are deliberately NOT linked here. They are
// reached entirely through the Objective-C runtime and dlsym, and are loaded at
// runtime by `SimFrameworks.load()`. Linking them would bake an
// `@rpath/SimulatorKit.framework` load command pointing at the build machine's
// Xcode, and that path is not stable across toolchains (Xcode 27 moved
// SimulatorKit from `Developer/Library/PrivateFrameworks` to
// `Contents/SharedFrameworks`), so a release binary would fail to launch on a
// host with a different Xcode. Loading by path keeps the binary portable.
let package = Package(
    name: "SimStreamHelper",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/httpswift/swifter.git", from: "1.5.0"),
    ],
    targets: [
        .executableTarget(
            name: "headless-serve-sim-bin",
            dependencies: [
                .product(name: "Swifter", package: "swifter"),
            ],
            path: "Sources/SimStreamHelper",
            linkerSettings: [
                .linkedFramework("VideoToolbox"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("IOSurface"),
            ]
        ),
    ]
)
