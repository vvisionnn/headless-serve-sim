import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "../lib/cn";

/** Live area chart that scrolls like an instrument trace. */
export function AreaChart({
  data,
  max,
  min = 0,
  tick,
  interval = 1,
  height = 64,
  className,
  tone = "ink",
}: {
  data: number[];
  max: number;
  /** Value at the chart floor — raise it so small swings stay visible. */
  min?: number;
  /** Increments once per sample; restarts the one-step scroll. */
  tick: number;
  interval?: number;
  height?: number;
  className?: string;
  tone?: "ink" | "green" | "orange" | "red";
}) {
  const id = useId();
  const n = data.length;
  const step = 10;
  const W = (n - 1) * step;
  const pts = data.map((v, i) => [i * step, height - 3 - ((Math.min(Math.max(v, min), max) - min) / (max - min)) * (height - 10)] as const);
  // Catmull-Rom → Bézier so the trace reads as a continuous signal.
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6}, ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6}, ${p2[0]} ${p2[1]}`;
  }
  const last = pts[pts.length - 1]!;
  const area = `${d} L ${last[0]} ${height} L 0 ${height} Z`;
  const color = { ink: "var(--ink)", green: "var(--green)", orange: "var(--orange)", red: "var(--red)" }[tone];
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ height }}>
      {[0.25, 0.5, 0.75].map((g) => (
        <div key={g} className="absolute inset-x-0 border-t border-dashed border-separator" style={{ top: height * g }} />
      ))}
      {/* Draw one sample past the right edge, then glide left by one step
          over the sample interval: new data scrolls in rather than popping. */}
      <motion.svg
        key={tick}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-y-0 left-0 h-full overflow-visible"
        style={{ width: `${((n - 1) / (n - 2)) * 100}%` }}
        initial={{ x: "0%" }}
        animate={{ x: `${-100 / (n - 1)}%` }}
        transition={{ duration: interval, ease: "linear" }}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </motion.svg>
    </div>
  );
}

/** A compact sparkline for stat tiles. */
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const W = 100;
  const H = 24;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = hi - lo || 1;
  const d = data.map((v, i) => `${i === 0 ? "M" : "L"} ${(i / (data.length - 1)) * W} ${H - 2 - ((v - lo) / span) * (H - 4)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("h-6 w-full", className)}>
      <path d={d} fill="none" stroke="var(--label-2)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
