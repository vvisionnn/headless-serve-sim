import type { CSSProperties } from "react";
import { MAX_SAMPLES, useAppMetrics } from "../hooks/use-app-metrics";
import { formatGridBytes } from "../utils/grid";

// CPU/MEM readout for the top bar. Flat + crisp per the design system (no glow,
// no drop shadow, token colors). Reuses the live 1Hz metrics hook + rolling
// history; only the presentation changed — it now sits inline in the 44px top
// bar and collapses responsively as the bar (= device-frame) width shrinks.

const CHART_W = 52;
const CHART_H = 16;
const MEM_MIN_SPAN = 64 * 1024 * 1024; // y-range floor so flat memory reads flat

function cpuColor(pct: number): string {
  if (pct >= 80) return "var(--color-danger)";
  if (pct >= 50) return "var(--color-warning)";
  return "var(--color-success)";
}

// Right-anchored polyline for a series scaled into [yMin, yMax]; newest sample
// pins to the right edge. Flat hairline stroke — no fill, no glow.
function buildLine(values: number[], yMin: number, yMax: number): string | null {
  if (values.length < 2) return null;
  const span = yMax - yMin || 1;
  const dx = CHART_W / (MAX_SAMPLES - 1);
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = CHART_W - (n - 1 - i) * dx;
    const clamped = Math.max(yMin, Math.min(yMax, v));
    const y = CHART_H - ((clamped - yMin) / span) * CHART_H;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `M${pts.join(" L")}`;
}

export function TopBarMetrics({
  pid,
  enabled,
  barWidth,
}: {
  pid?: number;
  enabled: boolean;
  barWidth: number;
}) {
  const { latest, samples } = useAppMetrics(pid, enabled);
  if (!pid || !latest || !latest.alive) return null;

  const cpu = latest.cpuPercent;
  const rss = latest.rssBytes ?? 0;
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

  // Responsive collapse, driven by the bar (= frame) width: spark -> label -> MEM.
  const showSpark = barWidth >= 460;
  const showLabel = barWidth >= 380;
  const showMem = barWidth >= 300;

  const cpuStroke = cpu == null ? "var(--color-success)" : cpuColor(cpu);

  return (
    <div className="flex items-center gap-2 min-w-0 font-mono select-none" aria-hidden>
      <Metric
        label={showLabel ? "CPU" : null}
        value={cpu == null ? "—" : `${cpu.toFixed(0)}%`}
        color={cpuStroke}
        line={showSpark ? buildLine(cpuValues, 0, cpuMax) : null}
      />
      {showMem && <span className="w-px h-3.5 bg-divider shrink-0" />}
      {showMem && (
        <Metric
          label={showLabel ? "MEM" : null}
          value={formatGridBytes(rss)}
          color="var(--color-accent)"
          line={showSpark ? buildLine(memValues, memYMin, memYMax) : null}
        />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  color,
  line,
}: {
  label: string | null;
  value: string;
  color: string;
  line: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {label && (
        <span className="text-[9px] uppercase tracking-[0.14em] text-fg-3 shrink-0">{label}</span>
      )}
      <span className="text-[12px] tabular-nums shrink-0" style={{ color } as CSSProperties}>
        {value}
      </span>
      {line && (
        <svg
          width={CHART_W}
          height={CHART_H}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="block shrink-0"
          aria-hidden
        >
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="1.25"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      )}
    </div>
  );
}
