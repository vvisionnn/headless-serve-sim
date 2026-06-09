import { MAX_SAMPLES, useAppMetrics } from "../hooks/use-app-metrics";
import { formatGridBytes } from "../utils/grid";

const CHART_W = 116;
const CHART_H = 30;
const MEM_MIN_SPAN = 64 * 1024 * 1024; // y-range floor so flat memory reads flat

function cpuColor(pct: number): string {
  if (pct >= 80) return "#f87171"; // danger
  if (pct >= 50) return "#fbbf24"; // warning
  return "#4ade80"; // success
}

// Right-anchored area + line paths for a series scaled into [yMin, yMax].
// Newest sample pins to the right edge; older samples scroll left and off.
function buildPaths(values: number[], yMin: number, yMax: number) {
  if (values.length < 2) return null;
  const span = yMax - yMin || 1;
  const dx = CHART_W / (MAX_SAMPLES - 1);
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = CHART_W - (n - 1 - i) * dx;
    const clamped = Math.max(yMin, Math.min(yMax, v));
    const y = CHART_H - ((clamped - yMin) / span) * CHART_H;
    return [x, y] as const;
  });
  const coords = pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`);
  const first = pts[0]!;
  const last = pts[n - 1]!;
  // One continuous subpath for the stroke; the fill reuses the same points but
  // drops to the baseline at each end so it closes flush along the bottom.
  const line = `M${coords.join(" L")}`;
  const area = `M${first[0].toFixed(1)} ${CHART_H} L${coords.join(" L")} L${last[0].toFixed(1)} ${CHART_H} Z`;
  return { line, area, last };
}

export function MetricsHud({
  pid,
  enabled,
}: {
  pid?: number;
  enabled: boolean;
}) {
  const { latest, samples } = useAppMetrics(pid, enabled);
  if (!pid || !latest || !latest.alive) return null;

  const cpu = latest.cpuPercent;
  const rss = latest.rssBytes ?? 0;

  const cpuValues = samples.map((s) => s.cpuPercent ?? 0);
  const memValues = samples.map((s) => s.rssBytes);

  // CPU anchored at 0, headroom only when a spike exceeds one core.
  const cpuMax = Math.max(100, ...cpuValues);
  // Memory auto-zooms to the window so real drift is legible, but a minimum
  // span keeps sub-~64MB jitter from being amplified into a full-height swing.
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

  const cpuStroke = cpu == null ? "#4ade80" : cpuColor(cpu);

  return (
    <div className="hud-in absolute top-0 right-full mr-3 z-30 w-[120px] flex flex-col gap-3 select-none font-mono pointer-events-none">
      <span
        className="absolute -top-1 right-0 size-1.5 rounded-full bg-success [animation:hud-pulse_1.6s_ease-in-out_infinite]"
        style={{ filter: "drop-shadow(0 0 4px #4ade80)" }}
      />
      <MetricBlock
        label="CPU"
        value={cpu == null ? "—" : `${cpu.toFixed(0)}%`}
        color={cpuStroke}
        values={cpuValues}
        yMin={0}
        yMax={cpuMax}
        gradId="hud-grad-cpu"
      />
      <MetricBlock
        label="MEM"
        value={formatGridBytes(rss)}
        color="#a5b4fc"
        values={memValues}
        yMin={memYMin}
        yMax={memYMax}
        gradId="hud-grad-mem"
      />
    </div>
  );
}

function MetricBlock({
  label,
  value,
  color,
  values,
  yMin,
  yMax,
  gradId,
}: {
  label: string;
  value: string;
  color: string;
  values: number[];
  yMin: number;
  yMax: number;
  gradId: string;
}) {
  const paths = buildPaths(values, yMin, yMax);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between leading-none">
        <span
          className="text-[9px] uppercase tracking-[0.16em] text-white/40"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
        >
          {label}
        </span>
        <span
          className="text-[13px] [font-variant-numeric:tabular-nums] [transition:color_0.3s]"
          style={{ color, textShadow: `0 0 9px ${color}55, 0 1px 3px rgba(0,0,0,0.95)` }}
        >
          {value}
        </span>
      </div>
      <svg
        width={CHART_W}
        height={CHART_H}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="overflow-visible block"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {paths && (
          <>
            <path d={paths.area} fill={`url(#${gradId})`} />
            <path
              d={paths.line}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 3px ${color}bb)` }}
            />
            <circle
              cx={paths.last[0]}
              cy={paths.last[1]}
              r="1.9"
              fill={color}
              style={{ filter: `drop-shadow(0 0 4px ${color})` }}
            />
          </>
        )}
      </svg>
    </div>
  );
}
