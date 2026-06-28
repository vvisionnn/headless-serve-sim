import { useEffect } from "react";
import {
  summarize,
  type ConnectionStats,
  type StreamConfig,
} from "headless-serve-sim-client/simulator";
import { Panel, PanelCloseButton, PanelHeader, PanelTitle } from "../Panel";
import { useConnectionStats } from "../hooks/use-connection-stats";

// Per-metric trace colors — identity colors mapped to the design-system status
// tokens so each trace reads at a glance.
const C_FPS = "var(--color-success)"; // green
const C_BITRATE = "var(--color-accent)"; // blue
const C_JITTER = "var(--color-warning)"; // amber
const C_DECODE = "var(--color-accent)"; // blue

const fmt1 = (n: number) => n.toFixed(1);
const fmt0 = (n: number) => n.toFixed(0);
const bitrateUnit = (bps: number) => (bps >= 1_000_000 ? "Mbps" : "kbps");
const fmtBitrate = (bps: number) =>
  bps >= 1_000_000 ? (bps / 1_000_000).toFixed(1) : (bps / 1000).toFixed(0);
const fmtBitrateStat = (bps: number) =>
  bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)}M` : `${(bps / 1000).toFixed(0)}k`;
const fmtBitrateChip = (bps: number) => `${fmtBitrate(bps)} ${bitrateUnit(bps)}`;

const SPARK_W = 100;
const SPARK_H = 34;

// Right-to-left trace stretched to fill the card width (preserveAspectRatio
// "none" + non-scaling strokes keep the line crisp). Auto-zooms to the window
// with padding so a flat series reads flat and small wiggles stay visible.
function buildSparkPath(values: number[]) {
  const n = values.length;
  if (n < 2) return null;
  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  let yMin: number;
  let yMax: number;
  if (range < 1e-6) {
    yMin = min - 1;
    yMax = max + 1;
  } else {
    const pad = range * 0.18;
    yMin = min - pad;
    yMax = max + pad;
  }
  const span = yMax - yMin || 1;
  const dx = SPARK_W / (n - 1);
  const pts = values.map((v, i) => {
    const x = i * dx;
    const y = SPARK_H - ((v - yMin) / span) * SPARK_H;
    return [x, y] as const;
  });
  const coords = pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`);
  const first = pts[0]!;
  const last = pts[n - 1]!;
  return {
    line: `M${coords.join(" L")}`,
    area: `M${first[0].toFixed(2)} ${SPARK_H} L${coords.join(" L")} L${last[0].toFixed(2)} ${SPARK_H} Z`,
  };
}

function Sparkline({ values, color, gradId }: { values: number[]; color: string; gradId: string }) {
  const paths = buildSparkPath(values);
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      width="100%"
      height={SPARK_H}
      className="block overflow-visible"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.26" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Scope baseline + midline */}
      <line x1="0" y1={SPARK_H - 0.5} x2={SPARK_W} y2={SPARK_H - 0.5} stroke="var(--color-divider)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1="0" y1={SPARK_H / 2} x2={SPARK_W} y2={SPARK_H / 2} stroke="var(--color-divider)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
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
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  );
}

function MetricCard({
  label,
  unit,
  color,
  gradId,
  current,
  values,
  fmtValue,
  fmtStat,
}: {
  label: string;
  unit: string;
  color: string;
  gradId: string;
  current: number | null;
  values: number[];
  fmtValue: (n: number) => string;
  fmtStat: (n: number) => string;
}) {
  const s = summarize(values);
  const hasData = values.length > 0 && current != null;
  return (
    <div className="flex flex-col gap-2 border-b border-divider pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-semibold text-fg-3">{label}</span>
        <span className="text-[11px] text-fg-3">{unit}</span>
      </div>
      <div className="flex items-end gap-2.5">
        <span
          className="shrink-0 text-[27px] leading-none tracking-[-0.02em] [font-variant-numeric:tabular-nums]"
          style={{ color }}
        >
          {hasData ? fmtValue(current) : "—"}
        </span>
        <div className="min-w-0 flex-1 pb-0.5">
          <Sparkline values={values} color={color} gradId={gradId} />
        </div>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-fg-3 [font-variant-numeric:tabular-nums]">
        <span>min {hasData ? fmtStat(s.min) : "—"}</span>
        <span>avg {hasData ? fmtStat(s.avg) : "—"}</span>
        <span>max {hasData ? fmtStat(s.max) : "—"}</span>
      </div>
    </div>
  );
}

function StatusStrip({
  live,
  codecLabel,
  resolution,
  dropped,
}: {
  live: boolean;
  codecLabel: string;
  resolution: string | null;
  dropped: number;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-card border border-divider bg-surface-2 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{
              background: live ? C_FPS : "var(--color-fg-3)",
              animation: live ? "hud-pulse 1.6s ease-in-out infinite" : "none",
            }}
          />
          <span
            className="text-[12px] font-semibold"
            style={{ color: live ? C_FPS : "var(--color-fg-3)" }}
          >
            {live ? "Live" : "Offline"}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-fg-2 [font-variant-numeric:tabular-nums]">
          <span className="min-w-0 truncate">{codecLabel}</span>
          {resolution && (
            <>
              <span className="shrink-0 text-fg-3">·</span>
              <span className="shrink-0">{resolution}</span>
            </>
          )}
        </div>
      </div>
      {dropped > 0 && (
        <div className="text-[11px] font-medium text-warning [font-variant-numeric:tabular-nums]">
          {dropped} dropped
        </div>
      )}
    </div>
  );
}

