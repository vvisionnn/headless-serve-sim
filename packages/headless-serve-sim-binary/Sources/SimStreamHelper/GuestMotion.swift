import Foundation

/// A long-lived `sim-device-motion` session inside the guest: one JSON command
/// per stdin line. A multi-panel device (the Duo) follows this simulated motion
/// sensor and ignores the GSEvent orientation older simulators take, so the
/// 0x07 opcode is routed here for it. Spawned on first use, and again after it
/// exits; its replies are dropped.
final class GuestMotion {
    private let deviceUDID: String
    private let binaryPath: String
    private let queue = DispatchQueue(label: "guest-motion")
    private var process: Process?
    private var input: FileHandle?

    /// Nil when the motion binary isn't installed beside the helper.
    init?(deviceUDID: String, binaryPath: String?) {
        guard let binaryPath, FileManager.default.isExecutableFile(atPath: binaryPath) else { return nil }
        self.deviceUDID = deviceUDID
        self.binaryPath = binaryPath
    }

    /// The motion sensor's name for a UIDeviceOrientation (the 0x07 value).
    static func sensorOrientation(deviceOrientation: UInt32) -> String? {
        switch deviceOrientation {
        case 1: return "portrait"
        case 2: return "portraitUpsideDown"
        case 3: return "landscapeLeft"
        case 4: return "landscapeRight"
        default: return nil
        }
    }

    func setOrientation(deviceOrientation: UInt32) -> Bool {
        guard let name = Self.sensorOrientation(deviceOrientation: deviceOrientation) else { return false }
        send(["command": "orientation", "orientation": name])
        return true
    }

    private func send(_ command: [String: Any]) {
        queue.async { [self] in
            guard var line = try? JSONSerialization.data(withJSONObject: command) else { return }
            line.append(0x0A)
            if process?.isRunning != true { start() }
            do {
                try input?.write(contentsOf: line)
            } catch {
                print("[motion] Write failed: \(error.localizedDescription)")
                process = nil
                input = nil
            }
        }
    }

    private func start() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = ["simctl", "spawn", deviceUDID, binaryPath]
        let pipe = Pipe()
        process.standardInput = pipe
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            self.process = process
            input = pipe.fileHandleForWriting
            print("[motion] Guest motion session started")
        } catch {
            print("[motion] Failed to start guest motion session: \(error.localizedDescription)")
        }
    }

    func stop() {
        queue.sync {
            try? input?.close()
            process?.terminate()
            input = nil
            process = nil
        }
    }
}
