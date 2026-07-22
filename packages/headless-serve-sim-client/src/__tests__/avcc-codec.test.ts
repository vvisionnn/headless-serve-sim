import { describe, expect, test } from "bun:test";
import {
  AvccDemuxer,
  avcCodecString,
  AVCC_TAG_DESCRIPTION,
  AVCC_TAG_KEYFRAME,
  AVCC_TAG_DELTA,
  AVCC_TAG_SEED,
  AVCC_TAG_DISPOSABLE_DELTA,
  decodeBackpressureAction,
} from "../avcc-codec";

/** Build one wire chunk: [len:u32-be][tag][payload]. len = payload + 1. */
function frame(tag: number, payload: number[]): Uint8Array {
  const length = payload.length + 1;
  const out = new Uint8Array(4 + length);
  const view = new DataView(out.buffer);
  view.setUint32(0, length, false);
  out[4] = tag;
  out.set(payload, 5);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe("AvccDemuxer", () => {
  test("parses a single complete chunk", () => {
    const d = new AvccDemuxer();
    const chunks = d.push(frame(AVCC_TAG_KEYFRAME, [1, 2, 3, 4]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.type).toBe("keyframe");
    expect(Array.from(chunks[0]!.payload)).toEqual([1, 2, 3, 4]);
  });

  test("parses multiple chunks in one push, preserving order and type", () => {
    const d = new AvccDemuxer();
    const chunks = d.push(
      concat(
        frame(AVCC_TAG_DESCRIPTION, [0x01, 0x64, 0x00, 0x28]),
        frame(AVCC_TAG_KEYFRAME, [9]),
        frame(AVCC_TAG_DELTA, [8, 7]),
        frame(AVCC_TAG_SEED, [0xff, 0xd8, 0xff, 0xd9]),
        frame(AVCC_TAG_DISPOSABLE_DELTA, [6]),
      ),
    );
    expect(chunks.map((c) => c.type)).toEqual([
      "description",
      "keyframe",
      "delta",
      "seed",
      "disposable-delta",
    ]);
  });

  test("drops only disposable temporal frames at a shallow decode backlog", () => {
    expect(decodeBackpressureAction("disposable-delta", 2)).toBe("drop");
    expect(decodeBackpressureAction("delta", 2)).toBe("decode");
    expect(decodeBackpressureAction("delta", 5)).toBe("reset");
  });

  test("buffers a chunk split across reads (header split)", () => {
    const d = new AvccDemuxer();
    const f = frame(AVCC_TAG_DELTA, [10, 11, 12]);
    // Split mid-length-prefix.
    expect(d.push(f.slice(0, 2))).toHaveLength(0);
    const chunks = d.push(f.slice(2));
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0]!.payload)).toEqual([10, 11, 12]);
  });

  test("buffers a chunk split across reads (payload split)", () => {
    const d = new AvccDemuxer();
    const f = frame(AVCC_TAG_KEYFRAME, [1, 2, 3, 4, 5, 6]);
    expect(d.push(f.slice(0, 6))).toHaveLength(0); // header + 1 payload byte
    const chunks = d.push(f.slice(6));
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0]!.payload)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("handles a single byte arriving at a time", () => {
    const d = new AvccDemuxer();
    const f = frame(AVCC_TAG_DELTA, [42, 43]);
    let chunks: ReturnType<AvccDemuxer["push"]> = [];
    for (const b of f) chunks = chunks.concat(d.push(new Uint8Array([b])));
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0]!.payload)).toEqual([42, 43]);
  });

  test("yields partial leading chunk then holds the rest", () => {
    const d = new AvccDemuxer();
    const a = frame(AVCC_TAG_KEYFRAME, [1]);
    const b = frame(AVCC_TAG_DELTA, [2, 3]);
    const combined = concat(a, b);
    // Deliver all of `a` plus only the first 3 bytes of `b`.
    const first = d.push(combined.slice(0, a.length + 3));
    expect(first.map((c) => c.type)).toEqual(["keyframe"]);
    const rest = d.push(combined.slice(a.length + 3));
    expect(rest.map((c) => c.type)).toEqual(["delta"]);
    expect(Array.from(rest[0]!.payload)).toEqual([2, 3]);
  });

  test("skips unknown tags without stalling the stream", () => {
    const d = new AvccDemuxer();
    const chunks = d.push(concat(frame(0x7f, [1, 2]), frame(AVCC_TAG_KEYFRAME, [5])));
    expect(chunks.map((c) => c.type)).toEqual(["keyframe"]);
  });

  test("reset() drops buffered partial bytes", () => {
    const d = new AvccDemuxer();
    const f = frame(AVCC_TAG_DELTA, [1, 2, 3]);
    d.push(f.slice(0, 4)); // buffer a partial header
    d.reset();
    // A fresh complete chunk now parses cleanly (no leftover corruption).
    const chunks = d.push(frame(AVCC_TAG_KEYFRAME, [9]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.type).toBe("keyframe");
  });

  test("resyncs past a zero-length header instead of consuming the stream", () => {
    const d = new AvccDemuxer();
    // A length of 0 is invalid (must cover at least the tag byte). The demuxer
    // should skip the 4-byte header and recover the following valid chunk.
    const bogus = new Uint8Array([0, 0, 0, 0]);
    const chunks = d.push(concat(bogus, frame(AVCC_TAG_KEYFRAME, [5])));
    expect(chunks.map((c) => c.type)).toEqual(["keyframe"]);
  });

  test("resyncs past a bogus oversized length instead of stalling forever", () => {
    const d = new AvccDemuxer();
    // 0xFFFFFFFF exceeds the sane cap; the old code would `break` and wait for
    // ~4 GB of bytes that never arrive (a frozen stream). The hardened demuxer
    // skips the header and parses the real chunk right behind it.
    const bogus = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    const chunks = d.push(concat(bogus, frame(AVCC_TAG_KEYFRAME, [7, 8])));
    expect(chunks.map((c) => c.type)).toEqual(["keyframe"]);
    expect(Array.from(chunks[0]!.payload)).toEqual([7, 8]);
  });

  // --- Zero-copy fast path (push parses straight out of `bytes` when the
  // internal buffer is drained, retaining only the trailing partial remainder).

  test("fast path: a complete chunk into a drained buffer emits and leaves no remainder", () => {
    const d = new AvccDemuxer();
    // First push drains fully (buffer empty before and after).
    const first = d.push(frame(AVCC_TAG_KEYFRAME, [1, 2, 3, 4]));
    expect(first).toHaveLength(1);
    expect(Array.from(first[0]!.payload)).toEqual([1, 2, 3, 4]);
    // Second push must parse cleanly from scratch — proving no stray remainder
    // was retained from the first (an empty internal buffer takes the fast path).
    const second = d.push(frame(AVCC_TAG_DELTA, [5, 6]));
    expect(second).toHaveLength(1);
    expect(second[0]!.type).toBe("delta");
    expect(Array.from(second[0]!.payload)).toEqual([5, 6]);
  });

  test("fast path: multiple complete chunks in one drained push, no remainder held", () => {
    const d = new AvccDemuxer();
    const chunks = d.push(
      concat(
        frame(AVCC_TAG_KEYFRAME, [1]),
        frame(AVCC_TAG_DELTA, [2, 3]),
        frame(AVCC_TAG_DELTA, [4, 5, 6]),
      ),
    );
    expect(chunks.map((c) => c.type)).toEqual(["keyframe", "delta", "delta"]);
    // No remainder retained: a following standalone chunk parses on its own.
    const next = d.push(frame(AVCC_TAG_SEED, [9]));
    expect(next.map((c) => c.type)).toEqual(["seed"]);
    expect(Array.from(next[0]!.payload)).toEqual([9]);
  });

  test("fast path: complete chunks then a trailing partial — partial held, completed on merge", () => {
    const d = new AvccDemuxer();
    const whole = frame(AVCC_TAG_KEYFRAME, [1, 2, 3]);
    const split = frame(AVCC_TAG_DELTA, [7, 8, 9, 10]);
    // One whole chunk + the first 5 bytes of the next (header + 1 payload byte).
    const first = d.push(concat(whole, split.slice(0, 5)));
    expect(first.map((c) => c.type)).toEqual(["keyframe"]);
    expect(Array.from(first[0]!.payload)).toEqual([1, 2, 3]);
    // Remainder reassembles on the next (merge-path) push.
    const rest = d.push(split.slice(5));
    expect(rest.map((c) => c.type)).toEqual(["delta"]);
    expect(Array.from(rest[0]!.payload)).toEqual([7, 8, 9, 10]);
  });

  test("merge path: header straddles two pushes and reassembles", () => {
    const d = new AvccDemuxer();
    const f = frame(AVCC_TAG_DELTA, [21, 22, 23]);
    // Split inside the 4-byte length prefix so the merge branch must run.
    expect(d.push(f.slice(0, 3))).toHaveLength(0);
    const chunks = d.push(f.slice(3));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.type).toBe("delta");
    expect(Array.from(chunks[0]!.payload)).toEqual([21, 22, 23]);
  });

  test("merge path: payload straddles two pushes and reassembles", () => {
    const d = new AvccDemuxer();
    const f = frame(AVCC_TAG_KEYFRAME, [31, 32, 33, 34, 35]);
    // Header + 2 payload bytes in the first push; rest in the second.
    expect(d.push(f.slice(0, 7))).toHaveLength(0);
    const chunks = d.push(f.slice(7));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.type).toBe("keyframe");
    expect(Array.from(chunks[0]!.payload)).toEqual([31, 32, 33, 34, 35]);
  });

  test("transient bytes not aliased: mutating a partial input does not corrupt the eventual payload", () => {
    const d = new AvccDemuxer();
    const f = frame(AVCC_TAG_DELTA, [50, 51, 52, 53]);
    // Push only a prefix (header + 2 payload bytes). The retained remainder must
    // be COPIED out of the caller's array, not aliased to it.
    const input = f.slice(0, 7);
    expect(d.push(input)).toHaveLength(0);
    // Caller reuses/zeros its buffer after handing it off.
    input.fill(0);
    // Deliver the tail; the emitted payload must reflect the ORIGINAL bytes.
    const chunks = d.push(f.slice(7));
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0]!.payload)).toEqual([50, 51, 52, 53]);
  });

  test("transient bytes not aliased: zeroing the input after a complete-chunk push leaves the emitted payload intact", () => {
    const d = new AvccDemuxer();
    const input = frame(AVCC_TAG_KEYFRAME, [60, 61, 62, 63]);
    const chunks = d.push(input);
    expect(chunks).toHaveLength(1);
    // The reader is free to recycle/zero the array right after push returns.
    input.fill(0);
    expect(Array.from(chunks[0]!.payload)).toEqual([60, 61, 62, 63]);
  });

  test("transient bytes not aliased: partial-remainder copy survives mutation across a fast-path push that also emits", () => {
    const d = new AvccDemuxer();
    const whole = frame(AVCC_TAG_KEYFRAME, [70, 71]);
    const partial = frame(AVCC_TAG_DELTA, [80, 81, 82]);
    // One complete chunk plus header + 1 byte of the next, all via the fast path.
    const input = concat(whole, partial.slice(0, 5));
    const emitted = d.push(input);
    expect(emitted.map((c) => c.type)).toEqual(["keyframe"]);
    expect(Array.from(emitted[0]!.payload)).toEqual([70, 71]);
    // Mutate the whole input array; neither the already-emitted payload nor the
    // retained remainder may be affected.
    input.fill(0xaa);
    expect(Array.from(emitted[0]!.payload)).toEqual([70, 71]);
    const rest = d.push(partial.slice(5));
    expect(rest.map((c) => c.type)).toEqual(["delta"]);
    expect(Array.from(rest[0]!.payload)).toEqual([80, 81, 82]);
  });

  test("fast path: corrupt oversized length resyncs by skipping 4 bytes, parsing chunks on both sides", () => {
    const d = new AvccDemuxer();
    const before = frame(AVCC_TAG_KEYFRAME, [1, 2]);
    const bogus = new Uint8Array([0x7f, 0xff, 0xff, 0xff]); // > MAX_CHUNK_BYTES
    const after = frame(AVCC_TAG_DELTA, [3, 4]);
    const chunks = d.push(concat(before, bogus, after));
    expect(chunks.map((c) => c.type)).toEqual(["keyframe", "delta"]);
    expect(Array.from(chunks[0]!.payload)).toEqual([1, 2]);
    expect(Array.from(chunks[1]!.payload)).toEqual([3, 4]);
  });

  test("fast path: zero-length header resyncs by skipping 4 bytes", () => {
    const d = new AvccDemuxer();
    const bogus = new Uint8Array([0, 0, 0, 0]);
    const chunks = d.push(concat(bogus, frame(AVCC_TAG_SEED, [99])));
    expect(chunks.map((c) => c.type)).toEqual(["seed"]);
    expect(Array.from(chunks[0]!.payload)).toEqual([99]);
  });

  test("reset() clears a buffered remainder so the next push takes the fast path cleanly", () => {
    const d = new AvccDemuxer();
    // Leave a partial remainder in the internal buffer.
    expect(d.push(frame(AVCC_TAG_DELTA, [1, 2, 3]).slice(0, 6))).toHaveLength(0);
    d.reset();
    // A complete chunk now parses without the stale prefix corrupting framing.
    const chunks = d.push(frame(AVCC_TAG_KEYFRAME, [44]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.type).toBe("keyframe");
    expect(Array.from(chunks[0]!.payload)).toEqual([44]);
  });

  test("empty push with a drained buffer is a no-op and emits nothing", () => {
    const d = new AvccDemuxer();
    expect(d.push(new Uint8Array(0))).toHaveLength(0);
    // Stream is unaffected: a later complete chunk still parses.
    const chunks = d.push(frame(AVCC_TAG_KEYFRAME, [1]));
    expect(chunks.map((c) => c.type)).toEqual(["keyframe"]);
  });

  test("empty push preserves a buffered partial remainder (no drop, no double-parse)", () => {
    const d = new AvccDemuxer();
    const f = frame(AVCC_TAG_KEYFRAME, [11, 12, 13]);
    expect(d.push(f.slice(0, 5))).toHaveLength(0); // header + 1 payload byte held
    // An empty read must not disturb the retained bytes.
    expect(d.push(new Uint8Array(0))).toHaveLength(0);
    const chunks = d.push(f.slice(5));
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0]!.payload)).toEqual([11, 12, 13]);
  });
});

describe("avcCodecString", () => {
  test("derives avc1.<profile><constraints><level> from the avcC blob", () => {
    // avcC layout: [version=1][profile][constraints][level]…
    const blob = new Uint8Array([0x01, 0x64, 0x00, 0x28, 0xff, 0xe1]);
    expect(avcCodecString(blob)).toBe("avc1.640028");
  });

  test("falls back to a baseline codec for a too-short blob", () => {
    expect(avcCodecString(new Uint8Array([0x01]))).toBe("avc1.42E01E");
  });
});
