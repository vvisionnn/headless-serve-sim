import { describe, expect, test } from "bun:test";
import {
  analyzeRgbFrames,
  avccDescriptionToAnnexB,
  avccFrameToAnnexB,
  extractJpegFrames,
  type Rgb,
} from "../../scripts/stream-quality-benchmark";

const palette: Rgb[] = [
  [230, 45, 60],
  [35, 155, 85],
  [40, 95, 220],
  [240, 190, 35],
];

function scanBandFrame(width: number, rows: Rgb[]): Uint8Array {
  const frame = new Uint8Array(width * rows.length * 3);
  for (let y = 0; y < rows.length; y++) {
    const color = rows[y]!;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      frame.set(color, offset);
    }
  }
  return frame;
}

describe("stream quality benchmark", () => {
  test("accepts coherent frames and rejects a frame made from two source generations", () => {
    const width = 4;
    const coherent = scanBandFrame(width, Array<Rgb>(16).fill(palette[0]!));
    const torn = scanBandFrame(width, [
      ...Array<Rgb>(8).fill(palette[0]!),
      ...Array<Rgb>(8).fill(palette[2]!),
    ]);

    const report = analyzeRgbFrames(new Uint8Array([...coherent, ...torn]), {
      width,
      height: 16,
      palette,
    });

    expect(report.totalFrames).toBe(2);
    expect(report.tornFrames).toBe(1);
    expect(report.invalidFrames).toBe(0);
    expect(report.frames[0]?.status).toBe("coherent");
    expect(report.frames[1]?.status).toBe("torn");
  });

  test("converts the public AVCC envelopes into a decodable Annex-B recording", () => {
    const description = new Uint8Array([
      1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 2, 0x67, 0x64, 1, 0, 2, 0x68, 0xee,
    ]);
    const frame = new Uint8Array([0, 0, 0, 2, 0x65, 0x88, 0, 0, 0, 1, 0x41]);

    expect([...avccDescriptionToAnnexB(description).data]).toEqual([
      0, 0, 0, 1, 0x67, 0x64, 0, 0, 0, 1, 0x68, 0xee,
    ]);
    expect([...avccFrameToAnnexB(frame, 4)]).toEqual([0, 0, 0, 1, 0x65, 0x88, 0, 0, 0, 1, 0x41]);
  });

  test("extracts complete MJPEG images and preserves a split trailing image", () => {
    const result = extractJpegFrames(
      new Uint8Array([9, 9, 0xff, 0xd8, 1, 2, 0xff, 0xd9, 0xff, 0xd8, 3]),
    );

    expect(result.frames.map((frame) => [...frame])).toEqual([[0xff, 0xd8, 1, 2, 0xff, 0xd9]]);
    expect([...result.remaining]).toEqual([0xff, 0xd8, 3]);
  });
});
