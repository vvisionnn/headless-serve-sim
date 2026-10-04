import Foundation

@main
private enum FrameDisplaySelectorSelftest {
    static func main() {
        selectsActiveOuterInsteadOfLargestInactiveInner()
        selectsLargestSurfaceWhenMetadataIsUnavailable()
        ignoresEmptySurfaces()
        reportsRotationSeparatelyFromStorageDimensions()
        detectsDisplayChangesWithoutDimensionChanges()
        authoritativeActivityOverridesStaleBacklight()
        onlyConnectedIntegratedDisplaysCanRouteTouches()
        parsesObservedDisplayActivity()
        parsesRuntimeDisplayActivity()
        stoppingMonitorTerminatesInFlightProcess()
        runtimeStreamStopsWithOwnedProcess()
        corroboratesPrimaryFocusWhileBothRuntimePanelsAreEnabled()
        parsesRuntimeDisplayBlanking()
        observerExitActivatesPrimaryFallback()
        observerLineIsDeserializedOnce()
        print("Frame display selector self-test passed")
    }

    static func observerLineIsDeserializedOnce() {
        let sourceURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/SimStreamHelper/FrameDisplayMonitor.swift")
        let source = try! String(contentsOf: sourceURL, encoding: .utf8)
        let stream = source.components(separatedBy: "streamQueue.async")[1].components(separatedBy: "    func stop()")[0]
        precondition(stream.components(separatedBy: "JSONSerialization.jsonObject").count - 1 == 1,
                     "observer line must build only one JSON object graph")
        precondition(!stream.contains("parseRuntime(Data(line)"), "runtime selection must reuse the parsed observer sample")
    }

