import Darwin
import Foundation

struct ProcessMetricsCounters {
    let pid: Int32
    let processStartAbsoluteTime: UInt64
    let userTimeTicks: UInt64
    let systemTimeTicks: UInt64
    let memoryFootprintBytes: UInt64
    let residentBytes: UInt64
    let peakMemoryFootprintBytes: UInt64
    let diskReadBytes: UInt64
    let diskWriteBytes: UInt64
    let idleWakeups: UInt64
    let interruptWakeups: UInt64
    let pageIns: UInt64
    let threadCount: Int32
    let runningThreadCount: Int32
}

struct TimedProcessMetricsCounters {
    let sampledAtTicks: UInt64
    let counters: ProcessMetricsCounters
}

struct ProcessMetricsRates {
    let cpuPercent: Double?
    let cpuUserPercent: Double?
    let cpuSystemPercent: Double?
    let diskReadBytesPerSecond: Double?
    let diskWriteBytesPerSecond: Double?
    let wakeupsPerSecond: Double?
    let pageInsPerSecond: Double?
}

private func counterDelta(previous: UInt64, current: UInt64) -> UInt64? {
    current >= previous ? current - previous : nil
}

func machTicksToSeconds(_ ticks: UInt64) -> Double {
    var timebase = mach_timebase_info_data_t()
    guard mach_timebase_info(&timebase) == KERN_SUCCESS else { return 0 }
    return Double(ticks) * Double(timebase.numer)
        / Double(timebase.denom) / 1_000_000_000
}

func deriveProcessMetricsRates(
    previous: TimedProcessMetricsCounters?,
    current: TimedProcessMetricsCounters,
    ticksToSeconds: (UInt64) -> Double = machTicksToSeconds
) -> ProcessMetricsRates {
    guard let previous,
          previous.counters.pid == current.counters.pid,
          previous.counters.processStartAbsoluteTime == current.counters.processStartAbsoluteTime,
          current.sampledAtTicks > previous.sampledAtTicks
    else {
        return ProcessMetricsRates(
            cpuPercent: nil,
            cpuUserPercent: nil,
            cpuSystemPercent: nil,
            diskReadBytesPerSecond: nil,
            diskWriteBytesPerSecond: nil,
            wakeupsPerSecond: nil,
            pageInsPerSecond: nil
        )
    }

    let elapsedTicks = current.sampledAtTicks - previous.sampledAtTicks
    let elapsedSeconds = ticksToSeconds(elapsedTicks)
    guard elapsedSeconds > 0 else {
        return deriveProcessMetricsRates(previous: nil, current: current)
    }

    let userDelta = counterDelta(
        previous: previous.counters.userTimeTicks,
        current: current.counters.userTimeTicks
    )
    let systemDelta = counterDelta(
        previous: previous.counters.systemTimeTicks,
        current: current.counters.systemTimeTicks
    )

    func rate(previous: UInt64, current: UInt64) -> Double? {
        counterDelta(previous: previous, current: current)
            .map { Double($0) / elapsedSeconds }
    }

    let idleWakeups = rate(
        previous: previous.counters.idleWakeups,
        current: current.counters.idleWakeups
    )
    let interruptWakeups = rate(
        previous: previous.counters.interruptWakeups,
        current: current.counters.interruptWakeups
    )

    return ProcessMetricsRates(
        cpuPercent: userDelta.flatMap { user in
            systemDelta.map { Double(user + $0) / Double(elapsedTicks) * 100 }
        },
        cpuUserPercent: userDelta.map { Double($0) / Double(elapsedTicks) * 100 },
        cpuSystemPercent: systemDelta.map { Double($0) / Double(elapsedTicks) * 100 },
        diskReadBytesPerSecond: rate(
            previous: previous.counters.diskReadBytes,
            current: current.counters.diskReadBytes
        ),
        diskWriteBytesPerSecond: rate(
            previous: previous.counters.diskWriteBytes,
            current: current.counters.diskWriteBytes
        ),
        wakeupsPerSecond: idleWakeups.flatMap { idle in
            interruptWakeups.map { idle + $0 }
        },
        pageInsPerSecond: rate(
            previous: previous.counters.pageIns,
            current: current.counters.pageIns
        )
    )
}

private func readRusage(pid: Int32) -> rusage_info_v4? {
    var usage = rusage_info_v4()
    let result = withUnsafeMutableBytes(of: &usage) { bytes -> Int32 in
        guard let baseAddress = bytes.baseAddress else { return -1 }
        return proc_pid_rusage(
            pid,
            RUSAGE_INFO_V4,
            baseAddress.assumingMemoryBound(to: rusage_info_t?.self)
        )
    }
    return result == 0 ? usage : nil
}

