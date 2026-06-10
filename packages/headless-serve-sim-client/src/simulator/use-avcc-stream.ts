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
}

/**
 * Decodes the `/stream.avcc` H.264 stream into a `<canvas>` using WebCodecs.
 *
 * Mirrors baguette's AVCC decoder: a length-prefixed envelope carrying an
 * avcC `description` (decoder config), `keyframe`/`delta` NAL chunks, and a
 * one-shot JPEG `seed` painted before the first IDR decodes so the canvas
 * isn't blank on connect. No-op (and the caller should fall back to MJPEG)
 * when the browser lacks `VideoDecoder`.
 */
export function useAvccStream({
  url,
  enabled,
  canvasRef,
  onFirstFrame,
  onFrame,
  onError,
}: UseAvccStreamOptions): void {
  useEffect(() => {
    if (!enabled || !isAvccSupported()) return;

    const controller = new AbortController();
    let stopped = false;
    let painted = false;
    let timestamp = 0;
    let currentCodec: string | null = null;
    let dropped = 0;
    // FIFO of in-flight decodes: outputs arrive in decode order (no B-frames in
    // this low-latency P-frame stream), so each output pairs with the oldest
    // pending entry to recover its encoded size + decode latency.
    const pendingDecodes: { bytes: number; t0: number }[] = [];
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const demuxer = new AvccDemuxer();

    const VideoDecoderCtor = (globalThis as any).VideoDecoder as typeof VideoDecoder;
    const EncodedVideoChunkCtor = (globalThis as any)
      .EncodedVideoChunk as typeof EncodedVideoChunk;

    const paint = (source: CanvasImageSource, w: number, h: number, info: AvccFrameInfo) => {
      if (stopped || controller.signal.aborted) return;
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
            if (stopped || controller.signal.aborted) return;
            const pend = pendingDecodes.shift();
            paint(frame, frame.displayWidth, frame.displayHeight, {
              bytes: pend?.bytes ?? 0,
              decodeMs: pend ? performance.now() - pend.t0 : null,
              codec: currentCodec,
              dropped,
            });
          } finally {
            frame.close();
          }
        },
        error: (err) => onError?.(`decoder: ${err.message}`),
      });

    const handleChunk = (
      type: "description" | "keyframe" | "delta" | "seed",
      payload: Uint8Array,
    ) => {
      if (type === "seed") {
        // JPEG seed — paint immediately for instant first frame.
        const seedBytes = payload.byteLength;
        createImageBitmap(new Blob([payload as BlobPart], { type: "image/jpeg" }))
          .then((bmp) => {
            try {
              if (!stopped && !controller.signal.aborted) {
                paint(bmp, bmp.width, bmp.height, {
                  bytes: seedBytes,
                  decodeMs: null,
                  codec: currentCodec,
                  dropped,
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
        // A reconfigure invalidates any in-flight decodes for the old config.
        pendingDecodes.length = 0;
        try {
          decoder.configure({
            codec: currentCodec,
            description: payload,
            optimizeFor: "latency",
            hardwareAcceleration: "prefer-hardware",
          } as VideoDecoderConfig);
        } catch (e) {
          onError?.(`config: ${(e as Error).message}`);
        }
        return;
      }
      // keyframe | delta
      if (!decoder || decoder.state !== "configured") return;
      try {
        const t0 = performance.now();
        decoder.decode(
          new EncodedVideoChunkCtor({
            type: type === "keyframe" ? "key" : "delta",
            timestamp,
            data: payload,
          }),
        );
        pendingDecodes.push({ bytes: payload.byteLength, t0 });
        timestamp += 16667; // ~60fps tick; not displayed, just monotonic.
      } catch {
        dropped++; // undecodable frame
      }
    };

    const scheduleRetry = () => {
      if (stopped || controller.signal.aborted || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void read();
      }, 1000);
    };

    const read = async () => {
      try {
        const res = await fetch(`${url}/stream.avcc`, { signal: controller.signal });
        const reader = res.body?.getReader();
        if (!reader) {
          scheduleRetry();
          return;
        }
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          for (const chunk of demuxer.push(value)) {
            handleChunk(chunk.type, chunk.payload);
          }
        }
      } catch {
        /* aborted or network error */
      } finally {
        if (!stopped) scheduleRetry();
      }
    };

    void read();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      controller.abort();
      demuxer.reset();
      if (decoder && decoder.state !== "closed") {
        try { decoder.close(); } catch {}
      }
      decoder = null;
    };
  }, [url, enabled, canvasRef, onFirstFrame, onFrame, onError]);
}
