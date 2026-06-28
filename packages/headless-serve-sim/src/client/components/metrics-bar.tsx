import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MAX_SAMPLES, useAppMetrics } from "../hooks/use-app-metrics";
import { formatGridBytes } from "../utils/grid";
import { buildSparkline, cpuColor, memoryRange, splitValueUnit } from "../utils/metrics-chart";

// Full-height left "Activity" rail — the dedicated home for the foreground app's
// live CPU% and memory. It mirrors the right inspector exactly: a thin
// collapsed rail whose frosted header lines up with the top bar, expanding to a
// fixed-width panel that slides out (the body is laid out at full width at all
// times and anchored to the LEFT edge; expanding just animates the rail width).
//
// The two gauges sit at the TOP of the panel at a fixed, comfortable height —
// they are compact instruments, not space-fillers, so the lower panel is left
// deliberately open. Each gauge leads with a large tabular hero number (the
// memory figure alone proves the readout is live even when an idle app's CPU
// line is flat) over a filled sparkline. CPU is color-graded by load; memory
// rides the one accent blue. Reuses the 1Hz metrics hook; presentation only.

const CHART_H = 80; // fixed sparkline height — gauges stay compact, not full-bleed
const EASE = "cubic-bezier(0.4, 0, 0.6, 1)";

// Measure an element's width so the sparkline renders at crisp pixels and
// reflows when the panel resizes (the height is fixed at CHART_H).
function useElementWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setW(Math.round(box.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface MetricsBarProps {
  open: boolean;
  onToggle: () => void;
  collapsedWidth: number;
  expandedWidth: number;
  topBarHeight: number;
  frameHeight: number;
  pid?: number;
  enabled: boolean;
}

export function MetricsBar({
  open,
  onToggle,
  collapsedWidth,
  expandedWidth,
  topBarHeight,
  frameHeight,
  pid,
  enabled,
}: MetricsBarProps) {
  // The hook runs whether the rail is open or not, so samples accumulate while
  // collapsed and the charts already have data the instant it's expanded.
  const { latest, samples } = useAppMetrics(pid, enabled);
  const height = topBarHeight + frameHeight;

  const alive = !!(pid && latest && latest.alive);
  const cpu = alive ? latest!.cpuPercent : null;
  const rss = alive ? latest!.rssBytes ?? 0 : 0;
  const cpuValues = samples.map((s) => s.cpuPercent ?? 0);
  const memValues = samples.map((s) => s.rssBytes);

  const cpuMax = Math.max(100, ...cpuValues);
  const { yMin: memYMin, yMax: memYMax } = memoryRange(memValues, rss);

  const [memNum, memUnit] = alive ? splitValueUnit(formatGridBytes(rss)) : ["—", ""];

  return (
    <aside
      className="relative shrink-0 overflow-hidden bg-panel border-r border-divider font-system"
      style={{
        width: open ? expandedWidth : collapsedWidth,
        height,
        transition: `width 320ms ${EASE}`,
      }}
      aria-label="Activity"
    >
      {/* Fixed-width panel anchored to the LEFT edge — never reflows; the rail
          width animation reveals it. */}
      <div className="absolute top-0 left-0 flex flex-col" style={{ width: expandedWidth, height }}>
        {/* Header — frosted, same height + keyline as the top bar. The toggle
            sits at the LEFT so it stays in the collapsed rail. */}
        <div
          className="flex items-center shrink-0 border-b border-divider bg-panel-overlay [backdrop-filter:saturate(1.8)_blur(20px)]"
          style={{ height: topBarHeight }}
        >
          {/* The toggle sits in a slot exactly the collapsed-rail width, so the
              title that follows starts at the rail edge: it stays mounted and is
              simply clipped by the rail when collapsed (sliding behind the frame
              with the width animation) rather than extending out or popping. */}
          <div className="flex shrink-0 items-center justify-center" style={{ width: collapsedWidth }}>
            <button
              type="button"
              onClick={onToggle}
              className="flex size-9 items-center justify-center rounded-full bg-transparent text-fg-2 hover:bg-hover hover:text-fg [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1)] cursor-pointer focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
              aria-label={open ? "Collapse activity" : "Expand activity"}
              aria-expanded={open}
              title="Activity"
            >
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: open ? "rotate(180deg)" : "none" }}
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
          <ActivityGlyph />
          <span className="ml-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">
            Activity
          </span>
          {alive && (
            <span
              className="ml-auto mr-2 size-1.5 rounded-full bg-success"
              style={{ animation: "hud-pulse 1.8s cubic-bezier(0.4,0,0.6,1) infinite" }}
              aria-hidden
            />
          )}
        </div>

        {/* Body — compact gauges pinned to the top; the lower panel stays open.
            Fades + slides in as a unit so it reads as a panel sliding out. */}
        <div
          className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto bg-inset p-3.5 [&>*]:shrink-0"
          aria-hidden={!open}
          style={{
            opacity: open ? 1 : 0,
            transform: open ? "translateX(0)" : "translateX(-28px)",
            pointerEvents: open ? "auto" : "none",
            transition: `opacity 260ms ${EASE}, transform 320ms ${EASE}`,
          }}
        >
          <Gauge
            kind="cpu"
            label="CPU"
            value={cpu == null ? "—" : cpu.toFixed(cpu >= 10 ? 0 : 1)}
            unit={cpu == null ? "" : "%"}
            color={cpuColor(cpu)}
            values={alive ? cpuValues : null}
            yMin={0}
            yMax={cpuMax}
          />
          <Gauge
            kind="mem"
            label="Memory"
            value={memNum}
            unit={memUnit}
            color="var(--color-accent)"
            values={alive ? memValues : null}
            yMin={memYMin}
            yMax={memYMax}
          />
        </div>
      </div>
    </aside>
  );
}

