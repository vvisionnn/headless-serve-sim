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
        guard clientManager.hasAvccClients() else { return }
        let congestion = clientManager.sampleAvccCongestion()
        let dropped = clientManager.sampleAvccDropped()
        lock.lock()
        let out = controller.tick(congestionBytes: congestion, highWaterBytes: highWaterBytes)
        let modeStr = mode.rawValue
        let frames = encodedFrames
        let delta = frames - lastEncodedFrames
        lastEncodedFrames = frames
        lock.unlock()

        encoder.setBitrate(out.bitrate)
        encoder.setMaxQP(out.maxQP)

        let serverFps = Int((Double(delta) / tickSeconds).rounded())
        let queueMs = out.bitrate > 0
            ? Int((Double(congestion) * 8_000.0 / Double(out.bitrate)).rounded())
            : 0
        clientManager.broadcastStreamStats([
            "mode": modeStr,
            "targetBitrate": out.bitrate,
            "maxQP": out.maxQP,
            "congested": out.congested,
            "serverFps": serverFps,
            "queueBytes": congestion,
            "queueMs": queueMs,
            "droppedFrames": dropped,
        ])
    }
}
