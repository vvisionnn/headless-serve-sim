import { useEffect } from "react";
import {
  AvccDemuxer,
  avcCodecString,
  isAvccSupported,
} from "../avcc-codec.js";

/** Per-frame telemetry handed to `onFrame` for the Connection Stats panel. */
export interface AvccFrameInfo {
  /** Encoded byte size of the chunk that produced this frame (0 for the seed). */
  bytes: number;
  /** Decode duration in ms (decode() → output), or null for the JPEG seed. */
  decodeMs: number | null;
  /** Active codec string (e.g. "avc1.640028"), or null before configuration. */
  codec: string | null;
  /** Cumulative count of undecodable chunks dropped since stream start. */
  dropped: number;
  /** True if this painted frame was a keyframe (IDR) — drives keyframe-interval. */
  keyframe: boolean;
  /** Cumulative count of pipeline recoveries (decoder recreated / reconnected). */
  recoveries: number;
}

export interface UseAvccStreamOptions {
  /** Base server URL, e.g. "http://localhost:3100". */
  url: string;
  /** When false, the hook tears down any active decode and does nothing. */
  enabled: boolean;
  /** Target canvas the decoded frames are painted into. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Called the first time any frame (seed or decoded) is painted. */
  onFirstFrame?: () => void;
  /** Called on every painted frame with per-frame telemetry — drives the FPS
   * counter / staleness check and the Connection Stats panel. */
  onFrame?: (info: AvccFrameInfo) => void;
  /** Called with a human-readable message when the decode pipeline fails. */
  onError?: (message: string) => void;
  /** Called (debounced) when the decoder needs a fresh IDR to recover — wire to
   * a client→server keyframe request so the server emits one promptly. */
  onRequestKeyframe?: () => void;
  /** Called whenever stream bytes arrive (decodable or not). A liveness signal
   * distinct from painted frames: during keyframe recovery the stream keeps
   * delivering bytes while painting nothing, so byte arrival — not paint — is
   * what proves the stream is still alive. */
  onProgress?: () => void;
}

/**
 * Decodes the `/stream.avcc` H.264 stream into a `<canvas>` using WebCodecs.
 *
 * A length-prefixed envelope carries an avcC `description` (decoder config),
 * `keyframe`/`delta` NAL chunks, and a one-shot JPEG `seed` painted before the
 * first IDR decodes so the canvas isn't blank on connect. No-op (and the caller
 * should fall back to MJPEG) when the browser lacks `VideoDecoder`.
 *
 * Recovery: a lost/garbled reference frame would otherwise ghost until the next
 * server IDR (up to the keyframe interval). Instead, a failed `decode()` drops
 * subsequent deltas until a fresh keyframe (drop-until-IDR) and asks the server
 * for one; a fatal `VideoDecoder` error (which permanently bricks the decoder)
 * reconnects the stream so the server re-primes config + a forced IDR.
 */
