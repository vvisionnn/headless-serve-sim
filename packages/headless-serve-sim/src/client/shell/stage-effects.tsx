import { AnimatePresence, motion } from "motion/react";
import { ImageDown } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { spring } from "../lib/motion";

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
      // The largest painted surface — the Duo keeps a 1px hidden decoder
      // beside the canvas it actually shows.
      let source: CanvasImageSource | null = null;
      let best = 0;
      for (const el of screen.current?.querySelectorAll<HTMLElement>("canvas, video, img") ?? []) {
        const area = el.clientWidth * el.clientHeight;
        if (area > best) {
          best = area;
          source = el as unknown as CanvasImageSource;
        }
      }
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
 * Screen light: the screen's colours spill softly onto the stage, as if the
 * device were lit from within.
 */
export function ScreenGlow({ colors, w, h }: { colors: string[]; w: number; h: number }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute"
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
        filter: `blur(${Math.max(48, w * 0.22)}px)`,
        mixBlendMode: "var(--glow-blend)" as never,
        opacity: "var(--glow-strength)" as never,
      }}
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
