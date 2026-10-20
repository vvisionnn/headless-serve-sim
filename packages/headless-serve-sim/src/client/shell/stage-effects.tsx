import { animate, AnimatePresence, motion, useMotionTemplate, useMotionValue } from "motion/react";
import { ImageDown } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { spring } from "../lib/motion";
import {
  luminanceGrid,
  revealShouldStart,
  SCREEN_SAMPLE_SIZE,
  screenChanged,
} from "../utils/screen-change";
import { unturnedSize, type StagePose } from "../utils/stage-pose";

const NEUTRAL_GLOW = ["#8a8a8e", "#a1a1a6", "#7c7c80", "#98989d"];

/**
 * Four quadrant colours (TL, TR, BR, BL) from a 2×2 RGBA sample — the order
 * the glow's radial stops expect. Lifts very dark samples toward grey so a
 * black screen still reads as a lit object instead of a hole.
 */
export function glowColors(data: ArrayLike<number>): string[] {
  const at = (i: number) => {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    const lift = Math.max(0, 48 - Math.max(r, g, b));
    return `rgb(${r + lift}, ${g + lift}, ${b + lift})`;
  };
  // Canvas order is row-major: 0 TL, 1 TR, 2 BL, 3 BR.
  return [at(0), at(1), at(3), at(2)];
}

/**
 * The largest painted surface at or under `root` — the canvas or image the stream
 * is actually drawn into. The Duo keeps a 1px hidden decoder beside the
 * canvas it shows, so "first match" would pick the wrong one.
 */
export function largestSurface(
  root: HTMLElement | null,
): HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | null {
  let best: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | null = null;
  let area = 0;
  const surfaces = [
    ...(root?.matches("canvas, video, img") ? [root] : []),
    ...(root?.querySelectorAll("canvas, video, img") ?? []),
  ] as (HTMLCanvasElement | HTMLImageElement | HTMLVideoElement)[];
  for (const el of surfaces) {
    const a = el.clientWidth * el.clientHeight;
    if (a > area) {
      area = a;
      best = el;
    }
  }
  return best;
}

