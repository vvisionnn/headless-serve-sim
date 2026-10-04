import type { SimulatorComposition } from "./types.js";

type Point = { x: number; y: number };
type Projection = { quad: number[][]; region: number[] };

function projectionCoefficients(piece: Projection) {
  const [a, b, c, d] = piece.quad;
  if (!a || !b || !c || !d) return null;
  const dx1 = b[0]! - c[0]!,
    dx2 = d[0]! - c[0]!,
    dx3 = a[0]! - b[0]! + c[0]! - d[0]!;
  const dy1 = b[1]! - c[1]!,
    dy2 = d[1]! - c[1]!,
    dy3 = a[1]! - b[1]! + c[1]! - d[1]!;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-10) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / det,
    h = (dx1 * dy3 - dx3 * dy1) / det;
  return {
    x: a[0]!,
    y: a[1]!,
    g,
    h,
    m00: b[0]! - a[0]! + g * b[0]!,
    m01: d[0]! - a[0]! + h * d[0]!,
    m10: b[1]! - a[1]! + g * b[1]!,
    m11: d[1]! - a[1]! + h * d[1]!,
  };
}

export function rawPointForProjection(point: Point, piece: Projection): Point | null {
  const m = projectionCoefficients(piece);
  if (!m) return null;
  const aa = m.m00 - point.x * m.g,
    bb = m.m01 - point.x * m.h;
  const cc = m.m10 - point.y * m.g,
    dd = m.m11 - point.y * m.h;
  const denominator = aa * dd - bb * cc;
  if (Math.abs(denominator) < 1e-10) return null;
  const x = point.x - m.x,
    y = point.y - m.y;
  const u = (x * dd - bb * y) / denominator,
    v = (aa * y - x * cc) / denominator;
  if (u < -0.001 || u > 1.001 || v < -0.001 || v > 1.001) return null;
  return { x: piece.region[0]! + u * piece.region[2]!, y: piece.region[1]! + v * piece.region[3]! };
}

export function projectedPoint(point: Point, piece: Projection): Point | null {
  const [x, y, width, height] = piece.region;
  const u = (point.x - x!) / width!,
    v = (point.y - y!) / height!;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const m = projectionCoefficients(piece);
  if (!m) return null;
  const denominator = m.g * u + m.h * v + 1;
  if (Math.abs(denominator) < 1e-10) return null;
  return {
    x: (m.m00 * u + m.m01 * v + m.x) / denominator,
    y: (m.m10 * u + m.m11 * v + m.y) / denominator,
  };
}

/** Composition points already have native raw orientation baked into their projection. */
export function homeEdgeForRawPoint(point: Point, rotation: number): number | undefined {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return point.x >= 0.93 ? 4 : undefined;
    case 180:
      return point.y <= 0.07 ? 1 : undefined;
    case 270:
      return point.x <= 0.07 ? 2 : undefined;
    default:
      return point.y >= 0.93 ? 3 : undefined;
  }
}

export function rawPointForComposition(
  point: Point,
  composition: SimulatorComposition,
  displayId = composition.displayId,
): (Point & { displayId: number }) | null {
  for (const piece of composition.pieces) {
    if (piece.displayId !== displayId) continue;
    const raw = rawPointForProjection(point, piece);
    if (raw) return { ...raw, displayId };
  }
  return null;
}
