import Foundation
import CoreVideo
import CoreMedia
import AppKit
import Darwin

// Force unbuffered output
setbuf(stdout, nil)
setbuf(stderr, nil)

// Initialize AppKit (needed for HID touch subprocess)
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let args = CommandLine.arguments

guard args.count >= 2 else {
    fputs("Usage: headless-serve-sim-bin <device-udid> [--port 3100]\n", stderr)
    exit(1)
}

let deviceUDID = args[1]
var port: UInt16 = 3100

// Parse optional --port flag
if let portIdx = args.firstIndex(of: "--port"), portIdx + 1 < args.count,
   let p = UInt16(args[portIdx + 1]) {
    port = p
}

// Streaming quality mode: perf (default) favors smoothness on weak links;
// quality spends more bits. Set via env or --mode; also switchable live over /ws.
var streamMode: StreamMode = .perf
if let envMode = ProcessInfo.processInfo.environment["SERVE_SIM_STREAM_MODE"],
   let m = StreamMode(rawValue: envMode) {
    streamMode = m
}
if let modeIdx = args.firstIndex(of: "--mode"), modeIdx + 1 < args.count,
   let m = StreamMode(rawValue: args[modeIdx + 1]) {
    streamMode = m
}

print("[main] Starting headless-serve-sim-bin")
print("[main] Device UDID: \(deviceUDID)")
print("[main] Port: \(port)")
print("[main] Stream mode: \(streamMode.rawValue)")

let avccHighWaterBytes = 256 * 1024
let httpServer = HTTPServer(deviceUDID: deviceUDID, port: port)
let frameCapture = FrameCapture()
let frameSnapshotter = FrameSnapshotter()
let frameAdmission = FrameAdmissionController()
let keyframeRequest = KeyframeRequest()
let jpegSeedRequest = KeyframeRequest()
let videoEncoder = VideoEncoder(quality: 0.7)
let h264Encoder = H264Encoder(fps: 60, maxQP: streamMode == .quality ? 40 : 48)
let hidInjector = HIDInjector()
let encodeQueue = DispatchQueue(label: "encode", qos: .userInteractive)
let h264Queue = DispatchQueue(label: "encode.h264", qos: .userInteractive)

httpServer.clientManager.avccHighWaterBytes = avccHighWaterBytes
let adaptiveDriver = AdaptiveDriver(
    encoder: h264Encoder,
    clientManager: httpServer.clientManager,
    mode: streamMode,
    highWaterBytes: avccHighWaterBytes
)

var screenWidth = 0
var screenHeight = 0
var encoderReady = false
var lastJpegEncodeMs: UInt64 = 0
var lastAvccHeartbeatMs: UInt64 = 0
// H.264 output → AVCC envelope → broadcast to /stream.avcc clients.
h264Encoder.onEncoded = { encoded in
    adaptiveDriver.noteEncoded()
    if let description = encoded.description {
        httpServer.clientManager.broadcastAvcc(AVCCEnvelope.description(avcc: description), kind: .description)
    }
    switch encoded.kind {
    case .keyframe:
        httpServer.clientManager.broadcastAvcc(encoded.envelope, kind: .keyframe)
    case .delta:
        if encoded.disposable {
            httpServer.clientManager.broadcastAvcc(encoded.envelope, kind: .disposableDelta)
        } else {
            httpServer.clientManager.broadcastAvcc(encoded.envelope, kind: .delta)
        }
    }
}
httpServer.clientManager.onAvccClientConnect = {
    keyframeRequest.request()
    jpegSeedRequest.request()
}
// A viewer's send queue overflowed (or it explicitly asked over /ws) — force a
// fresh IDR so it can resync after we dropped deltas.
httpServer.clientManager.onNeedKeyframe = {
    keyframeRequest.request()
}
// Live perf/quality switch from the panel (/ws 0x0C).
httpServer.clientManager.onSetMode = { modeStr in
    guard let m = StreamMode(rawValue: modeStr) else { return }
    adaptiveDriver.setMode(m, width: screenWidth, height: screenHeight)
}
httpServer.onStreamMetrics = {
    let stats = frameAdmission.stats()
    let snapshotStats = frameSnapshotter.stats()
    let skipped = stats.framesOffered &- stats.snapshotsRequired
    let avoidance = stats.framesOffered == 0
        ? 0
        : Double(skipped) * 100.0 / Double(stats.framesOffered)
    var result: [String: Any] = [
        "framesOffered": stats.framesOffered,
        "framesDemandingEncode": stats.framesDemandingEncode,
        "snapshotsRequired": stats.snapshotsRequired,
        "snapshotsSkippedBeforeCopy": skipped,
        "busyFramesAvoidedCopy": stats.busyFramesAvoidedCopy,
        "copyAvoidancePercent": avoidance,
        "jpegAdmitted": stats.jpegAdmitted,
        "jpegBusyDrops": stats.jpegBusyDrops,
        "h264Admitted": stats.h264Admitted,
        "h264BusyDrops": stats.h264BusyDrops,
        "idleAvccHeartbeats": stats.idleAvccHeartbeats,
        "snapshotsCompleted": snapshotStats.snapshots,
        "snapshotNanoseconds": snapshotStats.nanoseconds,
        "failedSnapshots": snapshotStats.failedSnapshots,
        "retriedSnapshots": snapshotStats.retriedSnapshots,
    ]
    if let process = readProcessMetricsCounters(pid: getpid()) {
        result["helperCpuTicks"] = process.userTimeTicks + process.systemTimeTicks
        result["helperSampleTicks"] = mach_absolute_time()
        result["helperResidentBytes"] = process.residentBytes
    }
    for (key, value) in httpServer.clientManager.avccTransportMetrics() {
        result[key] = value
    }
    return result
}