function ModeToggle({
  mode,
  onModeChange,
}: {
  mode: "perf" | "quality";
  onModeChange: (mode: "perf" | "quality") => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">Mode</span>
      <div className="flex flex-1 gap-0.5 rounded-pill border border-divider bg-surface-2 p-0.5">
        {(["perf", "quality"] as const).map((m) => {
          const active = mode === m;
          const accent = m === "quality" ? C_DECODE : C_FPS;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              aria-pressed={active}
              className="flex-1 rounded-pill px-3 py-1.5 text-[12px] font-semibold [transition:background-color_0.3s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
              style={
                active
                  ? { background: "var(--color-hover)", color: accent }
                  : { color: "var(--color-fg-3)" }
              }
            >
              {m === "perf" ? "Perf" : "Quality"}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-fg-3">{label}</span>
      <span
        className="text-[12px] [font-variant-numeric:tabular-nums]"
        style={{ color: accent ?? "var(--color-fg)" }}
      >
        {value}
      </span>
    </div>
  );
}

// Server-side adaptive state (target bitrate / QP / congestion) + client
// recovery counters — what the encoder is doing in response to link conditions.
function AdaptiveSection({ stats }: { stats: ConnectionStats | null }) {
  const srv = stats?.server ?? null;
  const kfMs = stats?.keyframeIntervalMs ?? null;
  const recoveries = stats?.recoveries ?? 0;
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-divider bg-surface-2 px-3 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">Adaptive</span>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <StatRow
          label="Link"
          value={srv ? (srv.congested ? "Congested" : "Clear") : "—"}
          accent={srv ? (srv.congested ? C_JITTER : C_FPS) : undefined}
        />
        <StatRow label="Target" value={srv ? fmtBitrateChip(srv.targetBitrateBps) : "—"} accent={srv ? C_BITRATE : undefined} />
        <StatRow label="Enc fps" value={srv ? String(srv.serverFps) : "—"} />
        <StatRow label="Max QP" value={srv ? String(srv.maxQP) : "—"} />
        <StatRow label="Keyframe" value={kfMs != null ? `${(kfMs / 1000).toFixed(1)}s` : "—"} />
        <StatRow label="Recover" value={String(recoveries)} accent={recoveries > 0 ? C_JITTER : undefined} />
      </div>
    </div>
  );
}

export function ConnectionStatsPanel({
  open,
  onClose,
  width,
  live,
  codecMode,
  streamConfig,
  sinkRef,
  mode,
  onModeChange,
}: {
  open: boolean;
  onClose: () => void;
  width: number;
  live: boolean;
  codecMode: "avcc" | "mjpeg";
  streamConfig: StreamConfig | null;
  /** SimulatorView's onConnectionStats is routed here so only this panel — not
   * the whole app tree — re-renders on the 1 Hz emit. */
  sinkRef: { current: ((snap: ConnectionStats) => void) | null };
  /** Current perf/quality streaming mode + setter (H.264 only). */
  mode: "perf" | "quality";
  onModeChange: (mode: "perf" | "quality") => void;
}) {
  const { latest, history, record } = useConnectionStats(open);

  useEffect(() => {
    sinkRef.current = record;
    return () => {
      if (sinkRef.current === record) sinkRef.current = null;
    };
  }, [record, sinkRef]);

  const hasData = history.fps.length > 0;
  const codecLabel = latest?.codec ?? (codecMode === "avcc" ? "H.264" : "MJPEG");
  const resolution = streamConfig ? `${streamConfig.width}×${streamConfig.height}` : null;
  const decodeAvailable = latest?.decodeMs != null;

  return (
    <Panel open={open} width={width}>
      <PanelHeader>
        <PanelTitle>Connection</PanelTitle>
        <PanelCloseButton onClick={onClose} ariaLabel="Close connection stats" />
      </PanelHeader>

      {open && (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 select-none">
          <StatusStrip
            live={live}
            codecLabel={codecLabel}
            resolution={resolution}
            dropped={latest?.droppedFrames ?? 0}
          />

          {codecMode === "avcc" && <ModeToggle mode={mode} onModeChange={onModeChange} />}

          {hasData ? (
            <div className="flex flex-col gap-3">
              <MetricCard
                label="Frames / sec"
                unit="fps"
                color={C_FPS}
                gradId="cstat-grad-fps"
                current={latest?.fps ?? null}
                values={history.fps}
                fmtValue={fmt1}
                fmtStat={fmt0}
              />
              <MetricCard
                label="Bitrate"
                unit={latest ? bitrateUnit(latest.bitrateBps) : "Mb/s"}
                color={C_BITRATE}
                gradId="cstat-grad-bitrate"
                current={latest?.bitrateBps ?? null}
                values={history.bitrateBps}
                fmtValue={fmtBitrate}
                fmtStat={fmtBitrateStat}
              />
              <MetricCard
                label="Frame jitter"
                unit="ms"
                color={C_JITTER}
                gradId="cstat-grad-jitter"
                current={latest?.jitterMs ?? null}
                values={history.jitterMs}
                fmtValue={fmt1}
                fmtStat={fmt1}
              />
              <MetricCard
                label="Decode time"
                unit="ms"
                color={C_DECODE}
                gradId="cstat-grad-decode"
                current={decodeAvailable ? (latest?.decodeMs ?? null) : null}
                values={decodeAvailable ? history.decodeMs : []}
                fmtValue={fmt1}
                fmtStat={fmt1}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-10 text-center text-[13px] text-fg-3">
              Waiting for stream…
            </div>
          )}

          {codecMode === "avcc" && hasData && <AdaptiveSection stats={latest} />}
        </div>
      )}
    </Panel>
  );
}
