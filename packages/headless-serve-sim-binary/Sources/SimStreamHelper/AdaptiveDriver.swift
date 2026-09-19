import Foundation

/// Glue around `AdaptiveController`: a 300ms timer that samples per-client send
/// backlog, applies the resulting bitrate/QP to the encoder, and pushes a
/// stream-stats snapshot to the Connection Stats panel. Only acts while a viewer
/// is connected.
final class AdaptiveDriver {
    private let encoder: H264Encoder
    private let clientManager: ClientManager
    private let highWaterBytes: Int
    private let tickSeconds = 0.3
    private let lock = NSLock()
    private var controller: AdaptiveController
    private var mode: StreamMode
    private var timer: DispatchSourceTimer?
    private var encodedFrames = 0
    private var lastEncodedFrames = 0
    private var lastCaptureFrames: UInt64?
    private var lastSampleTime = DispatchTime.now().uptimeNanoseconds

    /// Set before start. Counts actual capture offers and snapshots/pending
    /// frames discarded before encoding, rather than a configured FPS target.
    var captureStats: (() -> (offered: UInt64, dropped: UInt64))?

    init(encoder: H264Encoder, clientManager: ClientManager, mode: StreamMode, highWaterBytes: Int) {
        self.encoder = encoder
        self.clientManager = clientManager
        self.mode = mode
        self.highWaterBytes = highWaterBytes
        // Provisional bounds until the first frame's real resolution arrives.
        self.controller = AdaptiveController(bounds: AdaptiveController.bounds(for: mode, width: 1170, height: 2532))
    }

    /// Re-scale bounds once the true stream resolution is known (or changes).
    func updateResolution(width: Int, height: Int) {
        lock.lock(); defer { lock.unlock() }
        controller.setBounds(AdaptiveController.bounds(for: mode, width: width, height: height))
    }

    /// Live mode switch from the client (/ws 0x0C).
    func setMode(_ newMode: StreamMode, width: Int, height: Int) {
        lock.lock(); defer { lock.unlock() }
        mode = newMode
        controller.setBounds(AdaptiveController.bounds(for: newMode, width: width, height: height))
    }

    /// Bump the encoded-frame counter (called on the encoder's output queue) so
    /// the driver can report server-side encode fps.
    func noteEncoded() {
        lock.lock(); encodedFrames += 1; lock.unlock()
    }

    func start() {
        lastSampleTime = DispatchTime.now().uptimeNanoseconds
        lastCaptureFrames = captureStats?().offered
        let t = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "adaptive", qos: .userInitiated))
        t.schedule(deadline: .now() + .milliseconds(500), repeating: .milliseconds(Int(tickSeconds * 1000)))
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume()
        timer = t
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    private func tick() {
        let now = DispatchTime.now().uptimeNanoseconds
        let elapsed = Double(now &- lastSampleTime) / 1_000_000_000
        lastSampleTime = now
        let capture = captureStats?()
        let sourceFps: Double? = capture.flatMap { current in
            guard let previous = lastCaptureFrames, elapsed > 0 else { return nil }
            return Double(current.offered &- previous) / elapsed
        }
        lastCaptureFrames = capture?.offered
        lock.lock()
        let frames = encodedFrames
        let delta = frames - lastEncodedFrames
        lastEncodedFrames = frames
        lock.unlock()
        // Keep the rate baselines current even while disconnected, so the next
        // viewer doesn't see all intervening frames reported as one short burst.
        guard clientManager.hasAvccClients() else { return }
        let congestion = clientManager.sampleAvccCongestion()
        let dropped = clientManager.sampleAvccDropped()
        lock.lock()
        let out = controller.tick(congestionBytes: congestion, highWaterBytes: highWaterBytes)
        let modeStr = mode.rawValue
        lock.unlock()

        encoder.setBitrate(out.bitrate)
        encoder.setMaxQP(out.maxQP)

        let serverFps = elapsed > 0 ? Double(delta) / elapsed : 0
        let encoderCounters = encoder.counters()
        let transport = clientManager.avccTransportMetrics()
        let queueMs = out.bitrate > 0
            ? Int((Double(congestion) * 8_000.0 / Double(out.bitrate)).rounded())
            : 0
        var stats: [String: Any] = [
            "mode": modeStr,
            "targetBitrate": out.bitrate,
            "maxQP": out.maxQP,
            "congested": out.congested,
            "serverFps": serverFps,
            "queueBytes": congestion,
            "queueMs": queueMs,
            "droppedFrames": dropped,
            "encoderDroppedFrames": encoderCounters.submitFailed + encoderCounters.droppedByEncoder,
            "transportDroppedChunks": transport["avccDroppedChunks"] ?? 0,
        ]
        if let sourceFps { stats["sourceFps"] = sourceFps }
        if let capture { stats["captureDroppedFrames"] = capture.dropped }
        clientManager.broadcastStreamStats(stats)
    }
}