// Setup HID injector
do {
    try hidInjector.setup(deviceUDID: deviceUDID)
} catch {
    print("[main] Warning: HID setup failed: \(error.localizedDescription)")
}

// Wire client manager → HID injector
httpServer.clientManager.onTouch = { touch in
    hidInjector.sendTouch(type: touch.type, x: touch.x, y: touch.y,
                          screenWidth: screenWidth, screenHeight: screenHeight,
                          edge: touch.edge ?? 0)
}
httpServer.clientManager.onButton = { button in
    hidInjector.sendButton(button: button, deviceUDID: deviceUDID)
}
httpServer.clientManager.onMultiTouch = { multiTouch in
    hidInjector.sendMultiTouch(type: multiTouch.type,
                               x1: multiTouch.x1, y1: multiTouch.y1,
                               x2: multiTouch.x2, y2: multiTouch.y2,
                               screenWidth: screenWidth, screenHeight: screenHeight)
}
httpServer.clientManager.onKey = { key in
    hidInjector.sendKey(type: key.type, usage: key.usage)
}
httpServer.clientManager.onOrientation = { orientation in
    hidInjector.sendOrientation(orientation: orientation)
}
httpServer.clientManager.onCADebug = { payload in
    _ = hidInjector.setCADebugOption(name: payload.option, enabled: payload.enabled)
}
httpServer.clientManager.onMemoryWarning = {
    hidInjector.simulateMemoryWarning()
}
httpServer.clientManager.onDigitalCrown = { payload in
    hidInjector.sendDigitalCrown(delta: payload.delta)
}

// Start HTTP + WebSocket server
do {
    try httpServer.start()
} catch {
    print("[main] Failed to start server: \(error.localizedDescription)")
    exit(1)
}

// Begin adaptive bitrate/QP control (no-op until a viewer connects).
adaptiveDriver.start()

