import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { Accessibility, Camera, House, Keyboard, RotateCcw, RotateCw, SunMoon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { Shortcut } from "../ui/kbd";
import { recordMorphed } from "../utils/record-morph";
import { useShell } from "./shell-context";

const BASE = 36;
const MAG = 46;
const REACH = 110;

/**
 * The device's own controls, floating just under it (after ReactBits Dock):
 * icons swell toward the pointer like the macOS Dock, labels rise above.
 * Placing them under the device maps each control to what it acts on.
 */
export function DeviceDock({ intro = true }: { intro?: boolean }) {
  const shell = useShell();
  const mouseX = useMotionValue(Infinity);
  const watch = shell.device?.type === "watch";
  const off = !shell.streaming;
  return (
    <motion.div
      data-device-dock
      onMouseMove={(e) => mouseX.set(e.clientX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className="glass flex h-[50px] items-end gap-1 rounded-[25px] px-[7px] pb-[7px]"
      initial={intro ? { opacity: 0, y: 12, filter: "blur(6px)" } : false}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ ...spring.surface, delay: 0.25 }}
    >
      <DockItem
        mouseX={mouseX}
        label="Home"
        keys={["⇧", "⌘", "H"]}
        disabled={off}
        onClick={shell.goHome}
      >
        <House />
      </DockItem>
      <DockItem
        mouseX={mouseX}
        label="Rotate"
        disabled={off || !shell.canRotate}
        onClick={shell.rotate}
      >
        <RotateCcw />
      </DockItem>
      <AppearanceItem mouseX={mouseX} disabled={off} onClick={shell.toggleAppearance} />
      <Divider />
      <DockItem
        mouseX={mouseX}
        label="Screenshot"
        keys={["⌘", "S"]}
        disabled={off}
        onClick={shell.screenshot}
      >
        <Camera />
      </DockItem>
      <RecordItem mouseX={mouseX} />
      <Divider />
      <DockItem
        mouseX={mouseX}
        label="Accessibility overlay"
        active={shell.axOverlayEnabled}
        disabled={off}
        onClick={shell.toggleAxOverlay}
      >
        <Accessibility />
      </DockItem>
      <DockItem
        mouseX={mouseX}
        label="Software keyboard"
        keys={["⌥", "⌘", "K"]}
        disabled={off || watch}
        onClick={shell.toggleSoftwareKeyboard}
      >
        <Keyboard />
      </DockItem>
      <AnimatePresence initial={false}>
        {shell.reloadReactNative && (
          <motion.span
            key="rn"
            className="flex items-end gap-1"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={spring.ui}
          >
            <Divider />
            <DockItem
              mouseX={mouseX}
              label="Reload JS bundle"
              keys={["R"]}
              onClick={shell.reloadReactNative}
            >
              <RotateCw />
            </DockItem>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Divider() {
  return (
    <span aria-hidden className="mx-0.5 mb-[9px] h-[18px] w-px shrink-0 self-end bg-separator" />
  );
}

function useMagnify(mouseX: MotionValue<number>, ref: React.RefObject<HTMLElement | null>) {
  const dist = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect();
    return r ? x - (r.left + r.width / 2) : Infinity;
  });
  const target = useTransform(dist, [-REACH, 0, REACH], [BASE, MAG, BASE]);
  return useSpring(target, { mass: 0.1, stiffness: 170, damping: 14 });
}

/** The simulator's appearance is a toggle whose state we don't observe, so
 *  its glyph turns a half-step on each press instead of claiming a mode. */
function AppearanceItem({
  mouseX,
  disabled,
  onClick,
}: {
  mouseX: MotionValue<number>;
  disabled: boolean;
  onClick: () => void;
}) {
  const [turns, setTurns] = useState(0);
  return (
    <DockItem
      mouseX={mouseX}
      label="Toggle appearance"
      keys={["⇧", "⌘", "A"]}
      disabled={disabled}
      onClick={() => {
        setTurns((t) => t + 1);
        onClick();
      }}
    >
      <motion.span
        className="flex size-full"
        animate={{ rotate: turns * 180 }}
        transition={spring.rotate}
      >
        <SunMoon />
      </motion.span>
    </DockItem>
  );
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
        "relative flex shrink-0 items-center justify-center rounded-full text-label transition-colors duration-200 disabled:text-label-3",
        active ? "bg-ink text-on-ink" : "hover:bg-fill-2",
      )}
    >
      <motion.span
        className="flex items-center justify-center [&_svg]:size-full [&_svg]:stroke-[1.7]"
        style={{ width: icon, height: icon }}
      >
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

/** m:ss since `startedAt`, ticking while recording. */
export function useElapsed(startedAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [startedAt]);
  const secs = startedAt == null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
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
  const { recording: rec, streaming } = useShell();
  // The capsule opens at the click, while the recorder is still starting;
  // stop during that cancels the start.
  const recording = recordMorphed(rec.status);
  const busy = rec.status === "finishing";
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
  const elapsed = useElapsed(rec.status === "recording" ? rec.startedAt : null);
  const [hover, setHover] = useState(false);
  const disabled = !recording && (!streaming || !rec.available);
  const label = recording ? "Stop recording" : "Record screen";

  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={recording ? rec.stop : rec.start}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      whileTap={{ scale: 0.94 }}
      transition={spring.snappy}
      style={{ width, height }}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full transition-colors duration-200 disabled:opacity-50",
        recording ? "text-white" : "text-label hover:bg-fill-2",
      )}
    >
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full bg-red"
        style={{ opacity: p }}
      />
      <motion.span className="relative flex items-center overflow-hidden" style={{ gap }}>
        <span className="relative flex size-[18px] items-center justify-center">
          <motion.span
            className="absolute inset-0 rounded-full shadow-[inset_0_0_0_1.7px_var(--label)]"
            style={{ opacity: ring }}
          />
          <motion.span
            className={cn("block", busy && "animate-pulse")}
            style={{
              width: mark,
              height: mark,
              borderRadius: markRadius,
              backgroundColor: markColor,
            }}
          />
        </span>
        <motion.span
          className="overflow-hidden font-mono text-footnote font-semibold whitespace-nowrap tabular"
          style={{ width: timerW, opacity: timerOpacity }}
        >
          {elapsed}
        </motion.span>
      </motion.span>
      <AnimatePresence>
        {hover && !disabled && !recording && (
          <motion.span
            className="glass-pop pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 rounded-[8px] px-2 py-1 text-footnote font-medium whitespace-nowrap text-label"
            initial={{ opacity: 0, y: 4, x: "-50%", scale: 0.96 }}
            animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
            exit={{ opacity: 0, y: 2, x: "-50%", transition: { duration: 0.1 } }}
            transition={spring.snappy}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
