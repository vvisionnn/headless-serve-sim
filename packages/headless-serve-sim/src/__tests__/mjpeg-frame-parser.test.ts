import { describe, expect, test } from "bun:test";
import { createMjpegFrameParser } from "../client/utils/mjpeg-frame-parser";

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

/** A JPEG-shaped blob: SOI, `body`, EOI. */
function jpeg(body: number[]): Uint8Array {
  return new Uint8Array([...SOI, ...body, ...EOI]);
}

function ascii(text: string): number[] {
  const codes: number[] = [];
  for (let i = 0; i < text.length; i++) codes.push(text.charCodeAt(i));
  return codes;
}

/** One multipart part with a Content-Length header. */
function partWithLength(frame: Uint8Array): Uint8Array {
  const header = ascii(
    `--boundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`,
  );
  return new Uint8Array([...header, ...frame]);
}

/** Feed `bytes` through the parser in fixed-size chunks, collecting frames. */
function feed(bytes: Uint8Array, chunkSize: number): Uint8Array[] {
  const parser = createMjpegFrameParser();
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    // Copy each frame out: pushed views alias the parser buffer.
    for (const frame of parser.push(bytes.subarray(i, i + chunkSize))) {
      out.push(frame.slice());
    }
  }
  return out;
}

/** Plain numbers, so assertions don't depend on the view's buffer type. */
function bytes(view: Uint8Array): number[] {
  return Array.from(view);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("createMjpegFrameParser framing", () => {
  test("extracts a single header-less frame", () => {
    const frame = jpeg([1, 2, 3]);
    expect(feed(frame, 64)).toEqual([frame]);
  });

  test("extracts consecutive header-less frames", () => {
    const a = jpeg([1, 2, 3]);
    const b = jpeg([4, 5]);
    expect(feed(concat([a, b]), 64)).toEqual([a, b]);
  });

  test("extracts frames from multipart parts with Content-Length", () => {
    const a = jpeg([1, 2, 3]);
    const b = jpeg([4, 5, 6, 7]);
    const stream = concat([partWithLength(a), partWithLength(b)]);
    expect(feed(stream, 64)).toEqual([a, b]);
  });

  test("is invariant to chunk size", () => {
    const a = jpeg([1, 2, 3, 4, 5]);
    const b = jpeg([6, 7]);
    const stream = concat([partWithLength(a), partWithLength(b)]);
    for (const size of [1, 2, 3, 7, 16, 64, 4096]) {
      expect(feed(stream, size)).toEqual([a, b]);
    }
  });

  test("handles a marker split across a chunk boundary", () => {
    const frame = jpeg([1, 2, 3]);
    const parser = createMjpegFrameParser();
    // Cut between the two bytes of the trailing EOI marker.
    expect(parser.push(frame.subarray(0, frame.length - 1))).toEqual([]);
    const done = parser.push(frame.subarray(frame.length - 1));
    expect(done.length).toBe(1);
    expect(bytes(done[0]!)).toEqual(bytes(frame));
  });

  test("emits nothing until a frame is complete", () => {
    const parser = createMjpegFrameParser();
    expect(parser.push(new Uint8Array(SOI))).toEqual([]);
    expect(parser.push(new Uint8Array([1, 2, 3]))).toEqual([]);
  });

  test("reset drops a partial frame", () => {
    const parser = createMjpegFrameParser();
    parser.push(new Uint8Array([...SOI, 1, 2]));
    parser.reset();
    const frame = jpeg([9]);
    const out = parser.push(frame);
    expect(out.length).toBe(1);
    expect(bytes(out[0]!)).toEqual(bytes(frame));
  });

  test("skips leading boundary noise before the first frame", () => {
    const frame = jpeg([1]);
    const stream = concat([new Uint8Array(ascii("--boundary\r\n\r\n")), frame]);
    expect(feed(stream, 3)).toEqual([frame]);
  });

  test("survives a stream that never frames without buffering without bound", () => {
    const parser = createMjpegFrameParser();
    for (let i = 0; i < 1000; i++) parser.push(new Uint8Array(1024)); // all zeroes, no SOI
    // Still able to frame once real data shows up.
    const frame = jpeg([7]);
    const out = parser.push(frame);
    expect(out.length).toBe(1);
    expect(bytes(out[0]!)).toEqual(bytes(frame));
  });
});

describe("createMjpegFrameParser correctness against entropy-coded data", () => {
  // FFD9 is only an end-of-image marker in the marker stream; the same pair
  // occurs naturally inside compressed scan data. A blind scan cuts the frame
  // there and yields a truncated JPEG. A declared length is authoritative.
  test("a declared length wins over an FFD9 inside the payload", () => {
    const frame = jpeg([0x11, 0xff, 0xd9, 0x22, 0x33]);
    const out = feed(partWithLength(frame), 64);
    expect(out).toEqual([frame]);
    expect(out[0]!.length).toBe(frame.length);
  });

  test("the declared length is honored across chunk boundaries", () => {
    const frame = jpeg([0xff, 0xd9, 0xff, 0xd9, 0x01]);
    for (const size of [1, 2, 5, 13]) {
      expect(feed(partWithLength(frame), size)).toEqual([frame]);
    }
  });

  test("a lowercase content-length header is honored", () => {
    const frame = jpeg([0xff, 0xd9, 0x42]);
    const header = ascii(`--b\r\ncontent-length: ${frame.length}\r\n\r\n`);
    const stream = new Uint8Array([...header, ...frame]);
    expect(feed(stream, 64)).toEqual([frame]);
  });
});

describe("createMjpegFrameParser cost", () => {
  // The old reader reallocated the whole backlog per chunk and restarted the
  // marker scan at zero, so halving the chunk size roughly quadrupled the work.
  // Both are gone; work must stay proportional to bytes, not bytes squared.
  function bytesTouchedScaling(chunkSize: number): number {
    const frames = Array.from({ length: 40 }, () =>
      partWithLength(jpeg(new Array(2048).fill(0x5a))),
    );
    const stream = concat(frames);
    const parser = createMjpegFrameParser();
    let pushes = 0;
    const started = performance.now();
    for (let i = 0; i < stream.length; i += chunkSize) {
      parser.push(stream.subarray(i, i + chunkSize));
      pushes++;
    }
    const elapsed = performance.now() - started;
    expect(pushes).toBeGreaterThan(0);
    return elapsed;
  }

  test("finer chunking does not blow up cost superlinearly", () => {
    const coarse = bytesTouchedScaling(8192);
    const fine = bytesTouchedScaling(256);
    // 32x finer chunking. Quadratic accumulation would put `fine` orders of
    // magnitude above `coarse`; linear keeps it within a small factor. The
    // bound is loose so this measures the algorithm, not the machine.
    const budgetMs = Math.max(coarse * 40, 250);
    expect(fine).toBeLessThan(budgetMs);
  });

  test("a long stream of small chunks completes promptly", () => {
    const started = performance.now();
    const parser = createMjpegFrameParser();
    const frame = partWithLength(jpeg(new Array(4096).fill(0x33)));
    for (let n = 0; n < 200; n++) {
      for (let i = 0; i < frame.length; i += 128) {
        parser.push(frame.subarray(i, i + 128));
      }
    }
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
