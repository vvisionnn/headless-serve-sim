// Deterministic self-test for the pure AdaptiveController (AIMD bitrate/QP policy).
//
// The controller has no clock or I/O, so its behaviour is fully testable in
// isolation — which matters because a slow real link is the one condition we
// can't reproduce on a loopback e2e (loopback has no bandwidth limit, so the
// integration path only ever exercises the "clear" branch).
//
// Run:  swiftc Sources/SimStreamHelper/AdaptiveController.swift \
//              scripts/adaptive-controller-selftest.swift -o /tmp/adaptive-selftest \
//        && /tmp/adaptive-selftest

import Foundation

@main
struct AdaptiveControllerSelfTest {
static func main() {
var failures = 0
func check(_ cond: Bool, _ msg: String) {
    print(cond ? "  ok  \(msg)" : "  FAIL \(msg)")
    if !cond { failures += 1 }
}

let HW = 512 * 1024 // per-client overflow threshold; congestion line = HW/2

// Resolution-scaled perf bounds (1206x2622 ≈ 3.16 MP, the iPhone 16 Pro stream).
let b = AdaptiveController.bounds(for: .perf, width: 1206, height: 2622)
print("perf bounds: \(b)")
check(b.minBitrate == 150_000, "perf floor = 150 kbps")
check(b.maxBitrate > 7_000_000 && b.maxBitrate <= 12_000_000, "perf ceiling scaled (~7.9 Mbps) & clamped")
check(b.sharpQP == 30 && b.softQP == 48, "perf QP band 30..48")

var c = AdaptiveController(bounds: b)
check(c.bitrate == b.maxBitrate, "starts at the ceiling")

// One congested tick → multiplicative decrease + congested flag.
let o1 = c.tick(congestionBytes: HW, highWaterBytes: HW)
check(o1.congested, "congested flag set at/above threshold")
check(o1.bitrate == max(b.minBitrate, Int(Double(b.maxBitrate) * 0.6)), "x0.6 multiplicative decrease")
check(o1.maxQP > b.sharpQP, "QP softens off the ceiling")

// Sustained congestion → bottoms at the floor, QP at its softest.
for _ in 0..<40 { _ = c.tick(congestionBytes: HW, highWaterBytes: HW) }
let oFloor = c.tick(congestionBytes: HW, highWaterBytes: HW)
check(oFloor.bitrate == b.minBitrate, "bottoms out at the floor under sustained congestion")
check(oFloor.maxQP == b.softQP, "QP at its softest at the floor")

// Clear link (zero backlog) → additive increase, QP sharpens back.
let oUp = c.tick(congestionBytes: 0, highWaterBytes: HW)
check(!oUp.congested, "not congested when backlog is 0")
check(oUp.bitrate > b.minBitrate, "additive increase when clear")

// Probe all the way back up → recovers to ceiling, QP at its sharpest.
for _ in 0..<200 { _ = c.tick(congestionBytes: 0, highWaterBytes: HW) }
let oCeil = c.tick(congestionBytes: 0, highWaterBytes: HW)
check(oCeil.bitrate == b.maxBitrate, "recovers to the ceiling")
check(oCeil.maxQP == b.sharpQP, "QP sharpest at the ceiling")

// Hysteresis: nonzero backlog below the congestion line holds steady.
var c2 = AdaptiveController(bounds: b)
let hold = c2.tick(congestionBytes: HW / 2 - 1, highWaterBytes: HW)
check(!hold.congested && hold.bitrate == b.maxBitrate, "backlog below the line holds steady (no thrash)")

// Quality mode spends more bits and aims sharper than perf.
let q = AdaptiveController.bounds(for: .quality, width: 1206, height: 2622)
check(q.maxBitrate > b.maxBitrate, "quality ceiling > perf ceiling")
check(q.sharpQP < b.sharpQP, "quality QP sharper than perf")

// setBounds re-clamps the live target into a smaller range.
var c3 = AdaptiveController(bounds: b) // target = perf ceiling
let small = AdaptiveController.bounds(for: .perf, width: 100, height: 100)
c3.setBounds(small)
check(c3.bitrate <= small.maxBitrate, "setBounds re-clamps the live target down")

if failures == 0 {
    print("ALL ADAPTIVE CONTROLLER TESTS PASSED")
} else {
    print("\(failures) FAILURE(S)")
    exit(1)
}
}
}
