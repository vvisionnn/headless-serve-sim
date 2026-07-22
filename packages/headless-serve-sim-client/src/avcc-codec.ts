/**
 * Wire parser for the headless-serve-sim `/stream.avcc` H.264 stream.
 *
 * Each chunk is a 4-byte big-endian length (covering the tag byte + payload)
 * followed by a one-byte tag and the payload:
 *
 *   [len:u32-be][tag:u8][payload…]   where len === payload.length + 1
 *
 * Tags (kept in sync with the Swift `AVCCEnvelope`):
 *   0x01 description — avcC parameter-set blob (SPS/PPS); configures decoder
 *   0x02 keyframe    — IDR (decodable standalone)
 *   0x03 delta       — non-IDR P-frame
 *   0x04 seed        — JPEG painted before the first IDR decodes
 *   0x06 disposable  — temporal enhancement P-frame; safe to drop
 *
 * The stream is read incrementally from a `fetch()` ReadableStream, so chunks
 * arrive split across reads. `AvccDemuxer` buffers partial bytes and yields
 * whole chunks. Pure: no DOM, no WebCodecs, no network — unit-testable.
 */

export const AVCC_TAG_DESCRIPTION = 0x01;
export const AVCC_TAG_KEYFRAME = 0x02;
export const AVCC_TAG_DELTA = 0x03;
export const AVCC_TAG_SEED = 0x04;
export const AVCC_TAG_DISPOSABLE_DELTA = 0x06;

export type AvccChunkType = "description" | "keyframe" | "delta" | "seed" | "disposable-delta";

export interface AvccChunk {
  type: AvccChunkType;
  /** Payload bytes (tag stripped). */
  payload: Uint8Array;
}

const TAG_TO_TYPE: Record<number, AvccChunkType | undefined> = {
  [AVCC_TAG_DESCRIPTION]: "description",
  [AVCC_TAG_KEYFRAME]: "keyframe",
  [AVCC_TAG_DELTA]: "delta",
  [AVCC_TAG_SEED]: "seed",
  [AVCC_TAG_DISPOSABLE_DELTA]: "disposable-delta",
};

export function decodeBackpressureAction(
  type: "delta" | "disposable-delta",
  decodeQueueSize: number,
): "decode" | "drop" | "reset" {
  if (type === "disposable-delta" && decodeQueueSize > 1) return "drop";
  if (type === "delta" && decodeQueueSize > 4) return "reset";
  return "decode";
}

// Upper bound on a single chunk. A full-resolution IDR is well under this; a
// declared length above it means we've lost framing, so we resync instead of
// blocking forever waiting for bytes that will never arrive.
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;

const EMPTY = new Uint8Array(0);

/**
 * Stateful demuxer that turns a byte stream into whole AVCC chunks. Feed it
 * each `Uint8Array` from the reader; it returns the chunks now fully buffered
 * and retains any trailing partial bytes for the next call.
 */
export class AvccDemuxer {
  private buffer = EMPTY;

  push(bytes: Uint8Array): AvccChunk[] {
    const chunks: AvccChunk[] = [];
    this.visit(bytes, (type, payload) => chunks.push({ type, payload: payload.slice() }));
    return chunks;
  }

  /**
   * Allocation-free steady-state parser for synchronous consumers. Payload
   * views are valid only for the duration of `visitor`; callers that retain a
   * payload must copy it. `EncodedVideoChunk` and `Blob` consume their input
   * synchronously, while decoder descriptions explicitly clone before return.
   */
  visit(bytes: Uint8Array, visitor: (type: AvccChunkType, payload: Uint8Array) => void): void {
    // Fast path: with nothing retained, parse straight out of the incoming
    // bytes and copy only the trailing partial chunk back into `buffer`. In
    // steady state each read carries ~one whole frame and drains fully, so this
    // skips a full-buffer alloc+copy on every read — pure GC pressure off the
    // 60fps decode loop. Only when a partial chunk straddles reads do we merge.
    let src: Uint8Array;
    if (this.buffer.length === 0) {
      src = bytes;
    } else if (bytes.length > 0) {
      const merged = new Uint8Array(this.buffer.length + bytes.length);
      merged.set(this.buffer);
      merged.set(bytes, this.buffer.length);
      src = merged;
    } else {
      src = this.buffer;
    }

    let offset = 0;
    while (src.length - offset >= 4) {
      const view = new DataView(src.buffer, src.byteOffset + offset, 4);
      const length = view.getUint32(0, false);
      // length covers the tag byte + payload. Below 1 or above the sane cap
      // means framing is lost (corrupt/torn stream): skip the 4-byte header and
      // resync rather than waiting forever for bytes that never arrive — or
      // spinning. Checked before the availability test so a bogus huge length
      // can't freeze the demuxer.
      if (length < 1 || length > MAX_CHUNK_BYTES) {
        offset += 4;
        continue;
      }
      // Need the whole chunk buffered before we can emit it.
      if (src.length - offset - 4 < length) break;
      const tag = src[offset + 4]!;
      const payload = src.subarray(offset + 5, offset + 4 + length);
      const type = TAG_TO_TYPE[tag];
      if (type) visitor(type, payload);
      offset += 4 + length;
    }

    // Retain the unparsed remainder. Skip the copy when nothing was consumed
    // from our own buffer; otherwise copy (the remainder may live inside the
    // caller's transient `bytes`).
    if (offset >= src.length) {
      this.buffer = EMPTY;
    } else if (offset === 0 && src === this.buffer) {
      // unchanged — keep the existing buffer as-is
    } else {
      this.buffer = src.slice(offset);
    }
  }

  reset(): void {
    this.buffer = EMPTY;
  }
}

/**
 * Build the WebCodecs `VideoDecoder` codec string from an avcC description
 * blob. The 2nd–4th bytes are profile_idc / constraint flags / level_idc,
 * yielding e.g. `avc1.640028`.
 */
export function avcCodecString(description: Uint8Array): string {
  if (description.length < 4) return "avc1.42E01E";
  const hex2 = (b: number) => b.toString(16).padStart(2, "0");
  return "avc1." + hex2(description[1]!) + hex2(description[2]!) + hex2(description[3]!);
}

/** True when the runtime can decode the AVCC stream (WebCodecs available). */
export function isAvccSupported(): boolean {
  return (
    typeof globalThis !== "undefined" && typeof (globalThis as any).VideoDecoder !== "undefined"
  );
}