export function useAvccStream({
  url,
  enabled,
  canvasRef,
  onFirstFrame,
  onFrame,
  onError,
  onRequestKeyframe,
  onProgress,
}: UseAvccStreamOptions): void {
  useEffect(() => {
    if (!enabled || !isAvccSupported()) return;

    let stopped = false;
    let painted = false;
    let timestamp = 0;
    let currentCodec: string | null = null;
    let dropped = 0;
    let recoveries = 0;
    // True until the next keyframe decodes. While set, deltas are skipped so we
    // never feed the decoder a P-frame that references a frame it lacks (the
    // classic ghosting source). Starts true: the first real frame after the
    // decoder config is always the server's forced IDR.
    let awaitingKeyframe = true;
    let lastKeyframeReqAt = -1e9;

    // FIFO of in-flight decodes: outputs arrive in decode order (no B-frames in
    // this low-latency P-frame stream), so each output pairs with the oldest
    // pending entry to recover its size, decode latency, and keyframe flag.
    const pendingDecodes: { bytes: number; t0: number; keyframe: boolean }[] = [];
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let connController: AbortController | null = null;
    let reconnecting = false;
    const demuxer = new AvccDemuxer();

    const VideoDecoderCtor = (globalThis as any).VideoDecoder as typeof VideoDecoder;
    const EncodedVideoChunkCtor = (globalThis as any)
      .EncodedVideoChunk as typeof EncodedVideoChunk;

    const requestKeyframe = () => {
      const now = performance.now();
      if (now - lastKeyframeReqAt < 200) return; // debounce — avoid IDR storms
      lastKeyframeReqAt = now;
      onRequestKeyframe?.();
    };

    const paint = (source: CanvasImageSource, w: number, h: number, info: AvccFrameInfo) => {
      if (stopped) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(source, 0, 0, w, h);
      onFrame?.(info);
      if (!painted) {
        painted = true;
        onFirstFrame?.();
      }
    };

    let decoder: VideoDecoder | null = null;
    const makeDecoder = () =>
      new VideoDecoderCtor({
        output: (frame) => {
          try {
            if (stopped) return;
            const pend = pendingDecodes.shift();
            paint(frame, frame.displayWidth, frame.displayHeight, {
              bytes: pend?.bytes ?? 0,
              decodeMs: pend ? performance.now() - pend.t0 : null,
              codec: currentCodec,
              dropped,
              keyframe: pend?.keyframe ?? false,
              recoveries,
            });
          } finally {
            frame.close();
          }
        },
        error: (err) => {
          onError?.(`decoder: ${err.message}`);
          // A WebCodecs decoder can't be reconfigured after an error — it must be
          // recreated. Reconnect so the server re-primes config + a fresh IDR.
          reconnect();
        },
      });

    const handleChunk = (
      type: "description" | "keyframe" | "delta" | "seed",
      payload: Uint8Array,
    ) => {
      if (type === "seed") {
        // JPEG seed — paint immediately for an instant first frame.
        const seedBytes = payload.byteLength;
        createImageBitmap(new Blob([payload as BlobPart], { type: "image/jpeg" }))
          .then((bmp) => {
            try {
              if (!stopped) {
                paint(bmp, bmp.width, bmp.height, {
                  bytes: seedBytes,
                  decodeMs: null,
                  codec: currentCodec,
                  dropped,
                  keyframe: false,
                  recoveries,
                });
              }
            } finally {
              bmp.close();
            }
          })
          .catch(() => {});
        return;
      }
      if (type === "description") {
        if (!decoder || decoder.state === "closed") decoder = makeDecoder();
        currentCodec = avcCodecString(payload);
        // A reconfigure invalidates any in-flight decodes for the old config and
        // requires a fresh IDR before any delta will decode.
        pendingDecodes.length = 0;
        awaitingKeyframe = true;
        try {
          decoder.configure({
            codec: currentCodec,
            description: payload,
            optimizeForLatency: true,
            hardwareAcceleration: "prefer-hardware",
          });
        } catch (e) {
          onError?.(`config: ${(e as Error).message}`);
        }
        return;
      }
      // keyframe | delta
      if (!decoder || decoder.state !== "configured") return;
      if (type === "delta" && awaitingKeyframe) {
        // Skip deltas until a keyframe resyncs the decoder — feeding them now
        // would composite on a stale/absent reference (ghosting).
        return;
      }
      try {
        const t0 = performance.now();
        decoder.decode(
          new EncodedVideoChunkCtor({
            type: type === "keyframe" ? "key" : "delta",
            timestamp,
            data: payload,
          }),
        );
        if (type === "keyframe") awaitingKeyframe = false;
        pendingDecodes.push({ bytes: payload.byteLength, t0, keyframe: type === "keyframe" });
        timestamp += 16667; // ~60fps tick; not displayed, just monotonic.
      } catch {
        // Undecodable chunk — drop to drop-until-IDR and pull a fresh keyframe.
        dropped++;
        awaitingKeyframe = true;
        requestKeyframe();
      }
    };

    const reconnect = () => {
      if (stopped || reconnecting) return;
      reconnecting = true;
      recoveries++;
      if (decoder && decoder.state !== "closed") {
        try { decoder.close(); } catch {}
      }
      decoder = null;
      currentCodec = null;
      awaitingKeyframe = true;
      pendingDecodes.length = 0;
      demuxer.reset();
      connController?.abort();
      if (retryTimer) clearTimeout(retryTimer);
      // Brief backoff so the server observes the closed socket before we re-open;
      // its per-connection priming re-sends config + forces an IDR.
      retryTimer = setTimeout(() => {
        retryTimer = null;
        reconnecting = false;
        void read();
      }, 120);
    };

    const scheduleRetry = () => {
      if (stopped || reconnecting || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void read();
      }, 1000);
    };

    const read = async () => {
      const ctrl = new AbortController();
      connController = ctrl;
      try {
        const res = await fetch(`${url}/stream.avcc`, { signal: ctrl.signal });
        const reader = res.body?.getReader();
        if (!reader) {
          scheduleRetry();
          return;
        }
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          // Bytes arrived → the stream is alive even if this chunk paints
          // nothing (e.g. a delta skipped while awaiting the next keyframe).
          onProgress?.();
          for (const chunk of demuxer.push(value)) {
            handleChunk(chunk.type, chunk.payload);
          }
        }
      } catch {
        /* aborted or network error */
      } finally {
        if (!stopped && !reconnecting && connController === ctrl) scheduleRetry();
      }
    };

    void read();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      connController?.abort();
      demuxer.reset();
      if (decoder && decoder.state !== "closed") {
        try { decoder.close(); } catch {}
      }
      decoder = null;
    };
  }, [url, enabled, canvasRef, onFirstFrame, onFrame, onError, onRequestKeyframe, onProgress]);
}
