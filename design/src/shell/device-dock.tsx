import { animate, AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { Accessibility, Camera, House, Keyboard, Moon, RotateCcw, RotateCw, Sun } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { Shortcut } from "../ui/kbd";

const BASE = 36;
const MAG = 46;
const REACH = 110;

/**
 * The device's own controls, floating just under it (after ReactBits Dock):
 * icons swell toward the pointer like the macOS Dock, labels rise above.
 * Placing them under the device maps each control to what it acts on.
 */
export function DeviceDock() {
  const app = useApp();
  const mouseX = useMotionValue(Infinity);
  const watch = app.device === "watch";
  return (
    <motion.div
      onMouseMove={(e) => mouseX.set(e.clientX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className="glass flex h-[50px] items-end gap-1 rounded-[25px] px-[7px] pb-[7px]"
      initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ ...spring.surface, delay: 0.25 }}
    >
      <DockItem mouseX={mouseX} label="Home" keys={["⇧", "⌘", "H"]} onClick={() => app.set({ appOpen: false })}>
        <House />
      </DockItem>
      <DockItem
        mouseX={mouseX}
        label="Rotate"
        disabled={watch}
        onClick={() => app.set((s) => ({ orientation: ((s.orientation + 90) % 360) as 0 | 90 | 180 | 270 }))}
      >
        <RotateCcw />
      </DockItem>
      <DockItem
        mouseX={mouseX}
        label={app.simAppearance === "dark" ? "Light appearance" : "Dark appearance"}
        keys={["⇧", "⌘", "A"]}
        onClick={() => app.set((s) => ({ simAppearance: s.simAppearance === "dark" ? "light" : "dark" }))}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={app.simAppearance}
            className="flex"
            initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
            transition={spring.ui}
          >
            {app.simAppearance === "dark" ? <Moon /> : <Sun />}
          </motion.span>
        </AnimatePresence>
      </DockItem>
      <Divider />
      <DockItem mouseX={mouseX} label="Screenshot" keys={["⌘", "S"]} onClick={app.screenshot}>
        <Camera />
      </DockItem>
      <RecordItem mouseX={mouseX} />
      <Divider />
      <DockItem mouseX={mouseX} label="Accessibility overlay" active={app.axOverlay} onClick={() => app.set((s) => ({ axOverlay: !s.axOverlay, appOpen: true }))}>
        <Accessibility />
      </DockItem>
      <DockItem mouseX={mouseX} label="Software keyboard" keys={["⌘", "K"]} disabled={watch}>
        <Keyboard />
      </DockItem>
      {app.appOpen && !watch && (
        <>
          <Divider />
          <DockItem mouseX={mouseX} label="Reload JS bundle" keys={["R"]} onClick={() => app.toast({ title: "Reloaded Trails", detail: "Metro · bundle 2.1 MB in 412 ms", tone: "success" })}>
            <RotateCw />
          </DockItem>
        </>
      )}
    </motion.div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 mb-[9px] h-[18px] w-px self-end bg-separator" />;
}

function useMagnify(mouseX: MotionValue<number>, ref: React.RefObject<HTMLElement | null>) {
  const dist = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect();
    return r ? x - (r.left + r.width / 2) : Infinity;
  });
  const target = useTransform(dist, [-REACH, 0, REACH], [BASE, MAG, BASE]);
  return useSpring(target, { mass: 0.1, stiffness: 170, damping: 14 });
}

function DockItem({
  mouseX,
  label,
  keys,
  active,
  disabled,
  onClick,
  children,
}: {
  mouseX: MotionValue<number>;
  label: string;
  keys?: string[];
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const size = useMagnify(mouseX, ref);
  const icon = useTransform(size, (s) => s * 0.47);
  const [hover, setHover] = useState(false);
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      whileTap={{ scale: 0.88 }}
      style={{ width: size, height: size }}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full text-label transition-colors duration-200 disabled:opacity-30",
        active ? "bg-ink text-on-ink" : "hover:bg-fill-2",
      )}
    >
      <motion.span className="flex items-center justify-center [&_svg]:size-full [&_svg]:stroke-[1.7]" style={{ width: icon, height: icon }}>
        {children}
      </motion.span>
      <AnimatePresence>
        {hover && !disabled && (
          <motion.span
            className="glass-pop pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 flex items-center gap-2 rounded-[8px] px-2 py-1 text-footnote font-medium whitespace-nowrap text-label"
            initial={{ opacity: 0, y: 4, x: "-50%", scale: 0.96 }}
            animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
            exit={{ opacity: 0, y: 2, x: "-50%", transition: { duration: 0.1 } }}
            transition={spring.snappy}
          >
            {label}
            {keys && <Shortcut keys={keys} />}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/**
 * Record morphs into a live red capsule that counts, then back.
 *
 * One spring (`p`, 0 → 1) drives the whole morph — width, height, the timer's
 * reveal and the dot → square — so every part moves on the same curve and the
 * capsule can never overshoot one way and snap back another. Width is fixed
 * per state rather than measured: a mono timer has a known width, and a
 * measured "auto" would re-flow as each digit ticks.
 */
const REC_W = 76;
const TIMER_W = 34;

function RecordItem({ mouseX }: { mouseX: MotionValue<number> }) {
  const { recording, recordStartedAt, toggleRecording } = useApp();
  const ref = useRef<HTMLButtonElement>(null);
  const size = useMagnify(mouseX, ref);
  const p = useMotionValue(recording ? 1 : 0);
  useEffect(() => {
    const anim = animate(p, recording ? 1 : 0, spring.ui);
    return () => anim.stop();
  }, [recording, p]);

  // Idle it magnifies with the dock; recording it holds the resting height.
  const width = useTransform([size, p], ([s, k]: number[]) => s! + (REC_W - s!) * k!);
  const height = useTransform([size, p], ([s, k]: number[]) => s! + (BASE - s!) * k!);
  const timerW = useTransform(p, (k) => k * TIMER_W);
  const gap = useTransform(p, (k) => k * 6);
  const timerOpacity = useTransform(p, [0.35, 1], [0, 1]);
  const ring = useTransform(p, [0, 0.5], [1, 0]);
  const mark = useTransform(p, (k) => 11 - k);
  const markRadius = useTransform(p, (k) => 5.5 - k * 2.5);
  const markColor = useTransform(p, [0, 1], ["#ff3b30", "#ffffff"]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [recording]);
  const secs = recording && recordStartedAt ? Math.floor((now - recordStartedAt) / 1000) : 0;

  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={recording ? "Stop recording" : "Record screen"}
      onClick={toggleRecording}
      whileTap={{ scale: 0.94 }}
      transition={spring.snappy}
      style={{ width, height }}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full transition-colors duration-200",
        recording ? "text-white" : "text-label hover:bg-fill-2",
      )}
    >
      <motion.span aria-hidden className="absolute inset-0 rounded-full bg-red" style={{ opacity: p }} />
      <motion.span className="relative flex items-center" style={{ gap }}>
        <span className="relative flex size-[18px] items-center justify-center">
          <motion.span className="absolute inset-0 rounded-full shadow-[inset_0_0_0_1.7px_var(--label)]" style={{ opacity: ring }} />
          <motion.span className="block" style={{ width: mark, height: mark, borderRadius: markRadius, backgroundColor: markColor }} />
        </span>
        <motion.span className="overflow-hidden font-mono text-footnote font-semibold whitespace-nowrap tabular" style={{ width: timerW, opacity: timerOpacity }}>
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </motion.span>
      </motion.span>
    </motion.button>
  );
}