private func readTaskInfo(pid: Int32) -> proc_taskinfo? {
    var task = proc_taskinfo()
    let expectedBytes = Int32(MemoryLayout<proc_taskinfo>.size)
    let result = withUnsafeMutablePointer(to: &task) { pointer in
        proc_pidinfo(pid, PROC_PIDTASKINFO, 0, pointer, expectedBytes)
    }
    return result == expectedBytes ? task : nil
}

func readProcessMetricsCounters(
    pid: Int32,
    expectedBundleIdentifier: String? = nil
) -> ProcessMetricsCounters? {
    guard pid > 0,
          let before = readRusage(pid: pid)
    else { return nil }

    if let expectedBundleIdentifier,
       readProcessBundleIdentifier(pid: pid) != expectedBundleIdentifier {
        return nil
    }

    guard let task = readTaskInfo(pid: pid),
          let after = readRusage(pid: pid),
          before.ri_proc_start_abstime == after.ri_proc_start_abstime
    else { return nil }

    return ProcessMetricsCounters(
        pid: pid,
        processStartAbsoluteTime: after.ri_proc_start_abstime,
        userTimeTicks: after.ri_user_time,
        systemTimeTicks: after.ri_system_time,
        memoryFootprintBytes: after.ri_phys_footprint,
        residentBytes: after.ri_resident_size,
        peakMemoryFootprintBytes: max(
            after.ri_phys_footprint,
            after.ri_lifetime_max_phys_footprint
        ),
        diskReadBytes: after.ri_diskio_bytesread,
        diskWriteBytes: after.ri_diskio_byteswritten,
        idleWakeups: after.ri_pkg_idle_wkups,
        interruptWakeups: after.ri_interrupt_wkups,
        pageIns: after.ri_pageins,
        threadCount: max(0, task.pti_threadnum),
        runningThreadCount: max(0, task.pti_numrunning)
    )
}

func readProcessBundleIdentifier(pid: Int32) -> String? {
    var buffer = [CChar](repeating: 0, count: 4 * 1024)
    let length = buffer.withUnsafeMutableBytes { bytes in
        proc_pidpath(pid, bytes.baseAddress, UInt32(bytes.count))
    }
    guard length > 0 else { return nil }

    var url = URL(fileURLWithPath: String(cString: buffer)).standardizedFileURL
    while url.path != "/" {
        if url.pathExtension == "app",
           let data = try? Data(contentsOf: url.appendingPathComponent("Info.plist")),
           let plist = try? PropertyListSerialization.propertyList(
               from: data,
               format: nil
           ) as? [String: Any] {
            return plist["CFBundleIdentifier"] as? String
        }
        url.deleteLastPathComponent()
    }
    return nil
}

struct ForegroundProcess {
    let bundleId: String
    let pid: Int32
}

func resolveForegroundProcess(
    app: [String: Any],
    resolvePid: (String) -> Int32?
) -> ForegroundProcess? {
    guard let bundleId = app["bundleId"] as? String, !bundleId.isEmpty else {
        return nil
    }

    if let rawPid = app["pid"] as? Int,
       let pid = Int32(exactly: rawPid),
       pid > 0 {
        return ForegroundProcess(bundleId: bundleId, pid: pid)
    }

    guard let pid = resolvePid(bundleId), pid > 0 else { return nil }
    return ForegroundProcess(bundleId: bundleId, pid: pid)
}

struct SimulatorAppProcessIdentity {
    let pid: Int32
    let bundleId: String
    let deviceUDID: String
    let processStartAbsoluteTime: UInt64
}

func readProcessEnvironmentValue(pid: Int32, key: String) -> String? {
    guard pid > 0, !key.isEmpty, !key.contains("=") else { return nil }

    var mib = [CTL_KERN, KERN_PROCARGS2, pid]
    var size = 0
    guard sysctl(&mib, 3, nil, &size, nil, 0) == 0,
          size > 0,
          size <= 1024 * 1024
    else { return nil }

    var bytes = [UInt8](repeating: 0, count: size)
    guard bytes.withUnsafeMutableBytes({ buffer in
        sysctl(&mib, 3, buffer.baseAddress, &size, nil, 0)
    }) == 0 else { return nil }

    let prefix = "\(key)="
    return bytes.prefix(size)
        .split(separator: 0)
        .compactMap { String(bytes: $0, encoding: .utf8) }
        .first(where: { $0.hasPrefix(prefix) })
        .map { String($0.dropFirst(prefix.count)) }
}

func listAllProcessIdentifiers() -> [Int32] {
    let processCount = proc_listallpids(nil, 0)
    guard processCount > 0 else { return [] }

    var pids = [Int32](repeating: 0, count: Int(processCount) + 128)
    let populatedCount = pids.withUnsafeMutableBytes { buffer in
        proc_listallpids(buffer.baseAddress, Int32(buffer.count))
    }
    guard populatedCount > 0 else { return [] }
    return Array(pids.prefix(Int(populatedCount))).filter { $0 > 0 }
}

