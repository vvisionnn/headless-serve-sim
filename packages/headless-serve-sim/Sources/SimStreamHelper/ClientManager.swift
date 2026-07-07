import Foundation
import Swifter

/// Manages WebSocket clients for input and MJPEG stream clients for video.
final class ClientManager {
    private var wsSessions: [ObjectIdentifier: WebSocketSession] = [:]
    private let queue = DispatchQueue(label: "client-manager")
    private let configLock = NSLock()

    private var screenWidth = 0
    private var screenHeight = 0
    private var screenOrientation = "portrait"

    /// Latest JPEG frame data, replaced on each new frame
    private var latestFrame: Data?
    private var mjpegClients: [ObjectIdentifier: MJPEGClient] = [:]
    private var mjpegClientCount = 0
    private var nextClientId = 0

    /// AVCC (H.264) stream clients + the cached avcC description envelope so
    /// late joiners can configure their decoder without waiting for the next
    /// natural IDR.
    private var avccClients: [ObjectIdentifier: AVCCClient] = [:]
    private var cachedAvccDescription: Data?
    /// Fired when an AVCC client connects so the owner can force a keyframe —
    /// the new decoder needs an IDR before any delta will decode.
    var onAvccClientConnect: (() -> Void)?
    /// Fired when a viewer's send queue overflows and needs a fresh IDR to
    /// resync, or when the client explicitly requests a keyframe over /ws.
    var onNeedKeyframe: (() -> Void)?
    /// Fired when the client switches streaming mode (perf/quality) over /ws.
    var onSetMode: ((String) -> Void)?
    /// Per-client send-queue overflow threshold (congestion trigger).
    var avccHighWaterBytes = 512 * 1024

    var onTouch: ((TouchEventPayload) -> Void)?
    var onButton: ((String) -> Void)?
    var onMultiTouch: ((MultiTouchEventPayload) -> Void)?
    var onKey: ((KeyEventPayload) -> Void)?
    var onOrientation: ((UInt32) -> Bool)?
    var onCADebug: ((CADebugEventPayload) -> Void)?
    var onMemoryWarning: (() -> Void)?
    var onDigitalCrown: ((DigitalCrownEventPayload) -> Void)?

    // MARK: - Configuration

    func setScreenSize(width: Int, height: Int) {
        configLock.lock()
        let changed = width != screenWidth || height != screenHeight
        screenWidth = width
        screenHeight = height
        configLock.unlock()
        if changed { broadcastConfig() }
    }

    private func setScreenOrientation(_ orientation: String) {
        configLock.lock()
        let changed = orientation != screenOrientation
        screenOrientation = orientation
        configLock.unlock()
        if changed { broadcastConfig() }
    }

    func screenConfig() -> [String: Any] {
        configLock.lock()
        defer { configLock.unlock() }
        return [
            "width": screenWidth,
            "height": screenHeight,
            "orientation": screenOrientation,
        ]
    }

    /// Tag for a server->client screen-config push. Distinct from the
    /// client->server input tags (0x03–0x0A); the frame layout mirrors input:
    /// `[tag][JSON payload]`.
    private static let wsMsgConfig: UInt8 = 0x82
    /// Tag for a server->client stream-stats push (adaptive bitrate/mode/...).
    private static let wsMsgStreamStats: UInt8 = 0x83

    private func configFrame() -> [UInt8]? {
        guard let json = try? JSONSerialization.data(withJSONObject: screenConfig()) else { return nil }
        return [ClientManager.wsMsgConfig] + [UInt8](json)
    }

    /// Push the current screen config to every connected input WebSocket. This
    /// replaces the browser's old 1s `/config` poll — clients now receive
    /// dimensions/orientation over the socket they already hold open for input.
    func broadcastConfig() {
        broadcastWsJson(ClientManager.wsMsgConfig, screenConfig())
    }

    /// Serialize `obj` to a `[tag][JSON]` frame and push it to every input
    /// WebSocket. Serialization runs on `queue` after an emptiness check, so
    /// nothing is built when no input socket is listening.
    private func broadcastWsJson(_ tag: UInt8, _ obj: [String: Any]) {
        queue.async {
            guard !self.wsSessions.isEmpty,
                  let json = try? JSONSerialization.data(withJSONObject: obj) else { return }
            let frame = [tag] + [UInt8](json)
            for (_, session) in self.wsSessions {
                session.writeBinary(frame)
            }
        }
    }

    // MARK: - MJPEG Client Management

    func addMJPEGClient() -> MJPEGClient {
        let client = MJPEGClient(id: nextClientId)
        nextClientId += 1
        let key = ObjectIdentifier(client)
        configLock.lock(); mjpegClientCount += 1; configLock.unlock()
        queue.async {
            self.mjpegClients[key] = client
            print("[clients] MJPEG client connected (\(self.mjpegClients.count) total)")
        }
        return client
    }

