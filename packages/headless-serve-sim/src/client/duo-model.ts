export function duoRawPointForProjection(
  point: { x: number; y: number },
  piece: { quad: number[][]; region: number[] },
): { x: number; y: number } | null {
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
  const m00 = b[0]! - a[0]! + g * b[0]!,
    m01 = d[0]! - a[0]! + h * d[0]!;
  const m10 = b[1]! - a[1]! + g * b[1]!,
    m11 = d[1]! - a[1]! + h * d[1]!;
  const aa = m00 - point.x * g,
    bb = m01 - point.x * h;
  const cc = m10 - point.y * g,
    dd = m11 - point.y * h;
  const denominator = aa * dd - bb * cc;
  if (Math.abs(denominator) < 1e-10) return null;
  const x = point.x - a[0]!,
    y = point.y - a[1]!;
  const u = (x * dd - bb * y) / denominator,
    v = (aa * y - x * cc) / denominator;
  if (u < -0.001 || u > 1.001 || v < -0.001 || v > 1.001) return null;
  return { x: piece.region[0]! + u * piece.region[2]!, y: piece.region[1]! + v * piece.region[3]! };
}

export function duoProjectedPoint(
  point: { x: number; y: number },
  piece: { quad: number[][]; region: number[] },
): { x: number; y: number } | null {
  const [x, y, width, height] = piece.region;
  const u = (point.x - x!) / width!,
    v = (point.y - y!) / height!;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const [a, b, c, d] = piece.quad;
  if (!a || !b || !c || !d) return null;
  const dx1 = b[0]! - c[0]!,
    dx2 = d[0]! - c[0]!;
  const dy1 = b[1]! - c[1]!,
    dy2 = d[1]! - c[1]!;
  const dx3 = a[0]! - b[0]! + c[0]! - d[0]!;
  const dy3 = a[1]! - b[1]! + c[1]! - d[1]!;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-10) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / det,
    h = (dx1 * dy3 - dx3 * dy1) / det;
  const denominator = g * u + h * v + 1;
  if (Math.abs(denominator) < 1e-10) return null;
  return {
    x: ((b[0]! - a[0]! + g * b[0]!) * u + (d[0]! - a[0]! + h * d[0]!) * v + a[0]!) / denominator,
    y: ((b[1]! - a[1]! + g * b[1]!) * u + (d[1]! - a[1]! + h * d[1]!) * v + a[1]!) / denominator,
  };
}

export function duoAxPolygons(
  frame: { x: number; y: number; width: number; height: number },
  metadata: {
    displayId: number;
    rawWidth: number;
    rawHeight: number;
    rawRotation: number;
    pieces: { displayId: number; quad: number[][]; region: number[] }[];
  },
): { x: number; y: number }[][] {
  const quarterTurn = metadata.rawRotation === 90 || metadata.rawRotation === 270;
  const width = (quarterTurn ? metadata.rawHeight : metadata.rawWidth) / 3;
  const height = (quarterTurn ? metadata.rawWidth : metadata.rawHeight) / 3;
  const corners = [
    [frame.x, frame.y],
    [frame.x + frame.width, frame.y],
    [frame.x + frame.width, frame.y + frame.height],
    [frame.x, frame.y + frame.height],
  ].map(([x, y]) =>
    duoTouchCoordinates({ x: x! / width, y: 1 - y! / height }, metadata.rawRotation),
  );
  const left = Math.min(...corners.map((p) => p.x)),
    right = Math.max(...corners.map((p) => p.x));
  const top = Math.min(...corners.map((p) => p.y)),
    bottom = Math.max(...corners.map((p) => p.y));
  const polygons: { x: number; y: number }[][] = [];
  for (const piece of metadata.pieces) {
    if (piece.displayId !== metadata.displayId) continue;
    const [x, y, w, h] = piece.region;
    const l = Math.max(left, x!),
      r = Math.min(right, x! + w!);
    const t = Math.max(top, y!),
      b = Math.min(bottom, y! + h!);
    if (r <= l || b <= t) continue;
    const points = corners.map((point) =>
      duoProjectedPoint(
        {
          x: Math.max(l, Math.min(r, point.x)),
          y: Math.max(t, Math.min(b, point.y)),
        },
        piece,
      ),
    );
    if (points.every((point) => point !== null))
      polygons.push(points as { x: number; y: number }[]);
  }
  return polygons;
}

export function duoHomeEdge(point: { x: number; y: number }, rotation: number): number | undefined {
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

export function duoWheelDelta(
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  height: number,
): { dx: number; dy: number } {
  return { dx: (from.x - to.x) * width, dy: (from.y - to.y) * height };
}

export function duoUvForRawPoint(point: { x: number; y: number }, rotation: number) {
  let x = point.x;
  let y = point.y;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      [x, y] = [1 - y, x];
      break;
    case 180:
      [x, y] = [1 - x, 1 - y];
      break;
    case 270:
      [x, y] = [y, 1 - x];
      break;
  }
  return { x, y: 1 - y };
}

export function duoTouchCoordinates(
  uv: { x: number; y: number },
  textureRotation = 0,
): { x: number; y: number } {
  const x = Math.max(0, Math.min(1, uv.x));
  const y = Math.max(0, Math.min(1, 1 - uv.y));
  switch (((textureRotation % 360) + 360) % 360) {
    case 90:
      return { x: y, y: 1 - x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: 1 - y, y: x };
    default:
      return { x, y };
  }
}
