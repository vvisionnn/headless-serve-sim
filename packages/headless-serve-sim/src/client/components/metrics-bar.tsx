import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  MAX_SAMPLES,
  useAppMetrics,
  type AppMetrics,
  type AppMetricsStream,
} from "../hooks/use-app-metrics";
import { formatGridBytes } from "../utils/grid";
import { buildSparkline, cpuColor, memoryRange, splitValueUnit } from "../utils/metrics-chart";
import { PanelToggleIcon, SectionGroup, SquareIconButton } from "./design-system";

// The left Activity card. The two primary gauges chart the foreground app's
// native CPU and physical footprint; compact rows expose every additional
// native counter without conflating app performance with stream telemetry.

const CHART_H = 80;
const EASE = "cubic-bezier(0.4, 0, 0.6, 1)";

function useElementWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setWidth(Math.round(box.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export interface MetricsBarProps {
  open: boolean;
  onToggle: () => void;
  collapsedWidth: number;
  expandedWidth: number;
  topBarHeight: number;
  /** Full card height — the rail spans the canvas, not the device. */
  height: number;
  metricsEndpoint?: string;
  enabled: boolean;
}

export function MetricsBar({
  open,
  onToggle,
  collapsedWidth,
  expandedWidth,
  topBarHeight,
  height,
  metricsEndpoint,
  enabled,
}: MetricsBarProps) {
  const stream = useAppMetrics(metricsEndpoint, enabled);
  const alive = stream.latest?.alive === true;

  return (
    <aside
      className="relative shrink-0 overflow-hidden rounded-panel bg-panel shadow-panel font-system"
      style={{
        width: open ? expandedWidth : collapsedWidth,
        height,
        transition: `width 320ms ${EASE}`,
      }}
      aria-label="Activity"
    >
      <div className="absolute top-0 left-0 flex flex-col" style={{ width: expandedWidth, height }}>
        <div className="flex shrink-0 items-center gap-2 px-[9px]" style={{ height: topBarHeight }}>
          <SquareIconButton
            onClick={onToggle}
            label={open ? "Collapse activity" : "Expand activity"}
            title="Activity"
          >
            <PanelToggleIcon side="left" open={open} />
          </SquareIconButton>
          <span className="ml-1 truncate text-eyebrow uppercase text-fg">Activity</span>
          {alive && (
            <span
              className="ml-auto mr-2 size-1.5 rounded-full bg-success"
              style={{ animation: "hud-pulse 1.8s cubic-bezier(0.4,0,0.6,1) infinite" }}
              aria-hidden
            />
          )}
        </div>

        <div
          className="flex flex-1 min-h-0 flex-col overflow-y-auto bg-inset [&>*]:shrink-0"
          aria-hidden={!open}
          style={{
            opacity: open ? 1 : 0,
            transform: open ? "translateX(0)" : "translateX(-28px)",
            pointerEvents: open ? "auto" : "none",
            transition: `opacity 260ms ${EASE}, transform 320ms ${EASE}`,
          }}
        >
          <MetricsDashboard stream={stream} />
        </div>
      </div>
    </aside>
  );
}

export function MetricsDashboard({ stream }: { stream: AppMetricsStream }) {
  const metrics = stream.latest;
  const alive = metrics?.alive === true;
  const cpu = alive ? metrics.cpuPercent : null;
  const footprint = alive ? (metrics.memoryFootprintBytes ?? 0) : 0;
  const cpuValues = stream.samples.flatMap((sample) =>
    sample.cpuPercent === null ? [] : [sample.cpuPercent],
  );
  const memoryValues = stream.samples.map((sample) => sample.memoryFootprintBytes);
  const cpuMax = Math.max(100, ...cpuValues);
  const { yMin: memoryMin, yMax: memoryMax } = memoryRange(memoryValues, footprint);
  const [memoryNumber, memoryUnit] = alive ? splitValueUnit(formatGridBytes(footprint)) : ["—", ""];

  return (
    <>
      <AppIdentity metrics={metrics} error={stream.error} />
      <SectionGroup label="Live">
        <Gauge
          kind="cpu"
          label="CPU"
          value={cpu === null ? "—" : cpu.toFixed(cpu >= 100 ? 0 : 1)}
          unit={cpu === null ? "" : "%"}
          color={cpuColor(cpu)}
          values={alive ? cpuValues : null}
          yMin={0}
          yMax={cpuMax}
        />
        <Gauge
          kind="mem"
          label="Memory Footprint"
          value={memoryNumber}
          unit={memoryUnit}
          color="var(--color-fg-3)"
          values={alive ? memoryValues : null}
          yMin={memoryMin}
          yMax={memoryMax}
        />
      </SectionGroup>
      <SectionGroup label="Counters">
        <MetricDetails metrics={alive ? metrics : null} />
      </SectionGroup>
    </>
  );
}

function AppIdentity({ metrics, error }: { metrics: AppMetrics | null; error: string | null }) {
  const alive = metrics?.alive === true;
  const unavailable = error !== null || metrics?.state === "unavailable";
  const noForegroundApp = metrics?.state === "no-foreground-app";
  const label =
    error ??
    (alive
      ? metrics.bundleId!
      : noForegroundApp
        ? "No foreground app"
        : unavailable
          ? "Metrics unavailable"
          : "Connecting to metrics");
  const status = unavailable
    ? "Unavailable"
    : alive
      ? "Live"
      : noForegroundApp
        ? "Waiting"
        : "Connecting";
  const statusColor = unavailable
    ? "var(--color-danger)"
    : alive
      ? "var(--color-success)"
      : "var(--color-fg-3)";
  const sampledAt = metrics ? new Date(metrics.sampledAtMs) : null;

  return (
    <section className="px-5 py-4">
      <div className="flex items-center justify-between gap-2" role="status">
        <span className="min-w-0 truncate text-value font-semibold text-fg" title={label}>
          {label}
        </span>
        <span
          className="flex shrink-0 items-center gap-1.5 text-micro font-medium"
          style={{ color: statusColor }}
        >
          <span className="size-1.5 rounded-full" style={{ background: statusColor }} aria-hidden />
          {status}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-micro text-fg-3 tabular-nums">
        <span>{alive ? `PID ${metrics.pid}` : "PID —"}</span>
        {sampledAt && (
          <span>
            Updated <time dateTime={sampledAt.toISOString()}>{sampledAt.toLocaleTimeString()}</time>
          </span>
        )}
      </div>
    </section>
  );
}

function MetricDetails({ metrics }: { metrics: AppMetrics | null }) {
  return (
    <section className="grid grid-cols-2 border-t border-divider" aria-label="App metric details">
      <Detail label="User CPU" value={formatPercent(metrics?.cpuUserPercent ?? null)} />
      <Detail label="System CPU" value={formatPercent(metrics?.cpuSystemPercent ?? null)} />
      <Detail
        label="Peak Footprint"
        value={formatBytes(metrics?.peakMemoryFootprintBytes ?? null)}
      />
      <Detail label="Resident Memory" value={formatBytes(metrics?.residentBytes ?? null)} />
      <Detail label="Threads" value={formatInteger(metrics?.threadCount ?? null)} />
      <Detail label="Running" value={formatInteger(metrics?.runningThreadCount ?? null)} />
      <Detail label="Disk Read" value={formatByteRate(metrics?.diskReadBytesPerSecond ?? null)} />
      <Detail label="Disk Write" value={formatByteRate(metrics?.diskWriteBytesPerSecond ?? null)} />
      <Detail label="Wakeups" value={formatCounterRate(metrics?.wakeupsPerSecond ?? null)} />
      <Detail label="Page-ins" value={formatCounterRate(metrics?.pageInsPerSecond ?? null)} />
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b border-r border-divider px-3 py-2.5 even:border-r-0 [&:nth-last-child(-n+2)]:border-b-0">
      <div className="text-micro text-fg-3">{label}</div>
      <div className="mt-0.5 truncate text-value font-semibold text-fg tabular-nums" title={value}>
        {value}
      </div>
    </div>
  );
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function formatBytes(value: number | null): string {
  return value === null ? "—" : formatGridBytes(value);
}

function formatInteger(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

function formatByteRate(value: number | null): string {
  if (value === null) return "—";
  if (value < 1024) return `${value.toFixed(0)} B/s`;
  const kilobytes = value / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes >= 100 ? 0 : 1)} KB/s`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} MB/s`;
}

function formatCounterRate(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}/s`;
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
  const [chartRef, width] = useElementWidth();
  const fillId = `metric-fill-${kind}`;
  const paths = values ? buildSparkline(values, yMin, yMax, width, CHART_H, MAX_SAMPLES) : null;

  return (
    <div className="flex flex-col border-t border-divider px-5 py-4">
      <div className="flex items-center gap-2">
        <GlyphIcon kind={kind} color="var(--color-fg-3)" />
        <span className="text-body font-semibold text-fg">{label}</span>
        {/* The threshold signal lives in a small dot — the number stays neutral,
            because a value is data and data has no colour in this system. */}
        <span
          className="ml-auto size-1.5 shrink-0 rounded-full"
          style={{ background: color } as CSSProperties}
          aria-hidden
        />
      </div>
      <div className="mt-2.5 flex items-baseline gap-1">
        <span className="font-mono text-display leading-none tabular-nums text-fg">{value}</span>
        {unit ? <span className="font-mono text-value text-fg-3">{unit}</span> : null}
      </div>
      <div ref={chartRef} className="mt-3" style={{ height: CHART_H }}>
        {width > 0 ? (
          <svg
            width={width}
            height={CHART_H}
            viewBox={`0 0 ${width} ${CHART_H}`}
            className="block"
            aria-hidden
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-fg-3)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--color-fg-3)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <line
              x1="0"
              y1={CHART_H - 4}
              x2={width}
              y2={CHART_H - 4}
              stroke="var(--color-divider)"
              strokeWidth="1"
            />
            {paths ? (
              <>
                <path d={paths.area} fill={`url(#${fillId})`} stroke="none" />
                <path
                  d={paths.line}
                  fill="none"
                  stroke="var(--color-fg-2)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle cx={paths.tip[0]} cy={paths.tip[1]} r="2.6" fill="var(--color-fg)" />
                <circle
                  cx={paths.tip[0]}
                  cy={paths.tip[1]}
                  r="2.6"
                  fill="none"
                  stroke="var(--color-fg)"
                  strokeOpacity={0.22}
                  strokeWidth="3.5"
                />
              </>
            ) : null}
          </svg>
        ) : null}
      </div>
    </div>
  );
}

function GlyphIcon({ kind, color }: { kind: "cpu" | "mem"; color: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
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
