import type { ReactNode } from "react";
import { controlRect, restingOffset, sliceRects, type FrameSpec } from "../../../src/device/frames";

export type Kind = "iphone" | "air" | "ipad" | "watch";

declare global {
  interface Window {
    PROMO_FRAMES: Record<Kind, FrameSpec>;
  }
}

export const spec = (kind: Kind) => window.PROMO_FRAMES[kind];
export const artwork = (kind: Kind) => ({
  w: spec(kind).artwork.width,
  h: spec(kind).artwork.height,
});

const bodies = new Map<Kind, string>();

/** Composite each nine-slice body once, the way the shipped bezel does. */
export async function loadBodies() {
  await Promise.all(
    (Object.keys(window.PROMO_FRAMES) as Kind[]).map(async (kind) => {
      const s = spec(kind);
      const canvas = document.createElement("canvas");
      canvas.width = s.artwork.width;
      canvas.height = s.artwork.height;
      const ctx = canvas.getContext("2d")!;
      await Promise.all(
        sliceRects(s).map(async ([asset, rect]) => {
          const img = new Image();
          img.src = asset.pngDataUrl;
          await img.decode();
          ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height);
        }),
      );
      bodies.set(kind, canvas.toDataURL("image/png"));
    }),
  );
}

/**
 * The device, drawn from Simulator.app's own artwork at `scale`: buttons, the
 * body, and the screen clipped to the profile's corner radii. `children` are
 * laid out in the screen's native pixels.
 */
export function RealDevice({
  kind,
  scale,
  children,
}: {
  kind: Kind;
  scale: number;
  children: ReactNode;
}) {
  const s = spec(kind);
  const { artwork: a, insetsPx: inset, nativeScreen: ns, screenRadiiPx: r } = s;
  const button = (onTop: boolean) =>
    a.controls
      .filter((c) => c.onTop === onTop)
      .map((c) => {
        const rect = controlRect(c, s, restingOffset(c));
        return (
          <img
            key={c.name}
            src={c.image.pngDataUrl}
            alt=""
            className="absolute top-0 left-0"
            style={{
              width: rect.width * scale,
              height: rect.height * scale,
              transform: `translate(${rect.x * scale}px, ${rect.y * scale}px)`,
            }}
          />
        );
      });
  return (
    <div className="relative" style={{ width: a.width * scale, height: a.height * scale }}>
      {button(false)}
      <img src={bodies.get(kind)} alt="" className="absolute inset-0 size-full" />
      <div
        className="absolute overflow-hidden bg-black"
        style={{
          left: (a.chromeRectPx.x + inset.left) * scale,
          top: (a.chromeRectPx.y + inset.top) * scale,
          width: ns.width * scale,
          height: ns.height * scale,
          borderRadius: `${r.topLeft * scale}px ${r.topRight * scale}px ${r.bottomRight * scale}px ${r.bottomLeft * scale}px`,
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: ns.width, height: ns.height, transform: `scale(${scale})` }}
        >
          {children}
          {/* Screenshots leave the Dynamic Island out unless it is animating;
              the hardware is always there. Measured from the captured AX tree. */}
          {s.cutout === "dynamic-island" && (
            <div className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black" style={{ top: 42, width: 376, height: 110 }} />
          )}
        </div>
      </div>
      {button(true)}
    </div>
  );
}
