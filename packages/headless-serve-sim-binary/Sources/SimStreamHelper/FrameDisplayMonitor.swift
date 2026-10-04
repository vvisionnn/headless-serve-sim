import Foundation

/// CoreSimulator's screen backlight can stay bound to the primary panel even
/// when the runtime activates another display. Query CoreDevice off the frame
/// queue, only for multi-panel devices, never from a frame callback.
final class FrameDisplayMonitor {
    private let queue = DispatchQueue(label: "frame-display-monitor", qos: .utility)
    private let streamQueue = DispatchQueue(label: "frame-display-stream", qos: .userInteractive)
    private var timer: DispatchSourceTimer?
    private var activeProcess: Process?
    private var streamProcess: Process?
    private var primaryDisplay: FrameObservedDisplay?
    private var ambiguousRuntime = false
    private var streamInput: Pipe?
    private let lock = NSLock()
    var onHinge: ((Double) -> Void)?
    private let makeProcess: (String) -> Process
    private let makeStreamProcess: (String, String) -> Process

    init(makeProcess: @escaping (String) -> Process = { deviceUDID in
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = ["devicectl", "device", "info", "displays", "--device", deviceUDID,
                             "--quiet", "--json-output", "-", "--timeout", "5"]
        return process
    }, makeStreamProcess: @escaping (String, String) -> Process = { deviceUDID, observerPath in
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = ["simctl", "spawn", deviceUDID, observerPath]
        return process
    }) {
        self.makeProcess = makeProcess
        self.makeStreamProcess = makeStreamProcess
    }

    func start(deviceUDID: String, allowedIDs: Set<Int> = [], observerPath: String? = nil,
               onDisplay: @escaping (FrameObservedDisplay) -> Void) {
        let hasStream = observerPath.map { FileManager.default.isExecutableFile(atPath: $0) } ?? false
        if hasStream, let observerPath {
            startStream(deviceUDID: deviceUDID, allowedIDs: allowedIDs, observerPath: observerPath, onDisplay: onDisplay)
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .seconds(1))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let requiresPrimary = self.streamProcess == nil || self.ambiguousRuntime
            self.lock.unlock()
            guard requiresPrimary else { return }
            let process = self.makeProcess(deviceUDID)
            let output = Pipe()
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            let finished = DispatchSemaphore(value: 0)
            process.terminationHandler = { _ in finished.signal() }
            self.lock.lock()
            guard self.timer != nil else {
                self.lock.unlock()
                return
            }
            self.activeProcess = process
            do {
                try process.run()
                self.lock.unlock()
            } catch {
                self.activeProcess = nil
                self.lock.unlock()
                return
            }
            defer {
                self.lock.lock()
                if self.activeProcess === process { self.activeProcess = nil }
                self.lock.unlock()
            }
            if finished.wait(timeout: .now() + .seconds(7)) == .timedOut {
                process.terminate()
                return
            }
            guard process.terminationStatus == 0,
                  let display = FrameObservedDisplay.parse(output.fileHandleForReading.readDataToEndOfFile()) else { return }
            self.lock.lock()
            let running = self.timer != nil && (self.streamProcess == nil || self.ambiguousRuntime)
            if running { self.primaryDisplay = display }
            self.lock.unlock()
            if running { onDisplay(display) }
        }
        lock.lock()
        self.timer = timer
        lock.unlock()
        timer.resume()
    }

    private func startStream(deviceUDID: String, allowedIDs: Set<Int>, observerPath: String,
                             onDisplay: @escaping (FrameObservedDisplay) -> Void) {
        let process = makeStreamProcess(deviceUDID, observerPath)
        let output = Pipe()
        let input = Pipe()
        process.standardOutput = output
        process.standardInput = input
        process.standardError = FileHandle.nullDevice
        lock.lock()
        streamProcess = process
        streamInput = input
        lock.unlock()
        do {
            try process.run()
            input.fileHandleForWriting.write(Data("\n".utf8))
        } catch {
            stop()
            return
        }
        streamQueue.async { [weak self, weak process] in
            guard let process else { return }
            defer {
                if let self {
                    self.lock.lock()
                    if self.streamProcess === process {
                        self.streamProcess = nil
                        try? self.streamInput?.fileHandleForWriting.close()
                        self.streamInput = nil
                        self.primaryDisplay = nil
                        self.timer?.schedule(deadline: .now(), repeating: .seconds(1))
                    }
                    self.lock.unlock()
                }
            }
            var pending = Data()
            var previousID: Int?
            while process.isRunning {
                let chunk = output.fileHandleForReading.availableData
                if chunk.isEmpty { break }
                pending.append(chunk)
                if pending.count > 64 * 1024 { pending.removeAll(); continue }
                while let newline = pending.firstIndex(of: 10) {
                    let line = pending.prefix(upTo: newline)
                    pending.removeSubrange(...newline)
                    guard let self else { return }
                    let json = (try? JSONSerialization.jsonObject(with: Data(line))) as? [String: Any]
                    let sample = FrameRuntimeDisplaySample(json: json, allowedIDs: allowedIDs)
                    if let angle = sample.hingeAngle { self.onHinge?(angle) }
                    self.lock.lock()
                    let wasAmbiguous = self.ambiguousRuntime
                    self.ambiguousRuntime = sample.active.count != 1
                    if sample.active.count == 1 { self.primaryDisplay = nil }
                    let primary = self.primaryDisplay
                    let running = self.streamProcess === process
                    let timer = self.timer
                    self.lock.unlock()
                    if sample.active.count != 1 && !wasAmbiguous { timer?.schedule(deadline: .now(), repeating: .seconds(1)) }
                    let display = sample.display(previousID: primary?.displayID ?? previousID) ?? primary
                    guard let display else { continue }
                    previousID = display.displayID
                    if running { onDisplay(display) }
                }
            }
        }
    }

    func stop() {
        lock.lock()
        timer?.cancel()
        timer = nil
        if let activeProcess, activeProcess.isRunning {
            activeProcess.terminate()
        }
        activeProcess = nil
        if let streamProcess, streamProcess.isRunning { streamProcess.terminate() }
        streamProcess = nil
        primaryDisplay = nil
        ambiguousRuntime = false
        try? streamInput?.fileHandleForWriting.close()
        streamInput = nil
        lock.unlock()
    }

    deinit {
        stop()
    }
}

