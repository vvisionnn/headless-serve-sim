import { projectedPoint as duoProjectedPoint } from "headless-serve-sim-client/composition-mapping";
export {
  projectedPoint as duoProjectedPoint,
  rawPointForProjection as duoRawPointForProjection,
  homeEdgeForRawPoint as duoHomeEdge,
} from "headless-serve-sim-client/composition-mapping";

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