    /// Send the latest cached frame to a client (call after writer is attached).
    func sendLatestFrame(to client: MJPEGClient) {
        queue.async {
            if let frame = self.latestFrame {
                client.send(frame: frame)
            }
        }
    }

    func removeMJPEGClient(_ client: MJPEGClient) {
        let key = ObjectIdentifier(client)
        configLock.lock(); mjpegClientCount = max(0, mjpegClientCount - 1); configLock.unlock()
        queue.async {
            self.mjpegClients.removeValue(forKey: key)
            print("[clients] MJPEG client disconnected (\(self.mjpegClients.count) total)")
        }
    }

    /// True when at least one viewer is consuming the MJPEG stream.
    func hasMJPEGClients() -> Bool {
        configLock.lock()
        defer { configLock.unlock() }
        return mjpegClientCount > 0
    }

    // MARK: - AVCC Client Management

    /// True when at least one viewer is consuming the H.264 stream. The owner
    /// gates VideoToolbox encoding on this so an all-MJPEG session pays no
    /// H.264 cost.
    func hasAvccClients() -> Bool {
        configLock.lock()
        defer { configLock.unlock() }
        return avccClientCount > 0
    }
    private var avccClientCount = 0

    func addAvccClient() -> AVCCClient {
        let client = AVCCClient(id: nextClientId, highWaterBytes: avccHighWaterBytes)
        client.onNeedKeyframe = { [weak self] in self?.onNeedKeyframe?() }
        nextClientId += 1
        let key = ObjectIdentifier(client)
        configLock.lock(); avccClientCount += 1; configLock.unlock()
        queue.async {
            self.avccClients[key] = client
            print("[clients] AVCC client connected (\(self.avccClients.count) total)")
        }
        return client
    }

    /// After a client's writer is attached: paint instantly with a JPEG seed,
    /// replay the cached decoder description, then ask the owner to force a
    /// keyframe so an IDR follows promptly.
    func sendInitialAvcc(to client: AVCCClient) {
        queue.async {
            if let jpeg = self.latestFrame {
                client.enqueue(AVCCEnvelope.seed(jpeg: jpeg), kind: .seed)
            }
            if let desc = self.cachedAvccDescription {
                client.enqueue(desc, kind: .description)
            }
        }
        onAvccClientConnect?()
    }

    func removeAvccClient(_ client: AVCCClient) {
        let key = ObjectIdentifier(client)
        configLock.lock(); avccClientCount = max(0, avccClientCount - 1); configLock.unlock()
        queue.async {
            self.avccClients.removeValue(forKey: key)
            print("[clients] AVCC client disconnected (\(self.avccClients.count) total)")
        }
    }

    /// Broadcast one enveloped AVCC chunk. Caches the description so it can be
    /// replayed to clients that connect after it was first emitted.
    func broadcastAvcc(_ envelope: Data, kind: AVCCChunkKind) {
        queue.async {
            if kind == .description { self.cachedAvccDescription = envelope }
            for (_, client) in self.avccClients {
                client.enqueue(envelope, kind: kind)
            }
        }
    }

    /// Max high-water backlog across AVCC clients since the last sample — the
    /// adaptive controller's congestion signal.
    func sampleAvccCongestion() -> Int {
        var maxHW = 0
        queue.sync {
            for (_, client) in self.avccClients { maxHW = max(maxHW, client.sampleHighWater()) }
        }
        return maxHW
    }

    /// Number of server-side AVCC chunks dropped since the last sample.
    func sampleAvccDropped() -> Int {
        var dropped = 0
        queue.sync {
            for (_, client) in self.avccClients { dropped += client.sampleDropped() }
        }
        return dropped
    }

    /// Push an adaptive stream-stats snapshot to every input WebSocket (tag
    /// 0x83) so the Connection Stats panel can show server-side state.
    func broadcastStreamStats(_ stats: [String: Any]) {
        broadcastWsJson(ClientManager.wsMsgStreamStats, stats)
    }

    // MARK: - WebSocket Client Management (input only)

    func addWSClient(_ session: WebSocketSession) {
        let id = ObjectIdentifier(session)
        let frame = configFrame()
        queue.async {
            self.wsSessions[id] = session
            // Seed the new client with the current screen config so it gets
            // dimensions/orientation immediately, replacing the old 1s poll.
            if let frame = frame { session.writeBinary(frame) }
            print("[clients] WS input client connected (\(self.wsSessions.count) total)")
        }
    }

    func removeWSClient(_ session: WebSocketSession) {
        let id = ObjectIdentifier(session)
        queue.async {
            self.wsSessions.removeValue(forKey: id)
            print("[clients] WS input client disconnected (\(self.wsSessions.count) total)")
        }
    }