    static func observerExitActivatesPrimaryFallback() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let script = directory.appendingPathComponent("observer")
        let runtime = #"{"hingeAngle":130,"displays":[{"displayId":3,"active":true,"currentOrientation":"rot0"}]}"#
        try! Data(("#!/bin/sh\nprintf '%s\\n' '" + runtime + "'\nread line\nread line\n").utf8).write(to: script)
        try! FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [script.path]
        let primary = #"{"result":{"displays":[{"displayId":1,"active":true,"backlightState":"inactiveOn","currentOrientation":"rot90"}]}}"#
        let lock = NSLock()
        var samples: [FrameObservedDisplay] = []
        let monitor = FrameDisplayMonitor(makeProcess: { _ in
            let fallback = Process()
            fallback.executableURL = URL(fileURLWithPath: "/usr/bin/printf")
            fallback.arguments = ["%s", primary]
            return fallback
        }, makeStreamProcess: { _, _ in process })
        monitor.start(deviceUDID: "test", allowedIDs: [1, 3], observerPath: script.path) { display in
            lock.lock(); samples.append(display); lock.unlock()
        }
        defer { monitor.stop() }
        var seeded = false
        for _ in 0..<200 {
            lock.lock(); seeded = samples.contains(FrameObservedDisplay(displayID: 3, rotation: 0)); lock.unlock()
            if seeded { break }
            Thread.sleep(forTimeInterval: 0.01)
        }
        precondition(seeded, "observer must publish its first unambiguous sample")
        process.terminate()
        let expected = FrameObservedDisplay(displayID: 1, rotation: 90, blanked: true)
        var recovered = false
        for _ in 0..<260 {
            lock.lock(); recovered = samples.last == expected; lock.unlock()
            if recovered { break }
            Thread.sleep(forTimeInterval: 0.01)
        }
        precondition(recovered, "observer death must resume primary polling with fresh ID, rotation and blanking")
    }

    static func corroboratesPrimaryFocusWhileBothRuntimePanelsAreEnabled() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let script = directory.appendingPathComponent("observer")
        let runtime = #"{"displays":[{"displayId":1,"active":true,"currentOrientation":"rot0"},{"displayId":3,"active":true,"currentOrientation":"rot90"}]}"#
        try! Data(("#!/bin/sh\nprintf '%s\\n' '" + runtime + "'\nwhile read line; do :; done\n").utf8).write(to: script)
        try! FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
        let primary = #"{"result":{"displays":[{"displayId":1,"active":true,"backlightState":"activeOn","currentOrientation":"rot0"},{"displayId":3,"active":false,"backlightState":"activeOn","currentOrientation":"rot90"}]}}"#
        let lock = NSLock()
        var samples: [FrameObservedDisplay] = []
        let monitor = FrameDisplayMonitor(makeProcess: { _ in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/printf")
            process.arguments = ["%s", primary]
            return process
        }, makeStreamProcess: { _, _ in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/sh")
            process.arguments = [script.path]
            return process
        })
        monitor.start(deviceUDID: "test", allowedIDs: [1, 3], observerPath: script.path) { display in
            lock.lock(); samples.append(display); lock.unlock()
        }
        defer { monitor.stop() }
        var found = false
        for _ in 0..<200 {
            lock.lock(); found = samples.contains(FrameObservedDisplay(displayID: 1, rotation: 0)); lock.unlock()
            if found { break }
            Thread.sleep(forTimeInterval: 0.01)
        }
        guard found else { fatalError("runtime activation cannot establish primary focus when both panels stay enabled") }
    }

    static func runtimeStreamStopsWithOwnedProcess() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let script = directory.appendingPathComponent("observer")
        try! Data("#!/bin/sh\nwhile read line; do :; done\n".utf8).write(to: script)
        try! FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [script.path]
        let monitor = FrameDisplayMonitor(makeStreamProcess: { _, _ in process })
        monitor.start(deviceUDID: "test", allowedIDs: [1, 3], observerPath: script.path) { _ in }
        let deadline = Date().addingTimeInterval(2)
        while !process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
        precondition(process.isRunning, "persistent monitor must own one running observer")
        monitor.stop()
        let stopped = Date().addingTimeInterval(2)
        while process.isRunning && Date() < stopped { Thread.sleep(forTimeInterval: 0.01) }
        precondition(!process.isRunning, "persistent observer must stop with capture")
    }

    static func stoppingMonitorTerminatesInFlightProcess() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sleep")
        process.arguments = ["30"]
        let monitor = FrameDisplayMonitor(makeProcess: { _ in process })
        monitor.start(deviceUDID: "test") { _ in preconditionFailure("stopped monitor must not emit") }
        let deadline = Date().addingTimeInterval(2)
        while !process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
        precondition(process.isRunning, "test process must be in flight")
        monitor.stop()
        let stoppedDeadline = Date().addingTimeInterval(2)
        while process.isRunning && Date() < stoppedDeadline { Thread.sleep(forTimeInterval: 0.01) }
        if process.isRunning {
            process.terminate()
            preconditionFailure("stopping monitor must terminate its in-flight process")
        }
    }

    static func parsesObservedDisplayActivity() {
        let json = #"{"result":{"displays":[{"displayId":1,"active":false,"backlightState":"activeOn","currentOrientation":"rot0"},{"displayId":3,"active":true,"backlightState":"activeOn","currentOrientation":"rot90"}]}}"#
        precondition(FrameObservedDisplay.parse(Data(json.utf8)) == FrameObservedDisplay(displayID: 3, rotation: 90),
                     "active flag must win over stale backlight string")
        let contradictory = #"{"result":{"displays":[{"displayId":1,"active":true,"backlightState":"off","currentOrientation":"rot0","type":{"integrated":{}}},{"displayId":3,"active":false,"backlightState":"activeOn","currentOrientation":"rot90","type":{"integrated":{}}}]}}"#
        precondition(FrameObservedDisplay.parse(Data(contradictory.utf8)) == FrameObservedDisplay(displayID: 3, rotation: 90),
                     "lit panel must win when CoreDevice active flags contradict backlight")
        precondition(FrameObservedDisplay.parse(Data("{}".utf8)) == nil)
        precondition(FrameObservedDisplay.parse(Data("invalid".utf8)) == nil)
    }

    static func parsesRuntimeDisplayBlanking() {
        let locked = Data(#"{"displays":[{"displayId":1,"active":false,"state":2,"currentOrientation":"rot0"},{"displayId":3,"active":false,"state":0,"currentOrientation":"rot90"}]}"#.utf8)
        guard let display = FrameObservedDisplay.parseRuntime(locked, allowedIDs: [1, 3], previousID: 1) else {
            fatalError("inactive-on panel must retain its identity while blanked")
        }
        precondition(display.displayID == 1)
        precondition(display.blanked)
        let core = Data(#"{"result":{"displays":[{"displayId":1,"active":true,"backlightState":"inactiveOn","currentOrientation":"rot0"}]}}"#.utf8)
        guard FrameObservedDisplay.parse(core)?.blanked == true else {
            fatalError("CoreDevice inactive-on state must not overwrite runtime blanking")
        }
    }

    static func parsesRuntimeDisplayActivity() {
        let open = Data(#"{"displays":[{"displayId":1,"active":false,"currentOrientation":"rot0"},{"displayId":3,"active":true,"currentOrientation":"rot90"},{"displayId":2,"active":true,"currentOrientation":"rot0"}]}"#.utf8)
        precondition(FrameObservedDisplay.parseRuntime(open, allowedIDs: [1, 3], previousID: 1) == FrameObservedDisplay(displayID: 3, rotation: 90))
        let both = Data(#"{"displays":[{"displayId":1,"active":true,"currentOrientation":"rot0"},{"displayId":3,"active":true,"currentOrientation":"rot90"}]}"#.utf8)
        precondition(FrameObservedDisplay.parseRuntime(both, allowedIDs: [1, 3], previousID: 3)?.displayID == 3)
        precondition(FrameObservedDisplay.parseRuntime(both, allowedIDs: [1, 3], previousID: 3)?.displayID == 3,
                     "enabling another panel must not change primary focus")
        let closed = Data(#"{"displays":[{"displayId":1,"active":true,"currentOrientation":"rot0"},{"displayId":3,"active":false,"currentOrientation":"rot90"}]}"#.utf8)
        precondition(FrameObservedDisplay.parseRuntime(closed, allowedIDs: [1, 3], previousID: 3)?.displayID == 1)
        let folding = Data(#"{"hingeAngle":177.13,"displays":[{"displayId":1,"active":true,"currentOrientation":"rot90"},{"displayId":3,"active":true,"currentOrientation":"rot90"}]}"#.utf8)
        guard FrameObservedDisplay.parseRuntime(folding, allowedIDs: [1, 3], previousID: 3)?.displayID == 3 else {
            fatalError("Book motion must not focus a temporarily enabled cover at 177 degrees")
        }
        precondition(FrameObservedDisplay.parseRuntime(open, allowedIDs: [1], previousID: 1) == nil)
    }

    static func authoritativeActivityOverridesStaleBacklight() {
        let displays = [
            FrameDisplayCandidate(width: 1398, height: 2034, screenID: 1, screenType: 0, backlightState: 2),
            FrameDisplayCandidate(width: 2007, height: 2853, screenID: 3, screenType: 0, backlightState: -101),
        ]
        precondition(FrameDisplaySelector.select(displays, activeDisplayID: 3) == 1,
                     "observed active panel must override stale CoreSimulator backlight")
        precondition(FrameDisplaySelector.select(displays, activeDisplayID: 99) == 0,
                     "unmatched authoritative ID must retain native fallback")
    }

    static func onlyConnectedIntegratedDisplaysCanRouteTouches() {
        for (displayID, screenType) in [(2, UInt64(1)), (4, 2), (5, 4)] {
            let candidate = FrameDisplayCandidate(width: 100, height: 200,
                                                  screenID: displayID, screenType: screenType)
            precondition(FrameDisplaySelector.touchDisplayID(candidate, hasMultipleIntegratedDisplays: true) == nil,
                         "external display \(displayID) must not become an integrated HID target")
            var binding = FrameDisplayBinding()
            _ = binding.update(descriptorID: ObjectIdentifier(NSObject()), candidate: candidate)
            precondition(binding.state.displayID == displayID,
                         "external capture must preserve its config display identity")
        }
        for displayID in [1, 3] {
            let candidate = FrameDisplayCandidate(width: 100, height: 200,
                                                  screenID: displayID, screenType: 0)
            precondition(FrameDisplaySelector.touchDisplayID(candidate, hasMultipleIntegratedDisplays: true) == displayID)
            precondition(FrameDisplaySelector.touchDisplayID(candidate, hasMultipleIntegratedDisplays: false) == nil,
                         "ordinary devices must retain legacy HID routing")
        }
        precondition(FrameDisplaySelector.touchDisplayID(nil, hasMultipleIntegratedDisplays: true) == nil)
        precondition(FrameDisplaySelector.touchDisplayID(
            FrameDisplayCandidate(width: 0, height: 200, screenID: 3, screenType: 0),
            hasMultipleIntegratedDisplays: true) == nil, "disconnected surface must not retain a touch target")
        precondition(FrameDisplaySelector.touchDisplayID(
            FrameDisplayCandidate(width: 100, height: 200, screenID: 3),
            hasMultipleIntegratedDisplays: true) == nil, "unknown screen type must not become an integrated HID target")
    }

    static func detectsDisplayChangesWithoutDimensionChanges() {
        let outer = NSObject()
        let inner = NSObject()
        var binding = FrameDisplayBinding()
        let first = binding.update(descriptorID: ObjectIdentifier(outer), candidate:
            FrameDisplayCandidate(width: 100, height: 200, screenID: 1, uiOrientation: 1))
        precondition(first.bindingChanged && first.stateChanged, "first display must publish its state")
        let same = binding.update(descriptorID: ObjectIdentifier(outer), candidate:
            FrameDisplayCandidate(width: 100, height: 200, screenID: 1, uiOrientation: 1))
        precondition(!same.bindingChanged && !same.stateChanged)
        let switched = binding.update(descriptorID: ObjectIdentifier(inner), candidate:
            FrameDisplayCandidate(width: 100, height: 200, screenID: 3, uiOrientation: 1))
        precondition(switched.bindingChanged && switched.stateChanged,
                     "same-size panel switch must invalidate seeds and publish display ID")
        let rotated = binding.update(descriptorID: ObjectIdentifier(inner), candidate:
            FrameDisplayCandidate(width: 100, height: 200, screenID: 3, uiOrientation: 3))
        precondition(!rotated.bindingChanged && rotated.stateChanged,
                     "orientation must publish independently of size")
        precondition(binding.state == FrameDisplayState(displayID: 3, rotation: 270))
    }

    static func reportsRotationSeparatelyFromStorageDimensions() {
        for (orientation, rotation) in [(UInt32(1), 0), (2, 180), (3, 270), (4, 90)] {
            precondition(FrameDisplaySelector.rotation(uiOrientation: orientation) == rotation,
                         "UI orientation \(orientation) must report rotation \(rotation)")
        }
        precondition(FrameDisplaySelector.rotation(uiOrientation: nil) == 0)
        precondition(FrameDisplaySelector.rotation(uiOrientation: 0) == 0)
    }

    static func selectsLargestSurfaceWhenMetadataIsUnavailable() {
        let displays = [
            FrameDisplayCandidate(width: 300, height: 400),
            FrameDisplayCandidate(width: 1200, height: 2600),
        ]
        precondition(FrameDisplaySelector.select(displays) == 1)
    }

    static func ignoresEmptySurfaces() {
        precondition(FrameDisplaySelector.select([]) == nil)
        precondition(FrameDisplaySelector.select([
            FrameDisplayCandidate(width: 0, height: 2853, screenType: 0, backlightState: 2),
            FrameDisplayCandidate(width: 1398, height: 2034),
        ]) == 1)
    }

    static func selectsActiveOuterInsteadOfLargestInactiveInner() {
        let displays = [
            FrameDisplayCandidate(width: 2007, height: 2853, screenID: 3, screenType: 0, backlightState: -101),
            FrameDisplayCandidate(width: 1398, height: 2034, screenID: 1, screenType: 0, backlightState: 2),
        ]
        precondition(FrameDisplaySelector.select(displays) == 1,
                     "closed Duo must capture active outer display, not larger inactive inner display")
    }
}