private struct FrameRuntimeDisplaySample {
    let hingeAngle: Double?
    let active: [[String: Any]]
    let inactive: [String: Any]?

    init(json: [String: Any]?, allowedIDs: Set<Int>) {
        if let angle = json?["hingeAngle"] as? Double, angle.isFinite, (0...180).contains(angle) { hingeAngle = angle }
        else { hingeAngle = nil }
        let displays = json?["displays"] as? [[String: Any]] ?? []
        active = displays.filter { display in
            guard let id = display["displayId"] as? Int else { return false }
            return allowedIDs.contains(id) && display["active"] as? Bool == true
        }
        inactive = displays.first {
            guard let id = $0["displayId"] as? Int, allowedIDs.contains(id) else { return false }
            return ($0["state"] as? Int) == 2
        }
    }

    func display(previousID: Int?) -> FrameObservedDisplay? {
        guard let selected = active.first(where: { $0["displayId"] as? Int == previousID })
                ?? (active.count == 1 ? active.first : nil) ?? inactive,
              let displayID = selected["displayId"] as? Int else { return nil }
        let rotation: Int
        switch selected["currentOrientation"] as? String {
        case "rot90": rotation = 90
        case "rot180": rotation = 180
        case "rot270": rotation = 270
        default: rotation = 0
        }
        return FrameObservedDisplay(displayID: displayID, rotation: rotation, blanked: (selected["state"] as? Int) == 2)
    }
}

struct FrameObservedDisplay: Equatable {
    let displayID: Int
    let rotation: Int
    var blanked = false

    static func parseRuntime(_ data: Data, allowedIDs: Set<Int>, previousID: Int?) -> FrameObservedDisplay? {
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        return FrameRuntimeDisplaySample(json: json, allowedIDs: allowedIDs).display(previousID: previousID)
    }

    static func parse(_ data: Data) -> FrameObservedDisplay? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let result = json["result"] as? [String: Any],
              let displays = result["displays"] as? [[String: Any]],
              let active = displays.first(where: { $0["backlightState"] as? String == "activeOn" && $0["active"] as? Bool == true })
                ?? displays.first(where: { $0["backlightState"] as? String == "activeOn" })
                ?? displays.first(where: { $0["active"] as? Bool == true }),
              let displayID = active["displayId"] as? Int else { return nil }
        let rotation: Int
        switch active["currentOrientation"] as? String {
        case "rot90": rotation = 90
        case "rot180": rotation = 180
        case "rot270": rotation = 270
        default: rotation = 0
        }
        let backlight = active["backlightState"] as? String
        return FrameObservedDisplay(displayID: displayID, rotation: rotation,
                                    blanked: backlight == "inactiveOn" || backlight == "off")
    }
}