private func readSimulatorAppProcessIdentity(pid: Int32) -> SimulatorAppProcessIdentity? {
    guard let before = readRusage(pid: pid),
          let bundleId = readProcessBundleIdentifier(pid: pid),
          let deviceUDID = readProcessEnvironmentValue(
              pid: pid,
              key: "SIMULATOR_UDID"
          ),
          let after = readRusage(pid: pid),
          before.ri_proc_start_abstime == after.ri_proc_start_abstime
    else { return nil }

    return SimulatorAppProcessIdentity(
        pid: pid,
        bundleId: bundleId,
        deviceUDID: deviceUDID,
        processStartAbsoluteTime: after.ri_proc_start_abstime
    )
}

final class SimulatorAppPidResolver {
    typealias ProcessListReader = () -> [Int32]
    typealias IdentityReader = (Int32) -> SimulatorAppProcessIdentity?

    private let lock = NSLock()
    private let deviceUDID: String
    private let listProcessIdentifiers: ProcessListReader
    private let readIdentity: IdentityReader
    private var cachedIdentity: SimulatorAppProcessIdentity?

    init(
        deviceUDID: String,
        listProcessIdentifiers: @escaping ProcessListReader = listAllProcessIdentifiers,
        readIdentity: @escaping IdentityReader = readSimulatorAppProcessIdentity
    ) {
        self.deviceUDID = deviceUDID
        self.listProcessIdentifiers = listProcessIdentifiers
        self.readIdentity = readIdentity
    }

    func resolve(bundleId: String) -> Int32? {
        lock.lock()
        defer { lock.unlock() }

        if let cachedIdentity,
           cachedIdentity.bundleId == bundleId,
           let current = readIdentity(cachedIdentity.pid),
           matches(current, bundleId: bundleId) {
            self.cachedIdentity = current
            return current.pid
        }

        let match = listProcessIdentifiers()
            .compactMap(readIdentity)
            .filter { matches($0, bundleId: bundleId) }
            .max { left, right in
                if left.processStartAbsoluteTime == right.processStartAbsoluteTime {
                    return left.pid < right.pid
                }
                return left.processStartAbsoluteTime < right.processStartAbsoluteTime
            }
        cachedIdentity = match
        return match?.pid
    }

    private func matches(
        _ identity: SimulatorAppProcessIdentity,
        bundleId: String
    ) -> Bool {
        identity.bundleId == bundleId &&
            identity.deviceUDID.caseInsensitiveCompare(deviceUDID) == .orderedSame
    }
}

enum ProcessMetricsState: String {
    case live
    case noForegroundApp = "no-foreground-app"
    case unavailable
}

struct ProcessMetricsPayload {
    let state: ProcessMetricsState
    let bundleId: String?
    let pid: Int32?
    let processStartId: String?
    let alive: Bool
    let sampledAtMs: Int64
    let cpuPercent: Double?
    let cpuUserPercent: Double?
    let cpuSystemPercent: Double?
    let memoryFootprintBytes: UInt64?
    let residentBytes: UInt64?
    let peakMemoryFootprintBytes: UInt64?
    let diskReadBytesPerSecond: Double?
    let diskWriteBytesPerSecond: Double?
    let wakeupsPerSecond: Double?
    let pageInsPerSecond: Double?
    let threadCount: Int32?
    let runningThreadCount: Int32?

    static func unavailable(
        bundleId: String? = nil,
        pid: Int32? = nil,
        state: ProcessMetricsState = .unavailable,
        sampledAtMs: Int64
    ) -> ProcessMetricsPayload {
        ProcessMetricsPayload(
            state: state,
            bundleId: bundleId,
            pid: pid,
            processStartId: nil,
            alive: false,
            sampledAtMs: sampledAtMs,
            cpuPercent: nil,
            cpuUserPercent: nil,
            cpuSystemPercent: nil,
            memoryFootprintBytes: nil,
            residentBytes: nil,
            peakMemoryFootprintBytes: nil,
            diskReadBytesPerSecond: nil,
            diskWriteBytesPerSecond: nil,
            wakeupsPerSecond: nil,
            pageInsPerSecond: nil,
            threadCount: nil,
            runningThreadCount: nil
        )
    }

