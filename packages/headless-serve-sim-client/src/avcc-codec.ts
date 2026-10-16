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

export type AvccChunkType =
  | "description"
  | "keyframe"
  | "delta"
  | "seed"
  | "disposable-delta"
  | "metadata"
  | "timing";

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
  0x07: "metadata",
  0x08: "timing",
};

export function decodeBackpressureAction(
  type: "delta" | "disposable-delta",
  decodeQueueSize: number,
  oldestDecodeAgeMs: number,
): "decode" | "drop" | "reset" {
  // A fetch read may contain several frames. Give the decoder one frame budget
  // to consume that fresh burst before applying latency recovery; queue size
  // alone counts commands submitted in this task, not a sustained backlog.
  if (decodeQueueSize < 12 && oldestDecodeAgeMs < 1000 / 60) return "decode";
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

/** Display size from the first SPS of an avcC record, or null when unreadable. */
export function avcCodedSize(description: Uint8Array): { width: number; height: number } | null {
  if (description.length < 8 || (description[5]! & 0x1f) < 1) return null;
  const length = (description[6]! << 8) | description[7]!;
  if (description.length < 8 + length || length < 4) return null;
  // Drop emulation-prevention bytes (00 00 03) to recover the RBSP.
  const rbsp: number[] = [];
  for (let i = 9; i < 8 + length; i++) {
    const byte = description[i]!;
    if (byte === 3 && rbsp.length >= 2 && rbsp.at(-1) === 0 && rbsp.at(-2) === 0) continue;
    rbsp.push(byte);
  }
  let bit = 0;
  const u = (count: number) => {
    let value = 0;
    for (let i = 0; i < count; i++, bit++) {
      if (bit >> 3 >= rbsp.length) throw new RangeError("truncated SPS");
      value = value * 2 + ((rbsp[bit >> 3]! >> (7 - (bit & 7))) & 1);
    }
    return value;
  };
  const ue = () => {
    let zeros = 0;
    while (u(1) === 0) zeros++;
    return 2 ** zeros - 1 + u(zeros);
  };
  const se = () => {
    const value = ue();
    return value & 1 ? (value + 1) / 2 : -value / 2;
  };
  try {
    const profile = u(8);
    u(16);
    ue();
    let chroma = 1;
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
      chroma = ue();
      if (chroma === 3) u(1);
      ue();
      ue();
      u(1);
      if (u(1)) {
        for (let list = 0; list < (chroma === 3 ? 12 : 8); list++) {
          if (!u(1)) continue;
          let last = 8,
            next = 8;
          for (let j = 0; j < (list < 6 ? 16 : 64); j++) {
            if (next !== 0) next = (last + se() + 256) % 256;
            last = next === 0 ? last : next;
          }
        }
      }
    }
    ue();
    const pocType = ue();
    if (pocType === 0) ue();
    else if (pocType === 1) {
      u(1);
      se();
      se();
      for (let n = ue(); n > 0; n--) se();
    }
    ue();
    u(1);
    const widthInMbs = ue() + 1;
    const heightInMapUnits = ue() + 1;
    const frameMbsOnly = u(1);
    if (!frameMbsOnly) u(1);
    u(1);
    const crop = u(1) ? [ue(), ue(), ue(), ue()] : [0, 0, 0, 0];
    const cropX = chroma === 0 || chroma === 3 ? 1 : 2;
    const cropY = (chroma === 1 ? 2 : 1) * (2 - frameMbsOnly);
    return {
      width: widthInMbs * 16 - (crop[0]! + crop[1]!) * cropX,
      height: (2 - frameMbsOnly) * heightInMapUnits * 16 - (crop[2]! + crop[3]!) * cropY,
    };
  } catch {
    return null;
  }
}

/** True when the runtime can decode the AVCC stream (WebCodecs available). */
export function isAvccSupported(): boolean {
  return (
    typeof globalThis !== "undefined" && typeof (globalThis as any).VideoDecoder !== "undefined"
  );
}
