import Darwin
import Foundation

@main
private enum ProcessMetricsSelftest {
    static func main() {
        var failures = 0

        func check(_ condition: @autoclosure () -> Bool, _ message: String) {
            if condition() {
                print("  ok  \(message)")
            } else {
                print("  FAIL \(message)")
                failures += 1
            }
        }

        func counters(
            pid: Int32 = 42,
            start: UInt64 = 99,
            user: UInt64,
            system: UInt64,
            read: UInt64,
            written: UInt64,
            idleWakeups: UInt64,
            interruptWakeups: UInt64,
            pageIns: UInt64
        ) -> ProcessMetricsCounters {
            ProcessMetricsCounters(
                pid: pid,
                processStartAbsoluteTime: start,
                userTimeTicks: user,
                systemTimeTicks: system,
                memoryFootprintBytes: 64 * 1024 * 1024,
                residentBytes: 48 * 1024 * 1024,
                peakMemoryFootprintBytes: 80 * 1024 * 1024,
                diskReadBytes: read,
                diskWriteBytes: written,
                idleWakeups: idleWakeups,
                interruptWakeups: interruptWakeups,
                pageIns: pageIns,
                threadCount: 12,
                runningThreadCount: 2
            )
        }

        let bundleOnlyForeground = resolveForegroundProcess(
            app: ["bundleId": "com.example.metrics"],
            resolvePid: { bundleId in
                bundleId == "com.example.metrics" ? 42 : nil
            }
        )
        check(
            bundleOnlyForeground?.bundleId == "com.example.metrics" &&
                bundleOnlyForeground?.pid == 42,
            "a bundle-only AX result uses the server-owned PID resolver"
        )

        var fallbackCalled = false
        let pidForeground = resolveForegroundProcess(
            app: ["bundleId": "com.example.metrics", "pid": 43],
            resolvePid: { _ in
                fallbackCalled = true
                return 99
            }
        )
        check(
            pidForeground?.pid == 43 && !fallbackCalled,
            "an AX-provided PID bypasses fallback resolution"
        )
        check(
            resolveForegroundProcess(
                app: ["bundleId": "com.example.metrics"],
                resolvePid: { _ in nil }
            ) == nil,
            "an unresolved bundle-only result fails closed"
        )

        let matchingResolver = SimulatorAppPidResolver(
            deviceUDID: "device-a",
            listProcessIdentifiers: { [11, 22, 33] },
            readIdentity: { pid in
                switch pid {
                case 11:
                    return SimulatorAppProcessIdentity(
                        pid: pid,
                        bundleId: "com.example.metrics",
                        deviceUDID: "device-a",
                        processStartAbsoluteTime: 100
                    )
                case 22:
                    return SimulatorAppProcessIdentity(
                        pid: pid,
                        bundleId: "com.example.metrics",
                        deviceUDID: "device-b",
                        processStartAbsoluteTime: 300
                    )
                case 33:
                    return SimulatorAppProcessIdentity(
                        pid: pid,
                        bundleId: "com.example.metrics",
                        deviceUDID: "device-a",
                        processStartAbsoluteTime: 200
                    )
                default:
                    return nil
                }
            }
        )
        check(
            matchingResolver.resolve(bundleId: "com.example.metrics") == 33,
            "the fallback selects the newest bundle match on the requested simulator"
        )

        var relaunchedIdentities: [Int32: SimulatorAppProcessIdentity] = [
            44: SimulatorAppProcessIdentity(
                pid: 44,
                bundleId: "com.example.metrics",
                deviceUDID: "device-a",
                processStartAbsoluteTime: 100
            ),
        ]
        var relaunchedPids: [Int32] = [44]
        let relaunchResolver = SimulatorAppPidResolver(
            deviceUDID: "device-a",
            listProcessIdentifiers: { relaunchedPids },
            readIdentity: { relaunchedIdentities[$0] }
        )
        check(
            relaunchResolver.resolve(bundleId: "com.example.metrics") == 44,
            "the fallback caches a live matching process"
        )
        relaunchedIdentities[44] = nil
        relaunchedIdentities[55] = SimulatorAppProcessIdentity(
            pid: 55,
            bundleId: "com.example.metrics",
            deviceUDID: "device-a",
            processStartAbsoluteTime: 200
        )
        relaunchedPids = [55]
        check(
            relaunchResolver.resolve(bundleId: "com.example.metrics") == 55,
            "a same-bundle relaunch replaces the stale cached PID"
        )
        check(
            readProcessEnvironmentValue(pid: getpid(), key: "PATH") ==
                ProcessInfo.processInfo.environment["PATH"],
            "the native process adapter reads an exact environment value"
        )
        check(
            listAllProcessIdentifiers().contains(getpid()),
            "the native process list includes the current process"
        )

        let previous = TimedProcessMetricsCounters(
            sampledAtTicks: 1_000,
            counters: counters(
                user: 1_000,
                system: 500,
                read: 1_000,
                written: 2_000,
                idleWakeups: 10,
                interruptWakeups: 20,
                pageIns: 3
            )
        )
        let current = TimedProcessMetricsCounters(
            sampledAtTicks: 3_000,
            counters: counters(
                user: 2_000,
                system: 1_000,
                read: 5_000,
                written: 8_000,
                idleWakeups: 14,
                interruptWakeups: 24,
                pageIns: 7
            )
        )
        let ticksToSeconds: (UInt64) -> Double = { Double($0) / 1_000 }

        let rates = deriveProcessMetricsRates(
            previous: previous,
            current: current,
            ticksToSeconds: ticksToSeconds
        )
        check(rates.cpuUserPercent == 50, "user CPU uses Mach-tick deltas")
        check(rates.cpuSystemPercent == 25, "system CPU uses Mach-tick deltas")
        check(rates.cpuPercent == 75, "total CPU is user plus system")
        check(rates.diskReadBytesPerSecond == 2_000, "disk reads are bytes per second")
        check(rates.diskWriteBytesPerSecond == 3_000, "disk writes are bytes per second")
        check(rates.wakeupsPerSecond == 4, "idle and interrupt wakeups are combined")
        check(rates.pageInsPerSecond == 2, "page-ins are reported per second")

        var requestDrivenReads = 0
        let requestDrivenSampler = ProcessMetricsSampler(
            reader: { _, _ in
                requestDrivenReads += 1
                return requestDrivenReads == 1 ? previous.counters : current.counters
            },
            ticksToSeconds: ticksToSeconds
        )
        let firstRequest = requestDrivenSampler.sample(
            bundleId: "com.example.metrics",
            pid: 42,
            sampledAtTicks: 1_000,
            sampledAtMs: 1
        )
        let coalescedRequest = requestDrivenSampler.sample(
            bundleId: "com.example.metrics",
            pid: 42,
            sampledAtTicks: 1_100,
            sampledAtMs: 2
        )
        check(requestDrivenReads == 2, "a shared snapshot still revalidates process identity")
        check(coalescedRequest.sampledAtMs == firstRequest.sampledAtMs, "a shared snapshot keeps its timestamp")

        let freshRequest = requestDrivenSampler.sample(
            bundleId: "com.example.metrics",
            pid: 42,
            sampledAtTicks: 3_000,
            sampledAtMs: 3
        )
        check(freshRequest.cpuPercent == 75, "a fresh request derives CPU from bounded samples")
        check(freshRequest.processStartId == "99", "the payload exposes process-start identity")

        let longGapRequest = requestDrivenSampler.sample(
            bundleId: "com.example.metrics",
            pid: 42,
            sampledAtTicks: 9_000,
            sampledAtMs: 4
        )
        check(longGapRequest.cpuPercent == nil, "a long polling gap re-primes CPU")

        let first = deriveProcessMetricsRates(
            previous: nil,
            current: current,
            ticksToSeconds: ticksToSeconds
        )
        check(first.cpuPercent == nil, "first sample primes CPU")
        check(first.diskReadBytesPerSecond == nil, "first sample primes disk rates")
        check(first.wakeupsPerSecond == nil, "first sample primes wakeup rates")

        let reused = TimedProcessMetricsCounters(
            sampledAtTicks: 4_000,
            counters: counters(
                start: 100,
                user: 10_000,
                system: 10_000,
                read: 50_000,
                written: 60_000,
                idleWakeups: 100,
                interruptWakeups: 100,
                pageIns: 100
            )
        )
        let reusedRates = deriveProcessMetricsRates(
            previous: current,
            current: reused,
            ticksToSeconds: ticksToSeconds
        )
        check(reusedRates.cpuPercent == nil, "a reused PID re-primes CPU")
        check(reusedRates.diskReadBytesPerSecond == nil, "a reused PID re-primes counters")

        let backwards = TimedProcessMetricsCounters(
            sampledAtTicks: 5_000,
            counters: counters(
                user: 1,
                system: 1,
                read: 1,
                written: 1,
                idleWakeups: 1,
                interruptWakeups: 1,
                pageIns: 1
            )
        )
        let backwardsRates = deriveProcessMetricsRates(
            previous: current,
            current: backwards,
            ticksToSeconds: ticksToSeconds
        )
        check(backwardsRates.cpuPercent == nil, "backwards CPU counters are unavailable")
        check(backwardsRates.diskReadBytesPerSecond == nil, "backwards disk counters are unavailable")

        guard let own = readProcessMetricsCounters(pid: getpid()) else {
            print("  FAIL native self-sample is available")
            exit(1)
        }
        check(own.memoryFootprintBytes > 0, "native physical footprint is nonzero")
        check(own.residentBytes > 0, "native resident memory is nonzero")
        check(own.peakMemoryFootprintBytes >= own.memoryFootprintBytes, "peak footprint covers current footprint")
        check(own.threadCount > 0, "native thread count is nonzero")
        check(own.runningThreadCount > 0, "the sampling process has a running thread")

        let selfBundle = "process-metrics-selftest"
        var sampledExpectedBundle: String?
        let nativeSampler = ProcessMetricsSampler(
            reader: { pid, expectedBundle in
                sampledExpectedBundle = expectedBundle
                return readProcessMetricsCounters(pid: pid)
            },
            minimumSampleIntervalSeconds: 0
        )
        _ = nativeSampler.sample(bundleId: selfBundle, pid: getpid())
        let deadline = mach_absolute_time() + UInt64(0.15 / machTicksToSeconds(1))
        while mach_absolute_time() < deadline {}
        let busy = nativeSampler.sample(bundleId: selfBundle, pid: getpid())
        check(
            (busy.cpuPercent ?? 0) > 20 && (busy.cpuPercent ?? 0) < 180,
            "real busy-loop CPU uses the correct Mach timebase"
        )
        check(
            sampledExpectedBundle == selfBundle,
            "the native reader receives the expected bundle identity"
        )

        let denied = ProcessMetricsSampler(
            reader: { _, _ in nil }
        ).sample(bundleId: selfBundle, pid: getpid())
        check(!denied.alive, "bundle mismatch rejects a stale or unrelated PID")

        let environment = ProcessInfo.processInfo.environment
        if let deviceUDID = environment["PROCESS_METRICS_TEST_UDID"],
           let bundleId = environment["PROCESS_METRICS_TEST_BUNDLE_ID"] {
            let resolver = SimulatorAppPidResolver(deviceUDID: deviceUDID)
            let process = resolveForegroundProcess(
                app: ["bundleId": bundleId],
                resolvePid: { resolver.resolve(bundleId: $0) }
            )
            check(process != nil, "bundle-only AX data resolves a real simulator app")
            if let process {
                check(
                    readProcessEnvironmentValue(
                        pid: process.pid,
                        key: "SIMULATOR_UDID"
                    )?.caseInsensitiveCompare(deviceUDID) == .orderedSame,
                    "the resolved app belongs to the requested simulator"
                )
                let payload = ProcessMetricsSampler().sample(
                    bundleId: bundleId,
                    pid: process.pid
                )
                check(
                    payload.alive && payload.pid == process.pid,
                    "the resolved PID produces live native metrics"
                )
            }
        }

        if failures == 0 {
            print("ALL PROCESS METRICS TESTS PASSED")
        } else {
            print("\(failures) FAILURE(S)")
            exit(1)
        }
    }
}