function Gauge({
  kind,
  label,
  value,
  unit,
  color,
  values,
  yMin,
  yMax,
}: {
  kind: "cpu" | "mem";
  label: string;
  value: string;
  unit: string;
  color: string;
  values: number[] | null;
  yMin: number;
  yMax: number;
}) {
  const [chartRef, w] = useElementWidth();
  const fillId = `metric-fill-${kind}`;
  const paths = values ? buildSparkline(values, yMin, yMax, w, CHART_H, MAX_SAMPLES) : null;
  return (
    <div className="flex flex-col rounded-card border border-divider bg-panel p-3.5">
      <div className="flex items-center gap-2">
        <GlyphIcon kind={kind} color={color} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">
          {label}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className="text-[30px] leading-none font-semibold tabular-nums tracking-[-0.02em]"
          style={{ color } as CSSProperties}
        >
          {value}
        </span>
        {unit && <span className="text-[14px] font-medium text-fg-3">{unit}</span>}
      </div>
      {/* Fixed-height sparkline (measured width keeps it crisp). */}
      <div ref={chartRef} className="mt-3" style={{ height: CHART_H }}>
        {w > 0 && (
          <svg width={w} height={CHART_H} viewBox={`0 0 ${w} ${CHART_H}`} className="block" aria-hidden>
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.26} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {/* baseline axis — always drawn so an idle/flat series still reads as a chart */}
            <line x1="0" y1={CHART_H - 4} x2={w} y2={CHART_H - 4} stroke={color} strokeWidth="1" strokeOpacity={0.22} />
            {paths && (
              <>
                <path d={paths.area} fill={`url(#${fillId})`} stroke="none" />
                <path d={paths.line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={paths.tip[0]} cy={paths.tip[1]} r="2.6" fill={color} />
                <circle cx={paths.tip[0]} cy={paths.tip[1]} r="2.6" fill="none" stroke={color} strokeOpacity={0.28} strokeWidth="3.5" />
              </>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}

function GlyphIcon({ kind, color }: { kind: "cpu" | "mem"; color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
      {kind === "cpu" ? (
        <>
          <rect x="6" y="6" width="12" height="12" rx="2" />
          <rect x="10" y="10" width="4" height="4" rx="1" />
          <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
        </>
      ) : (
        <>
          <rect x="3" y="6.5" width="18" height="4.5" rx="1.25" />
          <rect x="3" y="13" width="18" height="4.5" rx="1.25" />
          <path d="M7 9.5v0M7 16v0" />
        </>
      )}
    </svg>
  );
}

function ActivityGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
      <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />
    </svg>
  );
}