// Start frame capture — encoder is initialized lazily on first frame.
// The framebuffer surface may not be available immediately after boot,
// so retry a few times with backoff before giving up.
let frameHandler: (CVPixelBuffer, CMTime, Bool) -> Void = { pixelBuffer, timestamp, contentChanged in
    let w = CVPixelBufferGetWidth(pixelBuffer)
    let h = CVPixelBufferGetHeight(pixelBuffer)

    // Initialize encoder on first frame with actual dimensions
    if !encoderReady || w != screenWidth || h != screenHeight {
        screenWidth = w
        screenHeight = h
        print("[main] Frame dimensions: \(w)x\(h), (re)initializing encoder")

        videoEncoder.stop()
        videoEncoder.setup(
            width: Int32(w),
            height: Int32(h),
            fps: 60,
            onEncodedFrame: { jpegData in
                httpServer.clientManager.broadcastFrame(jpegData: jpegData)
            }
        )
        encoderReady = true

        // Update client manager config
        httpServer.clientManager.setScreenSize(width: w, height: h)
        adaptiveDriver.updateResolution(width: w, height: h)
    }

    let nowMs = DispatchTime.now().uptimeNanoseconds / 1_000_000
    let hasMJPEGClients = httpServer.clientManager.hasMJPEGClients()
    let hasAvccClients = httpServer.clientManager.hasAvccClients()
    let keyframePending = keyframeRequest.isPending()
    let jpegSeedPending = jpegSeedRequest.isPending()
    let wantsJpeg = hasMJPEGClients
        || jpegSeedPending
        || lastJpegEncodeMs == 0
    let jpegDue = hasMJPEGClients
        || jpegSeedPending
        || lastJpegEncodeMs == 0
    let wantsJpegNow = encoderReady && wantsJpeg && jpegDue

    // Reserve asynchronous encoder capacity before copying 12+ MB of BGRA.
    // When both encoders are busy the frame is intentionally dropped here,
    // keeping latency bounded without spending memory bandwidth on pixels that
    // cannot be consumed.
    let claims = frameAdmission.claim(
        wantsJpeg: wantsJpegNow,
        wantsH264: hasAvccClients && (contentChanged || keyframePending)
    )

    // Close the recycled-IOSurface lifetime boundary synchronously, before any
    // encoder queueing or first-use VideoToolbox setup. Both encoders share this
    // one owned copy; neither can observe SimulatorKit painting the next frame.
    guard claims.requiresSnapshot else { return }
    guard let snapshot = frameSnapshotter.snapshot(pixelBuffer) else {
        if claims.jpeg { frameAdmission.completeJpeg() }
        if claims.h264 { frameAdmission.completeH264() }
        return
    }

    if claims.jpeg {
        // Backpressure: skip frame if encoder is still working on the previous one.
        // AVCC viewers only need an occasional JPEG seed for instant first paint;
        // encoding every frame as both JPEG and H.264 competes with the low-latency
        // path for CPU and pixel-buffer locks.
        lastJpegEncodeMs = nowMs
        _ = jpegSeedRequest.consume()
        encodeQueue.async {
            videoEncoder.encode(pixelBuffer: snapshot)
            frameAdmission.completeJpeg()
        }
    }

    // H.264 path runs only while at least one AVCC viewer is connected, so an
    // all-MJPEG session pays no VideoToolbox cost. Its own backpressure flag
    // lets it skip independently of the JPEG encoder.
    if claims.h264 {
        h264Queue.async {
            let force = keyframeRequest.consume()
            h264Encoder.encode(snapshot, forceKeyframe: force) {
                frameAdmission.completeH264()
            }
        }
    }
}

do {
    try frameCapture.start(
        deviceUDID: deviceUDID,
        onIdle: {
            let nowMs = DispatchTime.now().uptimeNanoseconds / 1_000_000
            if httpServer.clientManager.hasAvccClients(),
               !keyframeRequest.isPending(),
               nowMs &- lastAvccHeartbeatMs >= 1_000 {
                lastAvccHeartbeatMs = nowMs
                frameAdmission.noteIdleAvccHeartbeat()
                httpServer.clientManager.broadcastAvcc(AVCCEnvelope.heartbeat(), kind: .heartbeat)
            }
        },
        requiresIdleFrame: {
            httpServer.clientManager.hasMJPEGClients() || keyframeRequest.isPending()
        },
        onFrame: frameHandler
    )
    print("[main] Capture started, waiting for frames...")
    print("\nOpen your browser at: http://localhost:\(port)")
    print("Press Ctrl+C to stop.\n")
} catch {
    print("[main] Failed to start capture: \(error.localizedDescription)")
    exit(1)
}

// Shutdown handlers
signal(SIGINT) { _ in
    print("\n[main] Shutting down...")
    frameCapture.stop()
    videoEncoder.stop()
    h264Encoder.stop()
    adaptiveDriver.stop()
    httpServer.stop()
    exit(0)
}

signal(SIGTERM) { _ in
    frameCapture.stop()
    videoEncoder.stop()
    h264Encoder.stop()
    adaptiveDriver.stop()
    httpServer.stop()
    exit(0)
}

RunLoop.main.run()