    var jsonObject: [String: Any] {
        func value<T>(_ value: T?) -> Any { value ?? NSNull() }
        return [
            "state": state.rawValue,
            "bundleId": value(bundleId),
            "pid": value(pid),
            "processStartId": value(processStartId),
            "alive": alive,
            "sampledAtMs": sampledAtMs,
            "cpuPercent": value(cpuPercent),
            "cpuUserPercent": value(cpuUserPercent),
            "cpuSystemPercent": value(cpuSystemPercent),
            "memoryFootprintBytes": value(memoryFootprintBytes),
            "residentBytes": value(residentBytes),
            "peakMemoryFootprintBytes": value(peakMemoryFootprintBytes),
            "diskReadBytesPerSecond": value(diskReadBytesPerSecond),
            "diskWriteBytesPerSecond": value(diskWriteBytesPerSecond),
            "wakeupsPerSecond": value(wakeupsPerSecond),
            "pageInsPerSecond": value(pageInsPerSecond),
            "threadCount": value(threadCount),
            "runningThreadCount": value(runningThreadCount),
        ]
    }
}

final class ProcessMetricsSampler {
    typealias Reader = (Int32, String) -> ProcessMetricsCounters?
    typealias TicksToSeconds = (UInt64) -> Double

    private let lock = NSLock()
    private let reader: Reader
    private let ticksToSeconds: TicksToSeconds
    private let minimumSampleIntervalSeconds: Double
    private let maximumRateIntervalSeconds: Double
    private var previous: TimedProcessMetricsCounters?
    private var latest: (sampledAtTicks: UInt64, payload: ProcessMetricsPayload)?

    init(
        reader: @escaping Reader = { pid, bundleIdentifier in
            readProcessMetricsCounters(
                pid: pid,
                expectedBundleIdentifier: bundleIdentifier
            )
        },
        ticksToSeconds: @escaping TicksToSeconds = machTicksToSeconds,
        minimumSampleIntervalSeconds: Double = 0.75,
        maximumRateIntervalSeconds: Double = 5
    ) {
        self.reader = reader
        self.ticksToSeconds = ticksToSeconds
        self.minimumSampleIntervalSeconds = minimumSampleIntervalSeconds
        self.maximumRateIntervalSeconds = maximumRateIntervalSeconds
    }

    func sample(
        bundleId: String,
        pid: Int32,
        sampledAtTicks: UInt64? = nil,
        sampledAtMs: Int64 = Int64(Date().timeIntervalSince1970 * 1_000)
    ) -> ProcessMetricsPayload {
        lock.lock()
        defer { lock.unlock() }

        guard let counters = reader(pid, bundleId)
        else {
            resetLocked()
            return .unavailable(bundleId: bundleId, pid: pid, sampledAtMs: sampledAtMs)
        }

        let nowTicks = sampledAtTicks ?? mach_absolute_time()
        let current = TimedProcessMetricsCounters(
            sampledAtTicks: nowTicks,
            counters: counters
        )
        if let latest,
           latest.payload.bundleId == bundleId,
           latest.payload.pid == pid,
           latest.payload.processStartId == String(counters.processStartAbsoluteTime),
           nowTicks >= latest.sampledAtTicks,
           ticksToSeconds(nowTicks - latest.sampledAtTicks) < minimumSampleIntervalSeconds {
            return latest.payload
        }

        let rateBaseline = previous.flatMap { previous -> TimedProcessMetricsCounters? in
            guard nowTicks > previous.sampledAtTicks,
                  ticksToSeconds(nowTicks - previous.sampledAtTicks) <= maximumRateIntervalSeconds
            else { return nil }
            return previous
        }
        let rates = deriveProcessMetricsRates(
            previous: rateBaseline,
            current: current,
            ticksToSeconds: ticksToSeconds
        )
        previous = current

        let payload = ProcessMetricsPayload(
            state: .live,
            bundleId: bundleId,
            pid: pid,
            processStartId: String(counters.processStartAbsoluteTime),
            alive: true,
            sampledAtMs: sampledAtMs,
            cpuPercent: rates.cpuPercent,
            cpuUserPercent: rates.cpuUserPercent,
            cpuSystemPercent: rates.cpuSystemPercent,
            memoryFootprintBytes: counters.memoryFootprintBytes,
            residentBytes: counters.residentBytes,
            peakMemoryFootprintBytes: counters.peakMemoryFootprintBytes,
            diskReadBytesPerSecond: rates.diskReadBytesPerSecond,
            diskWriteBytesPerSecond: rates.diskWriteBytesPerSecond,
            wakeupsPerSecond: rates.wakeupsPerSecond,
            pageInsPerSecond: rates.pageInsPerSecond,
            threadCount: counters.threadCount,
            runningThreadCount: counters.runningThreadCount
        )
        latest = (sampledAtTicks: nowTicks, payload: payload)
        return payload
    }

    func unavailable(
        state: ProcessMetricsState = .unavailable,
        sampledAtMs: Int64 = Int64(Date().timeIntervalSince1970 * 1_000)
    ) -> ProcessMetricsPayload {
        reset()
        return .unavailable(state: state, sampledAtMs: sampledAtMs)
    }

    private func reset() {
        lock.lock()
        defer { lock.unlock() }
        resetLocked()
    }

    private func resetLocked() {
        previous = nil
        latest = nil
    }
}
