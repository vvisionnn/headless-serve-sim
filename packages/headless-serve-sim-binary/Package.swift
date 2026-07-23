// swift-tools-version: 5.9
import PackageDescription
import Foundation

let developerDir = ProcessInfo.processInfo.environment["DEVELOPER_DIR"]
    ?? "/Applications/Xcode.app/Contents/Developer"
let privateFrameworks = "\(developerDir)/Library/PrivateFrameworks"
// Xcode 26/27 relocated SimulatorKit & CoreSimulator from Developer/Library/
// PrivateFrameworks to Contents/SharedFrameworks. Search both so the helper
// links across toolchain layouts (older Xcode and the 27 beta).
let sharedFrameworks = "\(developerDir)/../SharedFrameworks"

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
            swiftSettings: [
                .unsafeFlags([
                    "-F/Library/Developer/PrivateFrameworks",
                    "-F\(privateFrameworks)",
                    "-F\(sharedFrameworks)",
                ]),
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-F/Library/Developer/PrivateFrameworks",
                    "-F\(privateFrameworks)",
                    "-F\(sharedFrameworks)",
                    "-Xlinker", "-rpath", "-Xlinker", "/Library/Developer/PrivateFrameworks",
                    "-Xlinker", "-rpath", "-Xlinker", "\(privateFrameworks)",
                    "-Xlinker", "-rpath", "-Xlinker", "\(sharedFrameworks)",
                ]),
                .linkedFramework("CoreSimulator"),
                .linkedFramework("SimulatorKit"),
                .linkedFramework("VideoToolbox"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("IOSurface"),
            ]
        ),
    ]
)