    // MARK: - Message Handling

    func handleMessage(from session: WebSocketSession, data: Data) {
        guard data.count >= 1 else { return }
        let type = data[0]

        if type == 0x03 { // WS_MSG_TOUCH
            guard let json = try? JSONDecoder().decode(TouchEventPayload.self, from: data[1...]) else { return }
            onTouch?(json)
        } else if type == 0x04 { // WS_MSG_BUTTON
            guard let json = try? JSONDecoder().decode(ButtonEventPayload.self, from: data[1...]) else { return }
            onButton?(json.button)
        } else if type == 0x05 { // WS_MSG_MULTI_TOUCH
            guard let json = try? JSONDecoder().decode(MultiTouchEventPayload.self, from: data[1...]) else { return }
            onMultiTouch?(json)
        } else if type == 0x06 { // WS_MSG_KEY
            guard let json = try? JSONDecoder().decode(KeyEventPayload.self, from: data[1...]) else { return }
            onKey?(json)
        } else if type == 0x07 { // WS_MSG_ORIENTATION
            guard let json = try? JSONDecoder().decode(OrientationEventPayload.self, from: data[1...]) else { return }
            let value: UInt32
            switch json.orientation {
            case "portrait":             value = HIDInjector.orientationPortrait
            case "portrait_upside_down": value = HIDInjector.orientationPortraitUpsideDown
            case "landscape_left":       value = HIDInjector.orientationLandscapeLeft
            case "landscape_right":      value = HIDInjector.orientationLandscapeRight
            default:
                print("[clients] Unknown orientation: \(json.orientation)")
                return
            }
            if onOrientation?(value) == true {
                setScreenOrientation(json.orientation)
            } else {
                print("[clients] Orientation request failed: \(json.orientation)")
            }
        } else if type == 0x08 { // WS_MSG_CA_DEBUG
            guard let json = try? JSONDecoder().decode(CADebugEventPayload.self, from: data[1...]) else { return }
            onCADebug?(json)
        } else if type == 0x09 { // WS_MSG_MEMORY_WARNING
            onMemoryWarning?()
        } else if type == 0x0A { // WS_MSG_DIGITAL_CROWN
            guard let json = try? JSONDecoder().decode(DigitalCrownEventPayload.self, from: data[1...]) else { return }
            onDigitalCrown?(json)
        } else if type == 0x0B { // WS_MSG_REQUEST_KEYFRAME
            onNeedKeyframe?()
        } else if type == 0x0C { // WS_MSG_SET_MODE
            guard let json = try? JSONDecoder().decode(SetModePayload.self, from: data[1...]) else { return }
            onSetMode?(json.mode)
        }
    }

    // MARK: - Frame Broadcasting

    func broadcastFrame(jpegData: Data) {
        queue.async {
            self.latestFrame = jpegData
            guard !self.mjpegClients.isEmpty else { return }
            for (_, client) in self.mjpegClients {
                client.send(frame: jpegData)
            }
        }
    }

    func stop() {
        queue.async {
            for (_, client) in self.mjpegClients {
                client.close()
            }
            for (_, client) in self.avccClients {
                client.close()
            }
            self.mjpegClients.removeAll()
            self.avccClients.removeAll()
            self.wsSessions.removeAll()
        }
        configLock.lock(); avccClientCount = 0; configLock.unlock()
        configLock.lock(); mjpegClientCount = 0; configLock.unlock()
    }
}

/// Kind of an AVCC chunk — lets the client's coalescing queue decide what is
/// safe to drop when the link falls behind.
enum AVCCChunkKind {
    case description  // SPS/PPS; must keep — precedes a keyframe
    case keyframe     // IDR; a resync point that makes pending deltas obsolete
    case delta        // P-frame; droppable (dropping any forces a resync)
    case seed         // one-shot JPEG; droppable
}