/** Degrees a computed CSS `transform` turns its element by. */
export function screenCaptureAngle(transform: string): number {
  const m = /^matrix\(([^,]+),\s*([^,]+)/.exec(transform);
  if (!m) return 0;
  return (Math.atan2(Number(m[2]), Number(m[1])) * 180) / Math.PI;
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Which part of an `iw`×`ih` picture shows, and where in its `w`×`h` box, under
 * the box's `object-fit` — so a capture holds what was drawn, not a stretch.
 */
export function fittedRegion(
  fit: string,
  w: number,
  h: number,
  iw: number,
  ih: number,
): { source: Region; box: Region } {
  const whole = { x: 0, y: 0, width: iw, height: ih };
  if (fit === "contain") {
    const s = Math.min(w / iw, h / ih);
    const bw = iw * s;
    const bh = ih * s;
    return { source: whole, box: { x: (w - bw) / 2, y: (h - bh) / 2, width: bw, height: bh } };
  }
  const box = { x: 0, y: 0, width: w, height: h };
  if (fit === "cover") {
    const s = Math.max(w / iw, h / ih);
    const sw = w / s;
    const sh = h / s;
    return { source: { x: (iw - sw) / 2, y: (ih - sh) / 2, width: sw, height: sh }, box };
  }
  return { source: whole, box };
}

/**
 * Freeze what's on screen right now into a canvas. At its on-screen size by
 * default; `max` instead keeps the picture's own resolution, down to that
 * many device pixels, for a frame that will be shown larger than it is now.
 * A stream the view turns with CSS (a portrait frame shown sideways) is
 * captured turned, as it looks.
 */
export function snapshotCanvas(
  root: HTMLElement | null,
  max?: { width: number; height: number },
): { canvas: HTMLCanvasElement; rect: DOMRect } | null {
  const source = largestSurface(root);
  if (!source) return null;
  const rect = source.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  try {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const style = getComputedStyle(source);
    const angle = screenCaptureAngle(style.transform);
    const sideways = Math.abs(Math.abs(angle) - 90) < 1;
    // Layout sizes: an ancestor may itself be scaled or turning.
    const width = source.offsetWidth || rect.width;
    const height = source.offsetHeight || rect.height;
    const [iw, ih] =
      source instanceof HTMLImageElement
        ? [source.naturalWidth, source.naturalHeight]
        : source instanceof HTMLVideoElement
          ? [source.videoWidth, source.videoHeight]
          : [source.width, source.height];
    if (!iw || !ih) return null;
    const { source: from, box } = fittedRegion(style.objectFit, width, height, iw, ih);
    // Unturned output size: the picture's pixels, or its box's on screen.
    let ow = max ? from.width : box.width * ratio;
    let oh = max ? from.height : box.height * ratio;
    if (max) {
      const fit = Math.min(
        1,
        ((sideways ? max.height : max.width) * ratio) / ow,
        ((sideways ? max.width : max.height) * ratio) / oh,
      );
      ow *= fit;
      oh *= fit;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sideways ? oh : ow));
    canvas.height = Math.max(1, Math.round(sideways ? ow : oh));
    const context = canvas.getContext("2d");
    context?.translate(canvas.width / 2, canvas.height / 2);
    context?.rotate((angle * Math.PI) / 180);
    context?.drawImage(source, from.x, from.y, from.width, from.height, -ow / 2, -oh / 2, ow, oh);
    return { canvas, rect };
  } catch {
    // A tainted or not-yet-decoded surface: the caller falls back.
    return null;
  }
}

/**
 * Freeze what's on screen right now, at its on-screen size. Used where a
 * motion must start at once — the screenshot thumbnail lifts off before
 * simctl has written the PNG, the appearance reveal needs the old frame, and
 * a turn holds it while iOS redraws.
 */
export function snapshotScreen(root: HTMLElement | null): { url: string; rect: DOMRect } | null {
  const snap = snapshotCanvas(root);
  if (!snap) return null;
  try {
    return { url: snap.canvas.toDataURL("image/png"), rect: snap.rect };
  } catch {
    return null;
  }
}

/**
 * Sample the live stream's pixels into a 2×2 canvas about once a second. The
 * surface is whatever SimulatorView paints into (a canvas for H.264, an img
 * for MJPEG); a tainted cross-origin frame simply keeps the last colours.
 */
export function useScreenColors(screen: RefObject<HTMLElement | null>, enabled: boolean) {
  const [colors, setColors] = useState<string[]>(NEUTRAL_GLOW);
  useEffect(() => {
    if (!enabled) {
      setColors(NEUTRAL_GLOW);
      return;
    }
    const probe = document.createElement("canvas");
    probe.width = 2;
    probe.height = 2;
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let last = "";
    const tick = () => {
      const source = largestSurface(screen.current);
      if (!source) return;
      try {
        ctx.drawImage(source, 0, 0, 2, 2);
        const next = glowColors(ctx.getImageData(0, 0, 2, 2).data);
        const key = next.join();
        if (key !== last) {
          last = key;
          setColors(next);
        }
      } catch {}
    };
    tick();
    const t = setInterval(tick, 1200);
    return () => clearInterval(t);
  }, [screen, enabled]);
  return colors;
}

/**
 * The glow's frame: the device held upright, turned with it. Sized from the
 * upright device, so a turn's start transform lands it exactly on the glow
 * before the turn and it swings with the device instead of reshaping.
 */
export function screenGlowFrame(pose: Pick<StagePose, "rotation" | "width" | "height">) {
  const { width, height } = unturnedSize(pose);
  return { width, height, rotate: pose.rotation, blur: Math.max(48, width * 0.22) };
}

/**
 * Screen light: the screen's colours spill softly onto the stage, as if the
 * device were lit from within. Fills the visible device box it sits in.
 */
export function ScreenGlow({
  colors,
  pose,
}: {
  colors: string[];
  pose: Pick<StagePose, "rotation" | "width" | "height">;
}) {
  const { width: w, height: h, rotate, blur } = screenGlowFrame(pose);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: (pose.width - w) / 2,
        top: (pose.height - h) / 2,
        width: w,
        height: h,
        transform: `rotate(${rotate}deg)`,
      }}
    >
      <motion.div
        className="absolute"
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          background: [
            `radial-gradient(40% 32% at 32% 26%, ${colors[0]} 0%, transparent 100%)`,
            `radial-gradient(40% 34% at 70% 40%, ${colors[1]} 0%, transparent 100%)`,
            `radial-gradient(44% 34% at 62% 78%, ${colors[2]} 0%, transparent 100%)`,
            `radial-gradient(40% 30% at 30% 70%, ${colors[3]} 0%, transparent 100%)`,
          ].join(","),
        }}
        transition={{ duration: 1.1, ease: [0.32, 0.72, 0, 1] }}
        style={{
          left: -w * 0.32,
          top: -h * 0.16,
          width: w * 1.64,
          height: h * 1.32,
          filter: `blur(${blur}px)`,
          mixBlendMode: "var(--glow-blend)" as never,
          opacity: "var(--glow-strength)" as never,
        }}
      />
    </div>
  );
}

/** Reads the stream into a small luminance grid, or null if it can't be read. */
function screenSampler(source: CanvasImageSource | null): () => Float32Array | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SCREEN_SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return () => {
    if (!source || !ctx) return null;
    try {
      ctx.drawImage(source, 0, 0, SCREEN_SAMPLE_SIZE, SCREEN_SAMPLE_SIZE);
      return luminanceGrid(ctx.getImageData(0, 0, SCREEN_SAMPLE_SIZE, SCREEN_SAMPLE_SIZE).data);
    } catch {
      return null;
    }
  };
}

