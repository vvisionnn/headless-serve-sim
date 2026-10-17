import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { rubberband, spring } from "../lib/motion";

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  /** Draw a dot per stop — for stepped values such as Text Size. */
  ticks?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Slider (after ReactBits ElasticSlider). Tracks the pointer 1:1 from wherever
 * it was grabbed; past either end the track stretches with progressive
 * resistance instead of hitting a wall, then springs back on release.
 */
export function Slider({
  value,
  min = 0,
  max = 1,
  step,
  onChange,
  ticks,
  leading,
  trailing,
  label,
  disabled,
  className,
}: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const overflow = useMotionValue(0);
  const pct = (value - min) / (max - min);
  const p = useMotionValue(pct);
  useEffect(() => {
    if (!drag) animate(p, pct, spring.snappy);
    else p.jump(pct);
  }, [pct, drag, p]);

  const width = useTransform(p, (v) => `${v * 100}%`);
  const knobLeft = useTransform(p, (v) => `calc(${v * 100}% - ${v * 20}px)`);
  const scaleX = useTransform(
    overflow,
    (o) => 1 + Math.abs(o) / ((track.current?.offsetWidth ?? 200) * 1),
  );
  const originX = useTransform(overflow, (o) => (o < 0 ? 1 : 0));

  const commit = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const raw = (clientX - r.left - 10) / (r.width - 20);
    const over = raw < 0 ? raw * r.width : raw > 1 ? (raw - 1) * r.width : 0;
    overflow.set(rubberband(over, r.width, 0.25) * 0.12);
    let v = min + Math.min(1, Math.max(0, raw)) * (max - min);
    if (step) v = Math.round(v / step) * step;
    if (v !== value) onChange(Number(v.toFixed(4)));
  };

  const stops = ticks && step ? Math.round((max - min) / step) + 1 : 0;

  return (
    <div
      aria-disabled={disabled || undefined}
      className={cn(
        "flex items-center gap-2.5 text-label-3 [&_svg]:size-[14px] [&_svg]:shrink-0",
        disabled && "pointer-events-none [&_[role=slider]]:opacity-50",
        className,
      )}
    >
      {leading}
      <motion.div
        ref={track}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        className="relative h-5 flex-1 cursor-grab touch-none rounded-full select-none active:cursor-grabbing"
        style={{ scaleX, originX }}
        onKeyDown={(e) => {
          const s = step ?? (max - min) / 20;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(max, value + s));
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(min, value - s));
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(true);
          commit(e.clientX);
        }}
        onPointerMove={(e) => drag && commit(e.clientX)}
        onPointerUp={() => {
          setDrag(false);
          animate(overflow, 0, spring.momentum);
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-fill">
          <motion.div className="h-full rounded-full bg-ink" style={{ width }} />
        </div>
        {stops > 0 && (
          <div className="pointer-events-none absolute inset-x-[10px] top-1/2 flex -translate-y-1/2 justify-between">
            {Array.from({ length: stops }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "size-1 rounded-full",
                  i / (stops - 1) <= pct + 1e-6 ? "bg-on-ink/70" : "bg-label-3/70",
                )}
              />
            ))}
          </div>
        )}
        <motion.div
          className="absolute top-0 size-5 rounded-full bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.18),0_0.5px_1px_rgba(0,0,0,0.1)]"
          style={{ left: knobLeft }}
          animate={{ scale: drag ? 1.12 : 1 }}
          transition={spring.snappy}
        />
      </motion.div>
      {trailing}
    </div>
  );
}
