// Pure, timer-free streaming-metrics math for the Connection Stats panel.
//
// The caller feeds frame samples with explicit timestamps (performance.now() at
// the call site) so every computation is deterministic and unit-testable —
// nothing in here reads the clock. SimulatorView owns the live instance and the
// 1 Hz emit; the web UI only renders the snapshots it produces.

export interface FrameSample {
  /** Monotonic timestamp in ms (e.g. performance.now()) when the frame painted. */
  tMs: number;
  /** Encoded/wire byte size of the frame. */
  bytes: number;
  /** Decode duration in ms, or null when not measurable (the MJPEG path). */
  decodeMs: number | null;
}

export interface ConnectionStatsSnapshot {
  /** Fractional frames/sec over the window (0 until ≥2 frames are present). */
  fps: number;
  /** Bits/sec over the window. */
  bitrateBps: number;
  /** Std-dev of inter-frame intervals in ms — frame-arrival jitter. */
  jitterMs: number;
  /** Mean decode time in ms over the window, or null when unmeasured. */
  decodeMs: number | null;
  /** Cumulative dropped-frame count since the accumulator was created. */
  droppedFrames: number;
  /** Frames retained in the current window (diagnostic). */
  frames: number;
}

/** Server-pushed adaptive state (over the input WebSocket, tag 0x83). Lets the
 * panel show what the encoder is doing in response to link conditions. */
export interface ServerStreamStats {
  /** "perf" | "quality" — current server streaming mode. */
  mode: "perf" | "quality";
  /** Adaptive target bitrate the encoder is currently set to (bits/sec). */
  targetBitrateBps: number;
  /** Current max-QP cap (sharpness ceiling, 1–51; lower = sharper). */
  maxQP: number;
  /** True when the viewer's send queue is backing up (link can't keep up). */
  congested: boolean;
  /** Server-side encode rate (frames/sec). */
  serverFps: number;
  /** Max queued bytes behind the viewer socket since the previous server tick. */
  queueBytes: number;
  /** Estimated send-queue delay at the current target bitrate. */
  queueMs: number;
  /** Server-side AVCC chunks dropped since the previous server tick. */
  droppedFrames: number;
}

/** Emitted outward by SimulatorView — the pure snapshot plus live codec, client
 * recovery counters, and the latest server adaptive state. */
export interface ConnectionStats extends ConnectionStatsSnapshot {
  /** Active video codec string (e.g. "avc1.640028"), or null for MJPEG/unknown. */
  codec: string | null;
  /** ms between the last two keyframes, or null until ≥2 keyframes are seen. */
  keyframeIntervalMs: number | null;
  /** Cumulative pipeline recoveries (decoder recreated/reconnected). */
  recoveries: number;
  /** Latest server-pushed adaptive state, or null if none received. */
  server: ServerStreamStats | null;
}

/** Parse a 0x83 stream-stats WebSocket payload (the JSON after the tag byte)
 * into `ServerStreamStats`, mapping the wire field names. Returns null if the
 * payload is malformed. Shared by the relay (app) and direct (library) WS
 * owners so the wire contract lives in one place. */
export function parseServerStreamStats(payload: Uint8Array): ServerStreamStats | null {
  try {
    const s = JSON.parse(new TextDecoder().decode(payload)) as {
      mode: string;
      targetBitrate: number;
      maxQP: number;
      congested: boolean;
      serverFps: number;
      queueBytes?: number;
      queueMs?: number;
      droppedFrames?: number;
    };
    if (s.mode !== "perf" && s.mode !== "quality") return null;
    return {
      mode: s.mode,
      targetBitrateBps: s.targetBitrate,
      maxQP: s.maxQP,
      congested: s.congested,
      serverFps: s.serverFps,
      queueBytes: Number.isFinite(s.queueBytes) ? s.queueBytes! : 0,
      queueMs: Number.isFinite(s.queueMs) ? s.queueMs! : 0,
      droppedFrames: Number.isFinite(s.droppedFrames) ? s.droppedFrames! : 0,
    };
  } catch {
    return null;
  }
}

export interface MetricSummary {
  min: number;
  avg: number;
  max: number;
  last: number;
}

const DEFAULT_WINDOW_MS = 2000;
// Backstop so a stalled snapshot loop can't grow the buffer without bound; prune
// already keeps it near windowMs × fps.
const MAX_FRAMES = 1024;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function stddev(values: number[], avg: number): number {
  if (values.length === 0) return 0;
  let acc = 0;
  for (const v of values) {
    const d = v - avg;
    acc += d * d;
  }
  return Math.sqrt(acc / values.length);
}

/** min / avg / max / last over a series; all-zero for an empty series. */
export function summarize(values: number[]): MetricSummary {
  if (values.length === 0) return { min: 0, avg: 0, max: 0, last: 0 };
  let min = values[0]!;
  let max = values[0]!;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, avg: sum / values.length, max, last: values[values.length - 1]! };
}

/**
 * Rolling accumulator over a trailing time window. Push one sample per painted
 * frame; read derived rates with `snapshot(now)`. Bitrate excludes the oldest
 * frame's bytes (they predate the measured span) so a steady stream reads
 * exactly bytes-per-interval × 8 / interval.
 */
export class ConnectionStatsAccumulator {
  private frames: FrameSample[] = [];
  private dropped = 0;
  private readonly windowMs: number;

  constructor(windowMs: number = DEFAULT_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  recordFrame(sample: FrameSample): void {
    this.frames.push(sample);
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  recordDrop(count: number = 1): void {
    this.dropped += count;
  }

  reset(): void {
    this.frames = [];
    this.dropped = 0;
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    let drop = 0;
    while (drop < this.frames.length && this.frames[drop]!.tMs < cutoff) drop++;
    if (drop > 0) this.frames.splice(0, drop);
  }

  snapshot(nowMs: number): ConnectionStatsSnapshot {
    this.prune(nowMs);
    const frames = this.frames;
    const n = frames.length;

    // Decode time averages over whatever frames carry it, independent of the
    // ≥2-frame requirement that rate/jitter need.
    let decodeSum = 0;
    let decodeCount = 0;
    for (const f of frames) {
      if (f.decodeMs != null) {
        decodeSum += f.decodeMs;
        decodeCount++;
      }
    }
    const decodeMs = decodeCount > 0 ? decodeSum / decodeCount : null;

    if (n < 2) {
      return {
        fps: 0,
        bitrateBps: 0,
        jitterMs: 0,
        decodeMs,
        droppedFrames: this.dropped,
        frames: n,
      };
    }

    const intervals: number[] = [];
    let sumBytes = 0;
    for (let i = 1; i < n; i++) {
      intervals.push(frames[i]!.tMs - frames[i - 1]!.tMs);
      sumBytes += frames[i]!.bytes;
    }
    const avgInterval = mean(intervals);
    const fps = avgInterval > 0 ? 1000 / avgInterval : 0;
    const jitterMs = stddev(intervals, avgInterval);
    const span = frames[n - 1]!.tMs - frames[0]!.tMs;
    const bitrateBps = span > 0 ? (sumBytes * 8 * 1000) / span : 0;

    return {
      fps,
      bitrateBps,
      jitterMs,
      decodeMs,
      droppedFrames: this.dropped,
      frames: n,
    };
  }
}
