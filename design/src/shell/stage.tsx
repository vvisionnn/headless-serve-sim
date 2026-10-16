import { AnimatePresence, motion } from "motion/react";
import { ImageDown, WifiOff } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DeviceFrame, deviceSize, screenPoints } from "../device/device-frame";
import { trailsGlow, wallpaperGlow } from "../device/screens/parts";
import { Button } from "../ui/button";
import { spring } from "../lib/motion";
import { sims, type DeviceKind } from "../lib/mock";
import { useApp } from "../lib/store";
import { DeviceDock } from "./device-dock";
import { LiveScreen, ScreenContent } from "./screen";

/** Largest scale each kind is drawn at — the rendered resolution. */
const MAX_SCALE: Record<DeviceKind, number> = { iphone: 0.31, ipad: 0.27, watch: 0.62 };
const DOCK_SPACE = 84;

export function useStageFit(kind: DeviceKind, rotated: boolean, inset = { top: 0, bottom: 0 }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1000, h: 800 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(([e]) => setBox({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const a = deviceSize(kind);
  const aw = rotated ? a.height : a.width;
  const ah = rotated ? a.width : a.height;
  const availH = box.h - inset.top - inset.bottom - DOCK_SPACE - 28;
  const fit = Math.max(0.05, Math.min(MAX_SCALE[kind], (box.w - 64) / aw, availH / ah));
  const cy = inset.top + 14 + availH / 2;
  return { ref, fit, cx: box.w / 2, cy, w: aw * fit, h: ah * fit, box };
}

export function glowFor(kind: DeviceKind, appOpen: boolean, dark: boolean) {
  if (kind === "watch") return appOpen ? ["#3fd0a0", "#ffd60a", "#1c1c1e", "#ff375f"] : ["#fa114f", "#a6ff00", "#00f0ff", "#ff9f0a"];
  return appOpen ? trailsGlow[dark ? "dark" : "light"] : wallpaperGlow;
}

/**
 * Screen light: the screen's colours spill softly onto the stage, as if the
 * device were lit from within. Shipped version samples the stream into an
 * 8×8 canvas; the preview uses the mock screen's palette.
 */
export function ScreenGlow({ colors, w, h }: { colors: string[]; w: number; h: number }) {
  const key = colors.join();
  return (
    <AnimatePresence>
      <motion.div
        key={key}
        aria-hidden
        className="pointer-events-none absolute"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 1.1, ease: [0.32, 0.72, 0, 1] }}
        style={{
          left: -w * 0.32,
          top: -h * 0.16,
          width: w * 1.64,
          height: h * 1.32,
          filter: `blur(${Math.max(48, w * 0.22)}px)`,
          mixBlendMode: "var(--glow-blend)" as never,
          opacity: "var(--glow-strength)" as never,
          background: [
            `radial-gradient(40% 32% at 32% 26%, ${colors[0]} 0%, transparent 100%)`,
            `radial-gradient(40% 34% at 70% 40%, ${colors[1]} 0%, transparent 100%)`,
            `radial-gradient(44% 34% at 62% 78%, ${colors[2]} 0%, transparent 100%)`,
            `radial-gradient(40% 30% at 30% 70%, ${colors[3]} 0%, transparent 100%)`,
          ].join(","),
        }}
      />
    </AnimatePresence>
  );
}

export function Stage({ insetBottom }: { insetBottom: number }) {
  const app = useApp();
  const { device: kind, orientation, simAppearance, appOpen, scene } = app;
  const rotated = orientation % 180 !== 0;
  const fit = useStageFit(kind, rotated, { top: 0, bottom: insetBottom });
  const a = deviceSize(kind);
  const base = MAX_SCALE[kind];
  const disconnected = scene === "disconnected";
  const sim = sims.find((s) => s.kind === kind)!;

  return (
    <div ref={fit.ref} className="absolute inset-0">
      {/* Device, centred; scale and position spring when the room changes shape. */}
      <motion.div
        className="absolute top-0 left-0"
        initial={false}
        animate={{ x: fit.cx, y: fit.cy }}
        transition={spring.surface}
      >
        <motion.div
          key={kind}
          layoutId={`device-${sim.udid}`}
          className="absolute"
          style={{ width: a.width * base, height: a.height * base, left: (-a.width * base) / 2, top: (-a.height * base) / 2 }}
          initial={{ opacity: 0, y: 40, filter: "blur(12px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)", scale: fit.fit / base, rotate: -orientation }}
          transition={{ ...spring.surface, rotate: spring.rotate, opacity: { duration: 0.4 } }}
        >
          <ScreenGlow colors={disconnected ? ["#777", "#999", "#666", "#888"] : glowFor(kind, appOpen, simAppearance === "dark")} w={a.width * base} h={a.height * base} />
          <div className="relative" style={{ filter: "var(--device-shadow)" }}>
            <DeviceFrame
              kind={kind}
              scale={base}
              onButton={(name) => {
                if (name === "power" || name === "side-button") app.set({ appOpen: false });
              }}
              screenOverlay={
                <>
                  <Shutter />
                  <AnimatePresence>{disconnected && <DisconnectedOverlay name={sim.name} />}</AnimatePresence>
                  <AnimatePresence>{app.dropping && <DropOverlay />}</AnimatePresence>
                </>
              }
            >
              <motion.div className="absolute inset-0" animate={{ filter: disconnected ? "grayscale(1) brightness(0.55)" : "grayscale(0) brightness(1)" }} transition={{ duration: 0.6 }}>
                <LiveScreen kind={kind} />
              </motion.div>
            </DeviceFrame>
          </div>
        </motion.div>
      </motion.div>

      {/* Contact shadow: the device rests on the stage rather than floating in it. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 rounded-[50%] bg-black/25 blur-[14px] dark:bg-black/70"
        initial={false}
        animate={{ x: fit.cx - fit.w * 0.36, y: fit.cy + fit.h / 2 - 12, width: fit.w * 0.72, height: 22 }}
        transition={spring.surface}
      />
      {/* Dock rides just under the device's lower edge. */}
      <motion.div className="absolute left-0 top-0 z-20" initial={false} animate={{ x: fit.cx, y: fit.cy + fit.h / 2 + 22 }} transition={spring.surface}>
        <div className="-translate-x-1/2">
          <DeviceDock />
        </div>
      </motion.div>

      <ScreenshotFlight />
    </div>
  );
}

function Shutter() {
  const { shutter } = useApp();
  return (
    <AnimatePresence>
      {shutter > 0 && (
        <motion.div
          key={shutter}
          className="pointer-events-none absolute inset-0 z-[80] bg-white"
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
    </AnimatePresence>
  );
}

/** macOS-style screenshot thumbnail: lifts off the screen and lands in the corner. */
function ScreenshotFlight() {
  const { shutter, device, simAppearance, appOpen, set, inspectorOpen } = useApp();
  const [flight, setFlight] = useState<{ id: number; from: DOMRect } | null>(null);
  useEffect(() => {
    if (!shutter) return;
    const el = document.querySelector("[data-screen]");
    if (!el) return;
    setFlight({ id: shutter, from: el.getBoundingClientRect() });
    const t = setTimeout(() => setFlight(null), 3600);
    return () => clearTimeout(t);
  }, [shutter]);
  const pts = screenPoints(device);
  const W = device === "ipad" ? 180 : device === "watch" ? 96 : 104;
  const H = (W / pts.width) * pts.height;
  // Land in the stage's corner, clear of the inspector.
  const right = inspectorOpen && window.innerWidth >= 1080 ? 328 + 20 : 0;
  return (
    <AnimatePresence>
      {flight && (
        <motion.button
          key={flight.id}
          type="button"
          onClick={() => set({ inspectorOpen: true, inspectorTab: "capture" })}
          className="fixed z-[70] overflow-hidden rounded-[12px] bg-black shadow-[0_0_0_0.5px_rgba(0,0,0,0.2),0_12px_32px_rgba(0,0,0,0.3)] ring-4 ring-white/90"
          style={{ left: 0, top: 0, width: W, height: H, transformOrigin: "0 0" }}
          initial={{ x: flight.from.left, y: flight.from.top, scale: flight.from.width / W, opacity: 1 }}
          animate={{ x: window.innerWidth - right - W - 24, y: window.innerHeight - H - 24, scale: 1, opacity: 1, transition: { ...spring.surface, delay: 0.18 } }}
          exit={{ x: window.innerWidth + 20, opacity: 0, transition: spring.ui }}
          whileHover={{ scale: 1.03 }}
          aria-label="Open screenshot in Capture"
        >
          <div className="pointer-events-none absolute top-0 left-0 origin-top-left" style={{ width: pts.width, height: pts.height, transform: `scale(${W / pts.width})` }}>
            <ScreenContent kind={device} dark={simAppearance === "dark"} appOpen={appOpen} onOpenApp={() => {}} />
          </div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function DisconnectedOverlay({ name }: { name: string }) {
  const { set } = useApp();
  return (
    <motion.div className="absolute inset-0 z-[75] flex items-center justify-center p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="glass-pop flex w-full max-w-[260px] flex-col items-center gap-3 rounded-[22px] px-5 pt-5 pb-4 text-center"
        initial={{ scale: 0.92, y: 10, opacity: 0, filter: "blur(6px)" }}
        animate={{ scale: 1, y: 0, opacity: 1, filter: "blur(0px)" }}
        transition={{ ...spring.ui, delay: 0.15 }}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-orange/14 text-orange">
          <WifiOff className="size-5" strokeWidth={2} />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-title3 text-label">{name} disconnected</span>
          <span className="text-footnote text-label-2">The view stays here and resumes as soon as it's back.</span>
        </div>
        <Button variant="secondary" size="md" block onClick={() => set({ navigatorOpen: true })}>
          Choose another simulator
        </Button>
        <span className="shimmer-text text-caption font-medium">Reconnecting…</span>
      </motion.div>
    </motion.div>
  );
}

function DropOverlay() {
  return (
    <motion.div
      className="absolute inset-0 z-[75] flex flex-col items-center justify-center gap-3 bg-black/45 text-white backdrop-blur-[6px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute inset-3 rounded-[inherit] border-2 border-dashed border-white/70"
        style={{ borderRadius: 28 }}
        initial={{ scale: 1.04, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring.ui}
      />
      <motion.span initial={{ y: 8, scale: 0.9 }} animate={{ y: [0, -4, 0], scale: 1 }} transition={{ y: { duration: 1.6, repeat: Infinity, ease: "easeInOut" }, scale: spring.ui }} className="flex size-14 items-center justify-center rounded-full bg-white/18 backdrop-blur">
        <ImageDown className="size-7" strokeWidth={1.75} />
      </motion.span>
      <span className="text-title3">Drop to add to Photos</span>
      <span className="text-footnote text-white/70">Images, videos, or an .ipa to install</span>
    </motion.div>
  );
}
