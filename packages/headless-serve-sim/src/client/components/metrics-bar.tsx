import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MAX_SAMPLES, useAppMetrics } from "../hooks/use-app-metrics";
import { formatGridBytes } from "../utils/grid";

// Full-height left "Activity" bar — the dedicated home for the foreground app's
// live CPU% and memory. It mirrors the right inspector's shell (frosted 44px
// header + recessed canvas + grouped white cards) so the two rails read as a
// matched pair framing the device. Unlike the inspector it never collapses:
// these gauges are the whole point of the bar, so hiding them would defeat it.
//
// Each gauge leads with a LARGE tabular hero number (the memory figure alone
// proves the readout is live even when an idle app's CPU line is flat against
// the baseline), backed by a big filled sparkline that GROWS to fill the card
// (its height is measured, so the chart is a real instrument, not a hairline).
// CPU is color-graded by load; memory rides the one accent blue. Reuses the
// 1Hz metrics hook + rolling history; presentation only.

const MEM_MIN_SPAN = 160 * 1024 * 1024; // y-range floor so idle memory jitter reads flat

function cpuColor(pct: number | null): string {
  if (pct == null) return "var(--color-fg-3)";
  if (pct >= 80) return "var(--color-danger)";
  if (pct >= 50) return "var(--color-warning)";
  return "var(--color-success)";
}

// Measure an element's content box, so the sparkline can render at exact crisp
// pixels and reflow when the bar height changes (viewport resize / rotation).
function useElementSize(): [React.RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ w: Math.round(box.width), h: Math.round(box.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

// Right-anchored sparkline scaled into [yMin, yMax]; newest sample pins to the
// right edge. Returns the stroke path, a closed area (to the baseline), and the
// latest point so the chart reads as live telemetry. A small top/bottom margin
// keeps a flat/idle series a visible line + band, never glued to the axis.
function buildPaths(
  values: number[],
  yMin: number,
  yMax: number,
  w: number,
  h: number,
): { line: string; area: string; tip: [number, number] } | null {
  if (values.length < 2 || w <= 0 || h <= 0) return null;
  const span = yMax - yMin || 1;
  const dx = w / (MAX_SAMPLES - 1);
  const n = values.length;
  const topPad = 6;
  const baseY = h - 4;
  const usableH = Math.max(1, baseY - topPad);
  const xy = values.map((v, i) => {
    const x = w - (n - 1 - i) * dx;
    const clamped = Math.max(yMin, Math.min(yMax, v));
    const frac = (clamped - yMin) / span;
    const y = topPad + (1 - frac) * usableH;
    return [x, y] as const;
  });
  const line = `M${xy.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")}`;
  const x0 = xy[0]![0];
  const xN = xy[xy.length - 1]![0];
  const area = `${line} L${xN.toFixed(1)} ${baseY.toFixed(1)} L${x0.toFixed(1)} ${baseY.toFixed(1)} Z`;
  return { line, area, tip: xy[xy.length - 1]! as [number, number] };
}

export function MetricsBar({
  pid,
  enabled,
  topBarHeight,
  frameHeight,
  width,
}: {
  pid?: number;
  enabled: boolean;
  topBarHeight: number;
  frameHeight: number;
  width: number;
}) {
  const { latest, samples } = useAppMetrics(pid, enabled);
  const height = topBarHeight + frameHeight;

  const alive = !!(pid && latest && latest.alive);
  const cpu = alive ? latest!.cpuPercent : null;
  const rss = alive ? latest!.rssBytes ?? 0 : 0;
  const cpuValues = samples.map((s) => s.cpuPercent ?? 0);
  const memValues = samples.map((s) => s.rssBytes);

  const cpuMax = Math.max(100, ...cpuValues);
  const memHi = memValues.length ? Math.max(...memValues) : rss;
  const memLo = memValues.length ? Math.min(...memValues) : 0;
  const memMid = (memHi + memLo) / 2;
  const memSpan = Math.max(memHi - memLo, MEM_MIN_SPAN) * 1.15;
  let memYMin = memMid - memSpan / 2;
  let memYMax = memMid + memSpan / 2;
  if (memYMin < 0) {
    memYMax -= memYMin;
    memYMin = 0;
  }

  const [memNum, memUnit] = alive ? splitValueUnit(formatGridBytes(rss)) : ["—", ""];

  return (
    <aside
      className="relative shrink-0 overflow-hidden bg-panel border-r border-divider font-system"
      style={{ width, height }}
      aria-label="Activity"
    >
      <div className="flex flex-col" style={{ width, height }}>
        {/* Header — frosted, same height + bottom keyline as the top bar, so the
            left rail's cap lines up with the toolbar across the device. */}
        <div
          className="flex items-center gap-2 shrink-0 border-b border-divider px-3.5 bg-panel-overlay [backdrop-filter:saturate(1.8)_blur(20px)]"
          style={{ height: topBarHeight }}
        >
          <ActivityGlyph />
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">
            Activity
          </span>
          {alive && (
            <span
              className="ml-auto size-1.5 rounded-full bg-success"
              style={{ animation: "hud-pulse 1.8s cubic-bezier(0.4,0,0.6,1) infinite" }}
              aria-hidden
            />
          )}
        </div>

        {/* Body — two gauges share the column height as a balanced instrument
            panel; scrolls on a short viewport. */}
        <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto bg-inset p-3.5">
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

// "219 MB" -> ["219", "MB"]; "—" -> ["—", ""].
function splitValueUnit(s: string): [string, string] {
  const i = s.indexOf(" ");
  return i === -1 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
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
  const [chartRef, { w, h }] = useElementSize();
  const fillId = `metric-fill-${kind}`;
  const paths = values ? buildPaths(values, yMin, yMax, w, h) : null;
  return (
    <div className="flex flex-1 min-h-[150px] flex-col rounded-card border border-divider bg-panel p-3.5">
      <div className="flex items-center gap-2">
        <GlyphIcon kind={kind} color={color} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">
          {label}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className="text-[32px] leading-none font-semibold tabular-nums tracking-[-0.02em]"
          style={{ color } as CSSProperties}
        >
          {value}
        </span>
        {unit && <span className="text-[14px] font-medium text-fg-3">{unit}</span>}
      </div>
      {/* Chart fills the remaining card height; measured so the SVG stays crisp. */}
      <div ref={chartRef} className="relative mt-3 min-h-0 flex-1">
        {w > 0 && h > 0 && (
          <svg
            width={w}
            height={h}
            viewBox={`0 0 ${w} ${h}`}
            className="block"
            aria-hidden
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.26} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {/* baseline axis — always drawn so an idle/flat series still reads as a chart */}
            <line x1="0" y1={h - 4} x2={w} y2={h - 4} stroke={color} strokeWidth="1" strokeOpacity={0.22} />
            {paths && (
              <>
                <path d={paths.area} fill={`url(#${fillId})`} stroke="none" />
                <path
                  d={paths.line}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
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
