import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import type { DeviceKind } from "../lib/mock";
import { spring } from "../lib/motion";
import { controlRect, frameFor, hoverOffset, pointScale, restingOffset, sliceRects, type Control, type FrameSpec } from "./frames";

const bodies = new Map<DeviceKind, string>();

/** Composite the nine-slice body once (without buttons), like the shipped bezel. */
function useBody(kind: DeviceKind) {
  const [url, setUrl] = useState(() => bodies.get(kind) ?? null);
  useEffect(() => {
    const cached = bodies.get(kind);
    if (cached) return setUrl(cached);
    const spec = frameFor(kind);
    const canvas = document.createElement("canvas");
    canvas.width = spec.artwork.width;
    canvas.height = spec.artwork.height;
    const ctx = canvas.getContext("2d")!;
    let cancelled = false;
    void Promise.all(
      sliceRects(spec).map(
        ([asset, rect]) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height);
              resolve();
            };
            img.src = asset.pngDataUrl;
          }),
      ),
    ).then(() => {
      const next = canvas.toDataURL("image/png");
      bodies.set(kind, next);
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [kind]);
  return url;
}

export function deviceSize(kind: DeviceKind) {
  const a = frameFor(kind).artwork;
  return { width: a.width, height: a.height };
}

export function screenPoints(kind: DeviceKind) {
  const s = frameFor(kind).nativeScreen;
  return { width: s.width / pointScale[kind], height: s.height / pointScale[kind] };
}

function HardwareButton({ control, spec, scale, onPress }: { control: Control; spec: FrameSpec; scale: number; onPress?: (name: string) => void }) {
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const rest = controlRect(control, spec, restingOffset(control));
  const out = controlRect(control, spec, hoverOffset(control));
  // Pressing pushes the nub back past rest, into the case.
  const target = down ? { x: rest.x - (out.x - rest.x) * 0.6, y: rest.y - (out.y - rest.y) * 0.6 } : hover ? out : rest;
  return (
    <motion.img
      src={control.image.pngDataUrl}
      alt=""
      draggable={false}
      aria-label={control.name}
      role="button"
      className="absolute top-0 left-0 cursor-pointer select-none"
      style={{ width: rest.width * scale, height: rest.height * scale }}
      initial={false}
      animate={{ x: target.x * scale, y: target.y * scale }}
      transition={spring.snappy}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => {
        setHover(false);
        setDown(false);
      }}
      onPointerDown={() => setDown(true)}
      onPointerUp={() => {
        setDown(false);
        onPress?.(control.name);
      }}
    />
  );
}

/**
 * The device, drawn from Simulator.app's own artwork: buttons first, the body
 * over them, the screen composited on top and clipped to the profile's
 * per-corner radii. Buttons push out under the pointer and in when pressed.
 */
export function DeviceFrame({
  kind,
  scale,
  children,
  onButton,
  screenOverlay,
}: {
  kind: DeviceKind;
  scale: number;
  children: ReactNode;
  onButton?: (name: string) => void;
  screenOverlay?: ReactNode;
}) {
  const spec = frameFor(kind);
  const body = useBody(kind);
  const { artwork: a, insetsPx: inset, nativeScreen: ns, screenRadiiPx: r } = spec;
  const pts = screenPoints(kind);
  const screen = {
    left: (a.chromeRectPx.x + inset.left) * scale,
    top: (a.chromeRectPx.y + inset.top) * scale,
    width: ns.width * scale,
    height: ns.height * scale,
  };
  const k = screen.width / pts.width;
  return (
    <div className="relative" style={{ width: a.width * scale, height: a.height * scale }}>
      {a.controls
        .filter((c) => !c.onTop)
        .map((c) => (
          <HardwareButton key={c.name} control={c} spec={spec} scale={scale} onPress={onButton} />
        ))}
      {body && <img src={body} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full select-none" />}
      <div
        data-screen
        className="absolute overflow-hidden bg-black"
        style={{
          ...screen,
          borderRadius: `${r.topLeft * scale}px ${r.topRight * scale}px ${r.bottomRight * scale}px ${r.bottomLeft * scale}px`,
        }}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ width: pts.width, height: pts.height, transform: `scale(${k})` }}>
          {children}
          {spec.cutout === "dynamic-island" && (
            <div className="pointer-events-none absolute top-[11px] left-1/2 z-50 h-[37px] w-[124px] -translate-x-1/2 rounded-full bg-black" />
          )}
        </div>
        {screenOverlay}
      </div>
      {a.controls
        .filter((c) => c.onTop)
        .map((c) => (
          <HardwareButton key={c.name} control={c} spec={spec} scale={scale} onPress={onButton} />
        ))}
    </div>
  );
}
