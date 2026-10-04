import type { SimulatorComposition } from "./types.js";

const MAGIC = new TextEncoder().encode("SSCM1");

/** Reads composition carried by this JPEG, never by a separate config update. */
export function extractJpegComposition(jpeg: Uint8Array): SimulatorComposition | undefined {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return undefined;
  const chunks: Uint8Array[] = [];
  let count = 0;
  let total = 0;
  let offset = 2;
  let headerEnded = false;
  while (offset < jpeg.length) {
    if (jpeg[offset++] !== 0xff) return undefined;
    while (jpeg[offset] === 0xff) offset++;
    const marker = jpeg[offset++];
    if (marker === 0xda || marker === 0xd9) {
      headerEnded = true;
      break;
    }
    if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > jpeg.length) return undefined;
    const length = (jpeg[offset]! << 8) | jpeg[offset + 1]!;
    if (length < 2 || offset + length > jpeg.length) return undefined;
    const start = offset + 2;
    const end = offset + length;
    if (marker === 0xef && MAGIC.every((byte, index) => jpeg[start + index] === byte)) {
      if (length <= 11) return undefined;
      const index = (jpeg[start + 5]! << 8) | jpeg[start + 6]!;
      const segmentCount = (jpeg[start + 7]! << 8) | jpeg[start + 8]!;
      if (index !== chunks.length || segmentCount === 0 || (count !== 0 && count !== segmentCount))
        return undefined;
      count = segmentCount;
      if (chunks.length >= count) return undefined;
      const chunk = jpeg.subarray(start + 9, end);
      chunks.push(chunk);
      total += chunk.length;
    }
    offset = end;
  }
  if (!headerEnded || count === 0 || chunks.length !== count) return undefined;
  const metadata = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    metadata.set(chunk, position);
    position += chunk.length;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(metadata));
    return isComposition(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function numbers(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function isComposition(value: unknown): value is SimulatorComposition {
  if (!value || typeof value !== "object") return false;
  const composition = value as SimulatorComposition;
  return (
    [
      composition.angle,
      composition.rotation,
      composition.scale,
      composition.displayId,
      composition.rawWidth,
      composition.rawHeight,
      composition.rawRotation,
    ].every((item) => typeof item === "number" && Number.isFinite(item)) &&
    typeof composition.mask === "string" &&
    numbers(composition.bounds, 4) &&
    Array.isArray(composition.pieces) &&
    composition.pieces.every(
      (piece) =>
        piece &&
        typeof piece.displayId === "number" &&
        Number.isFinite(piece.displayId) &&
        numbers(piece.region, 4) &&
        Array.isArray(piece.quad) &&
        piece.quad.length === 4 &&
        piece.quad.every((point) => numbers(point, 2)),
    )
  );
}
