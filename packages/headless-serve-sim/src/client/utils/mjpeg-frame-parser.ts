/**
 * Incremental MJPEG frame parser.
 *
 * The stream arrives as arbitrarily-chunked bytes and has to be cut back into
 * whole JPEGs. The naive form of that — concatenate every chunk into a fresh
 * array, then rescan from zero for markers — is quadratic in the bytes seen,
 * which at 60fps is the difference between an idle tab and a locked-up one.
 *
 * Three things keep it linear:
 *   - an amortised growable buffer, compacted in place, so a chunk costs one
 *     copy of *its own* bytes rather than a copy of the whole backlog;
 *   - a scan cursor, so bytes already examined for an end marker are not
 *     examined again on the next chunk;
 *   - `Content-Length`, when the server sends it, which turns framing into
 *     arithmetic and skips scanning altogether.
 *
 * That last one is also a correctness fix, not just speed: `FFD9` is only the
 * end-of-image marker when it appears in the marker stream. The same two bytes
 * occur naturally inside entropy-coded scan data, so a blind search for them
 * can cut a frame short and hand a decoder a truncated JPEG. A declared length
 * is authoritative.
 */
export interface MjpegFrameParser {
  /**
   * Feed a chunk and get back every frame that is now complete.
   *
   * Returned arrays are views onto the parser's internal buffer, valid only
   * until the next `push`/`reset`. Copy (or hand to `new Blob`, which copies
   * synchronously) before continuing.
   */
  push(chunk: Uint8Array): Uint8Array[];
  /** Drop all buffered bytes — use when the underlying stream reconnects. */
  reset(): void;
}

const MARKER = 0xff;
const SOI = 0xd8; // start of image
const EOI = 0xd9; // end of image

const CONTENT_LENGTH = "content-length:";
const DEFAULT_CAPACITY = 1 << 16;

/**
 * Cap on header bytes tolerated before a start-of-image marker. A stream that
 * never produces one must not buffer without bound; real multipart preambles
 * are a couple hundred bytes.
 */
const MAX_PREAMBLE = 1 << 14;

export function createMjpegFrameParser(initialCapacity = DEFAULT_CAPACITY): MjpegFrameParser {
  let buf = new Uint8Array(initialCapacity);
  /** First byte not yet emitted as part of a frame. */
  let start = 0;
  /** One past the last valid byte. */
  let end = 0;
  /** Where the end-of-image scan resumes; never rescans settled bytes. */
  let scanFrom = 0;

  function ensureCapacity(extra: number): void {
    if (end + extra <= buf.length) return;
    // Reclaim consumed bytes in place before growing — a steady stream of
    // same-sized frames then never grows the buffer at all.
    if (start > 0) {
      buf.copyWithin(0, start, end);
      end -= start;
      scanFrom = Math.max(0, scanFrom - start);
      start = 0;
    }
    if (end + extra > buf.length) {
      let capacity = buf.length;
      while (capacity < end + extra) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(buf.subarray(0, end));
      buf = grown;
    }
  }

  /** Index of a two-byte marker at or after `from`, or -1. */
  function findMarker(second: number, from: number): number {
    for (let i = Math.max(from, start); i < end - 1; i++) {
      if (buf[i] === MARKER && buf[i + 1] === second) return i;
    }
    return -1;
  }

  /**
   * `Content-Length` declared in the multipart part header preceding the
   * image, or 0 when absent. Only the bytes between the last frame and this
   * frame's SOI are considered, so image data is never misread as a header.
   */
  function declaredLength(from: number, to: number): number {
    for (let i = from; i < to; i++) {
      let k = 0;
      while (
        k < CONTENT_LENGTH.length &&
        i + k < to &&
        (buf[i + k]! | 0x20) === CONTENT_LENGTH.charCodeAt(k)
      ) {
        k++;
      }
      if (k < CONTENT_LENGTH.length) continue;
      let j = i + k;
      while (j < to && (buf[j] === 0x20 || buf[j] === 0x09)) j++;
      let value = 0;
      let digits = 0;
      while (j < to && buf[j]! >= 0x30 && buf[j]! <= 0x39) {
        value = value * 10 + (buf[j]! - 0x30);
        j++;
        digits++;
      }
      if (digits > 0) return value;
    }
    return 0;
  }

  /** Pull one frame if a complete one is buffered. */
  function nextFrame(): Uint8Array | null {
    const soi = findMarker(SOI, start);
    if (soi < 0) {
      // No image yet. Keep the tail in case the marker straddles this chunk
      // boundary, but don't let a stream that never frames grow forever.
      if (end - start > MAX_PREAMBLE) {
        start = end - 1;
        scanFrom = start;
      }
      return null;
    }

    const length = declaredLength(start, soi);
    if (length > 0) {
      if (end - soi < length) return null; // wait for the rest
      const frame = buf.subarray(soi, soi + length);
      start = soi + length;
      scanFrom = start;
      return frame;
    }

    // No declared length: fall back to scanning for the end marker, resuming
    // where the last scan stopped rather than restarting at the frame head.
    const from = Math.max(scanFrom, soi + 2);
    const eoi = findMarker(EOI, from);
    if (eoi < 0) {
      // Everything up to the final byte is settled; that byte could be the
      // first half of a marker split across chunks, so keep it in play.
      scanFrom = Math.max(from, end - 1);
      return null;
    }
    const frame = buf.subarray(soi, eoi + 2);
    start = eoi + 2;
    scanFrom = start;
    return frame;
  }

  return {
    push(chunk: Uint8Array): Uint8Array[] {
      if (chunk.length > 0) {
        ensureCapacity(chunk.length);
        buf.set(chunk, end);
        end += chunk.length;
      }
      const frames: Uint8Array[] = [];
      for (;;) {
        const frame = nextFrame();
        if (!frame) break;
        frames.push(frame);
      }
      if (start === end) {
        // Fully drained — rewind so a steady stream stays at offset 0.
        start = 0;
        end = 0;
        scanFrom = 0;
      }
      return frames;
    },
    reset(): void {
      start = 0;
      end = 0;
      scanFrom = 0;
    },
  };
}
