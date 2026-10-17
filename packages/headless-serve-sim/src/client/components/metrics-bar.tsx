import { Cpu, MemoryStick } from "lucide-react";
import type { ReactNode } from "react";
import type { AppMetrics, AppMetricsStream } from "../hooks/use-app-metrics";
import { AreaChart } from "../ui/area-chart";
import { StatusDot } from "../ui/badge";
import { Section } from "../ui/group";
import { RollingNumber } from "../ui/rolling-number";
import { formatGridBytes } from "../utils/grid";
import { cpuTone, memoryRange } from "../utils/metrics-chart";

// The Activity tab's app half. The two gauges chart the foreground app's
// native CPU and physical footprint; the counter grid exposes every additional
// native counter without conflating app performance with stream telemetry.

/** Two-column tile grid with hairlines between cells, none on the outer edge. */
const grid =
  "grid grid-cols-2 [&>*:nth-child(odd)]:shadow-[inset_-0.5px_0_0_var(--separator)] [&>*:nth-child(n+3)]:border-t-[0.5px] [&>*:nth-child(n+3)]:border-separator";

const CHART_H = 72;

export function MetricsDashboard({ stream }: { stream: AppMetricsStream }) {
  const metrics = stream.latest;
  const alive = metrics?.alive === true;
  const cpu = alive ? metrics.cpuPercent : null;
  const footprint = alive ? (metrics.memoryFootprintBytes ?? 0) : 0;
  const cpuValues = stream.samples.flatMap((sample) =>
    sample.cpuPercent === null ? [] : [sample.cpuPercent],
  );
  const memoryValues = stream.samples.map((sample) => sample.memoryFootprintBytes);
  const { yMin: memoryMin, yMax: memoryMax } = memoryRange(memoryValues, footprint);
  // Scroll the trace once per sample, keyed on the sample time.
  const tick = metrics?.sampledAtMs ?? 0;

  return (
    <>
      <AppIdentity metrics={metrics} error={stream.error} />
      <Gauge
        icon={<Cpu />}
        label="CPU"
        tone={cpuTone(cpu)}
        value={cpu === null ? "—" : `${cpu.toFixed(cpu >= 100 ? 0 : 1)}%`}
      >
        {alive && cpuValues.length >= 3 ? (
          <AreaChart
            data={cpuValues}
            max={Math.max(100, ...cpuValues)}
            tick={tick}
            height={CHART_H}
          />
        ) : null}
      </Gauge>
      <Gauge
        icon={<MemoryStick />}
        label="Memory"
        tone={alive ? "green" : "neutral"}
        value={alive ? formatGridBytes(footprint) : "—"}
      >
        {alive && memoryValues.length >= 3 ? (
          <AreaChart
            data={memoryValues}
            min={memoryMin}
            max={memoryMax}
            tick={tick}
            height={CHART_H}
          />
        ) : null}
      </Gauge>
      <Section title="Counters">
        <MetricDetails metrics={alive ? metrics : null} />
      </Section>
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
  const tone = unavailable ? "red" : alive ? "green" : "neutral";
  const statusColor = { red: "text-red", green: "text-green", neutral: "text-label-3" }[tone];
  const sampledAt = metrics ? new Date(metrics.sampledAtMs) : null;

  return (
    <div className="group-box flex items-center gap-2.5 px-3 py-2.5">
      {/* Announce identity and status only — the sample time changes every
          second and would make screen readers chatter. */}
      <span role="status" className="sr-only">
        {label} · {status}
      </span>
      <span className="flex min-w-0 flex-1 flex-col" aria-hidden>
        <span className="truncate text-body font-semibold text-label" title={label}>
          {label}
        </span>
        <span className="font-mono text-caption text-label-3">
          {alive ? `PID ${metrics.pid}` : "PID —"}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span
          aria-hidden
          className={`flex items-center gap-1.5 text-footnote font-semibold ${statusColor}`}
        >
          <StatusDot tone={tone} live={alive} /> {status}
        </span>
        {sampledAt && (
          <span className="font-mono text-caption2 text-label-3">
            Updated{" "}
            <time dateTime={sampledAt.toISOString()}>{sampledAt.toTimeString().slice(0, 8)}</time>
          </span>
        )}
      </span>
    </div>
  );
}

function MetricDetails({ metrics }: { metrics: AppMetrics | null }) {
  return (
    <div className={grid} role="group" aria-label="App metric details">
      <Detail label="User CPU" value={formatPercent(metrics?.cpuUserPercent ?? null)} />
      <Detail label="System CPU" value={formatPercent(metrics?.cpuSystemPercent ?? null)} />
      <Detail
        label="Peak footprint"
        value={formatBytes(metrics?.peakMemoryFootprintBytes ?? null)}
      />
      <Detail label="Resident memory" value={formatBytes(metrics?.residentBytes ?? null)} />
      <Detail label="Threads" value={formatInteger(metrics?.threadCount ?? null)} />
      <Detail label="Running" value={formatInteger(metrics?.runningThreadCount ?? null)} />
      <Detail label="Disk read" value={formatByteRate(metrics?.diskReadBytesPerSecond ?? null)} />
      <Detail label="Disk write" value={formatByteRate(metrics?.diskWriteBytesPerSecond ?? null)} />
      <Detail label="Wakeups" value={formatCounterRate(metrics?.wakeupsPerSecond ?? null)} />
      <Detail label="Page-ins" value={formatCounterRate(metrics?.pageInsPerSecond ?? null)} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
      <span className="text-caption text-label-3">{label}</span>
      <span
        className="truncate font-mono text-footnote font-medium tabular text-label"
        title={value}
      >
        {value}
      </span>
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
  icon,
  label,
  tone,
  value,
  children,
}: {
  icon: ReactNode;
  label: string;
  tone: "neutral" | "green" | "orange" | "red";
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="group-box flex flex-col gap-2 p-3">
      <div className="flex items-center gap-1.5 text-label-2 [&_svg]:size-[14px] [&_svg]:stroke-[2]">
        {icon}
        <span className="text-headline text-label">{label}</span>
        {/* The threshold signal lives in a small dot — the number stays neutral,
            because a value is data and data has no colour in this system. */}
        <StatusDot tone={tone} className="ml-auto" />
      </div>
      <RollingNumber value={value} className="font-display text-numeral text-label" />
      {children ?? <div style={{ height: CHART_H }} aria-hidden />}
    </div>
  );
}