/// A single AVCC streaming client with a bounded, coalescing outbound queue.
///
/// The previous design wrote each chunk inline on the shared client-manager
/// queue, so one slow socket (e.g. a remote tunnel) blocked *every* client and
/// let encoded frames pile up without bound — latency grew until the stream
/// felt "stuck." Now each client owns a small pending buffer drained by its own
/// connection thread. When the buffer backs up past `highWaterBytes`, new delta
/// frames are dropped and a keyframe is requested: the viewer briefly holds the
/// last good frame, then snaps to the fresh IDR. Memory is bounded and the
/// stream always converges — it can fall behind in *quality*, never in
/// *liveness*.
final class AVCCClient {
    let id: Int
    private let cond = NSCondition()
    private var pending: [Data] = []
    /// Latest decoder config (avcC SPS/PPS) awaiting delivery, held OUTSIDE the
    /// droppable `pending` queue. A keyframe resync clears `pending`, but the
    /// config is a sticky preamble — a keyframe is undecodable without it — so it
    /// must survive that drop and always flush before the IDR it configures. On
    /// the first connection after launch the encoder emits the description and
    /// the forced IDR back-to-back, so without this slot the keyframe's
    /// `removeAll()` races the config out before the drain thread sends it, and
    /// the viewer's WebCodecs decoder never configures — stranding the preview on
    /// "Connecting…" until the stream is reopened.
    private var pendingDescription: Data?
    private var queuedBytes = 0
    private var closed = false
    private var needKeyframe = false
    private var droppedSinceSample = 0
    /// High-water mark of `queuedBytes` since the last sample — the congestion
    /// signal the adaptive controller reads.
    private var highWater = 0
    private let highWaterBytes: Int
    /// Fired (off the producer path) when the queue overflows and a fresh IDR
    /// is needed to resync after dropping deltas.
    var onNeedKeyframe: (() -> Void)?

    init(id: Int, highWaterBytes: Int = 512 * 1024) {
        self.id = id
        self.highWaterBytes = highWaterBytes
    }

    /// Producer side: enqueue a chunk for delivery, applying the drop policy.
    func enqueue(_ chunk: Data, kind: AVCCChunkKind) {
        cond.lock()
        guard !closed else { cond.unlock(); return }
        switch kind {
        case .keyframe:
            // Resync point: anything still queued is now obsolete.
            pending.removeAll()
            queuedBytes = 0
            needKeyframe = false
            append(chunk)
            cond.unlock()
        case .description:
            // Sticky preamble: park it in the dedicated slot (latest config
            // wins) so a following keyframe's resync drop can't discard it.
            pendingDescription = chunk
            cond.signal()
            cond.unlock()
        case .delta, .seed:
            if queuedBytes >= highWaterBytes {
                // Behind: drop this frame rather than grow an unplayable
                // backlog, and ask for a keyframe to resync cleanly.
                droppedSinceSample += 1
                let fire = !needKeyframe
                needKeyframe = true
                let cb = onNeedKeyframe
                cond.unlock()
                if fire, let cb { DispatchQueue.global(qos: .userInteractive).async { cb() } }
            } else {
                append(chunk)
                cond.unlock()
            }
        }
    }

    /// Caller must hold `cond`.
    private func append(_ chunk: Data) {
        pending.append(chunk)
        queuedBytes += chunk.count
        if queuedBytes > highWater { highWater = queuedBytes }
        cond.signal()
    }

    /// Consumer side: block-drains the queue via `write` until closed or a write
    /// fails. Runs on the HTTP connection thread, so a slow socket only blocks
    /// *this* client.
    func drain(write: (Data) -> Bool) {
        while true {
            cond.lock()
            while pending.isEmpty && pendingDescription == nil && !closed { cond.wait() }
            if closed { cond.unlock(); return }
            // Flush the decoder config ahead of the batch so it always precedes
            // the keyframe it configures.
            let desc = pendingDescription
            pendingDescription = nil
            let batch = pending
            pending = []
            queuedBytes = 0
            cond.unlock()
            if let desc, !write(desc) { close(); return }
            for data in batch {
                if !write(data) { close(); return }
            }
        }
    }

    /// Read and reset the high-water backlog since the last call (congestion
    /// signal for the adaptive controller).
    func sampleHighWater() -> Int {
        cond.lock(); defer { cond.unlock() }
        let hw = highWater
        highWater = queuedBytes
        return hw
    }

    func sampleDropped() -> Int {
        cond.lock(); defer { cond.unlock() }
        let dropped = droppedSinceSample
        droppedSinceSample = 0
        return dropped
    }

    func close() {
        cond.lock()
        closed = true
        pending.removeAll()
        pendingDescription = nil
        queuedBytes = 0
        cond.signal()
        cond.unlock()
    }
}

/// Represents a single MJPEG streaming client with a continuation-based writer.
final class MJPEGClient {
    let id: Int
    private var writer: ((Data) -> Bool)?
    private let boundary = "frame"
    private var closed = false

    init(id: Int) {
        self.id = id
    }

    func setWriter(_ writer: @escaping (Data) -> Bool) {
        self.writer = writer
    }

    func send(frame jpegData: Data) {
        guard !closed, let writer = writer else { return }
        var chunk = Data()
        let header = "--\(boundary)\r\nContent-Type: image/jpeg\r\nContent-Length: \(jpegData.count)\r\n\r\n"
        chunk.append(Data(header.utf8))
        chunk.append(jpegData)
        chunk.append(Data("\r\n".utf8))
        if !writer(chunk) {
            closed = true
        }
    }

    func close() {
        closed = true
        writer = nil
    }
}
