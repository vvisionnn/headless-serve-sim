import { describe, expect, test } from "bun:test";
import { extractJpegComposition } from "../jpeg-composition";
import type { SimulatorComposition } from "../types";

const composition: SimulatorComposition = {
  angle: 90,
  rotation: 0,
  scale: 1,
  displayId: 3,
  rawWidth: 2007,
  rawHeight: 2853,
  rawRotation: 90,
  mask: "M0 0L1 1Z",
  bounds: [0, 0, 1, 1],
  pieces: [
    {
      displayId: 3,
      quad: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      region: [0, 0, 1, 1],
    },
  ],
};

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function segment(payload: Uint8Array, index = 0, count = 1): Uint8Array {
  const length = payload.length + 11;
  return concat(
    new Uint8Array([0xff, 0xef, length >> 8, length & 0xff]),
    new TextEncoder().encode("SSCM1"),
    new Uint8Array([index >> 8, index & 0xff, count >> 8, count & 0xff]),
    payload,
  );
}

function jpeg(...segments: Uint8Array[]): Uint8Array {
  return concat(new Uint8Array([0xff, 0xd8]), ...segments, new Uint8Array([0xff, 0xd9]));
}

function metadata(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("JPEG composition", () => {
  test("extracts frame-local composition from the native APP15 format", () => {
    expect(extractJpegComposition(jpeg(segment(metadata(composition))))).toEqual(composition);
  });

  test("reassembles composition over 64KB without mixing later frames", () => {
    const large = { ...composition, mask: "M0 0L1 1".repeat(16000) };
    const bytes = metadata(large);
    const chunkSize = 65523;
    const count = Math.ceil(bytes.length / chunkSize);
    const segments = Array.from({ length: count }, (_, index) =>
      segment(bytes.subarray(index * chunkSize, (index + 1) * chunkSize), index, count),
    );
    expect(count).toBeGreaterThan(1);
    for (const part of segments) expect((part[2]! << 8) | part[3]!).toBeLessThan(65535);
    const first = extractJpegComposition(jpeg(...segments));
    expect(
      extractJpegComposition(jpeg(segment(metadata({ ...composition, displayId: 1 }))))?.displayId,
    ).toBe(1);
    expect(first).toEqual(large);
  });

  test("ordinary JPEG and unrelated APP15 segments have no composition", () => {
    expect(extractJpegComposition(jpeg())).toBeUndefined();
    expect(extractJpegComposition(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(
      extractJpegComposition(jpeg(new Uint8Array([0xff, 0xef, 0, 5, 65, 66, 67]))),
    ).toBeUndefined();
    // APP15-looking entropy bytes after SOS are not JPEG header metadata.
    expect(
      extractJpegComposition(
        jpeg(new Uint8Array([0xff, 0xda, 0, 2]), segment(metadata(composition))),
      ),
    ).toBeUndefined();
  });

  test("rejects a JPEG truncated immediately after complete metadata segments", () => {
    const bytes = jpeg(segment(metadata(composition)));
    expect(extractJpegComposition(bytes.subarray(0, bytes.length - 2))).toBeUndefined();
  });

  test("rejects malformed, incomplete, duplicate, and out-of-order composition segments", () => {
    const bytes = metadata(composition);
    const half = Math.floor(bytes.length / 2);
    const first = segment(bytes.subarray(0, half), 0, 2);
    const last = segment(bytes.subarray(half), 1, 2);
    for (const invalid of [
      jpeg(first),
      jpeg(last, first),
      jpeg(first, first, last),
      jpeg(first, segment(bytes.subarray(half), 1, 3)),
      jpeg(segment(bytes, 0, 0)),
      jpeg(segment(new Uint8Array())),
      jpeg(segment(new TextEncoder().encode("invalid"))),
      jpeg(segment(metadata(null))),
      jpeg(segment(metadata({ mask: "M0 0Z" }))),
      jpeg(segment(bytes).subarray(0, 15)),
      jpeg(new Uint8Array([0xff, 0xef, 0, 1])),
      jpeg(new Uint8Array([0xff, 0xef, 0, 7, 83, 83, 67, 77, 49])),
    ]) {
      expect(extractJpegComposition(invalid)).toBeUndefined();
    }
  });
});