/**
 * Appearance change: the old frame stays on top and a circle opens in it from
 * the bottom edge — where the appearance control sits — revealing the new
 * appearance underneath. It opens on the first stream frame that shows the
 * repaint (sampled every frame), so the circle starts from closed rather than
 * half-open, with a fallback if the change is never seen.
 */
export function AppearanceReveal({
  url,
  source,
  onDone,
}: {
  url: string;
  /** The live stream surface, watched for the repaint. */
  source: CanvasImageSource | null;
  onDone: () => void;
}) {
  const radius = useMotionValue(0);
  const mask = useMotionTemplate`radial-gradient(circle at 50% 100%, transparent ${radius}px, #000 calc(${radius}px + 1px))`;
  useEffect(() => {
    let stop = () => {};
    let frame = 0;
    const began = performance.now();
    const sample = screenSampler(source);
    const base = sample();
    const open = () => {
      const el = document.querySelector("[data-appearance-reveal]");
      const r = el?.getBoundingClientRect();
      const end = r ? Math.hypot(r.width / 2, r.height) : 2000;
      const anim = animate(radius, end, {
        duration: 0.7,
        ease: [0.32, 0.72, 0, 1],
        onComplete: onDone,
      });
      stop = () => anim.stop();
    };
    const watch = () => {
      const next = base ? sample() : null;
      const changed = Boolean(base && next && screenChanged(base, next));
      if (revealShouldStart({ changed, elapsedMs: performance.now() - began })) open();
      else frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => {
      cancelAnimationFrame(frame);
      stop();
    };
  }, [radius, source, onDone]);
  return (
    <motion.img
      data-appearance-reveal
      src={url}
      alt=""
      aria-hidden
      draggable={false}
      className="pointer-events-none absolute inset-0 z-[78] size-full select-none"
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    />
  );
}

/** The white flash over the screen when a screenshot is taken. */
export function Shutter({ count }: { count: number }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          key={count}
          className="pointer-events-none absolute inset-0 z-[80] bg-white"
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
    </AnimatePresence>
  );
}

export interface Flight {
  id: number;
  from: DOMRect;
  url: string;
}

/** macOS-style screenshot thumbnail: lifts off the screen and lands in the corner. */
export function ScreenshotFlight({
  flight,
  right,
  onOpen,
  onDone,
}: {
  flight: Flight | null;
  /** Clearance from the window's right edge (an open inspector). */
  right: number;
  onOpen: () => void;
  onDone: () => void;
}) {
  useEffect(() => {
    if (!flight) return;
    const t = setTimeout(onDone, 3600);
    return () => clearTimeout(t);
  }, [flight, onDone]);
  const landscape = flight ? flight.from.width > flight.from.height : false;
  const W = landscape ? 180 : 104;
  const H = flight ? (W / flight.from.width) * flight.from.height : 0;
  return (
    <AnimatePresence>
      {flight && (
        <motion.button
          key={flight.id}
          type="button"
          onClick={() => {
            onOpen();
            onDone();
          }}
          className="fixed z-[70] overflow-hidden rounded-[12px] bg-black shadow-[0_0_0_0.5px_rgba(0,0,0,0.2),0_12px_32px_rgba(0,0,0,0.3)] ring-4 ring-white/90"
          style={{ left: 0, top: 0, width: W, height: H, transformOrigin: "0 0" }}
          initial={{
            x: flight.from.left,
            y: flight.from.top,
            scale: flight.from.width / W,
            opacity: 1,
          }}
          animate={{
            x: window.innerWidth - right - W - 24,
            y: window.innerHeight - H - 24,
            scale: 1,
            opacity: 1,
            transition: { ...spring.surface, delay: 0.18 },
          }}
          exit={{ x: window.innerWidth + 20, opacity: 0, transition: spring.ui }}
          whileHover={{ scale: 1.03 }}
          aria-label="Open screenshot in Capture"
        >
          <img
            src={flight.url}
            alt=""
            draggable={false}
            className="pointer-events-none size-full object-cover"
          />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export function DropOverlay() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-[75] flex flex-col items-center justify-center gap-3 bg-black/45 text-white backdrop-blur-[6px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute inset-3 border-2 border-dashed border-white/70"
        style={{ borderRadius: 28 }}
        initial={{ scale: 1.04, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring.ui}
      />
      <motion.span
        initial={{ y: 8, scale: 0.9 }}
        animate={{ y: [0, -4, 0], scale: 1 }}
        transition={{ y: { duration: 1.6, repeat: Infinity, ease: "easeInOut" }, scale: spring.ui }}
        className="flex size-14 items-center justify-center rounded-full bg-white/18 backdrop-blur"
      >
        <ImageDown className="size-7" strokeWidth={1.75} />
      </motion.span>
      <span className="text-title3">Drop to add to Photos</span>
      <span className="text-footnote text-white/80">Images, videos, or an .ipa to install</span>
    </motion.div>
  );
}
