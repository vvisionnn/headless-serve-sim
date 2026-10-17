import { useEffect } from "react";
import {
  summarize,
  type ConnectionStats,
  type StreamConfig,
} from "headless-serve-sim-client/simulator";
import { useConnectionStats } from "../hooks/use-connection-stats";
import { Sparkline } from "../ui/area-chart";
import { Badge } from "../ui/badge";
import { InfoRow, Section } from "../ui/group";
import { Segmented } from "../ui/segmented";
import type { StreamMode } from "./stream-mode-toggle";

const fmt1 = (n: number) => n.toFixed(1);
const fmt0 = (n: number) => n.toFixed(0);
const fmtBitrate = (bps: number) =>
  bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : `${(bps / 1000).toFixed(0)} kbps`;
const fmtBitrateStat = (bps: number) =>
  bps >= 1_000_000 ? (bps / 1_000_000).toFixed(1) : `${(bps / 1000).toFixed(0)}k`;

/** "min · avg · max" under a tile; em dashes until there is data. */
export function statSpread(values: number[], fmt: (n: number) => string): string {
  if (values.length === 0) return "— · — · —";
  const s = summarize(values);
  return `${fmt(s.min)} · ${fmt(s.avg)} · ${fmt(s.max)}`;
}

/** Two-column tile grid with hairlines between cells, none on the outer edge. */
const grid =
  "grid grid-cols-2 [&>*:nth-child(odd)]:shadow-[inset_-0.5px_0_0_var(--separator)] [&>*:nth-child(n+3)]:border-t-[0.5px] [&>*:nth-child(n+3)]:border-separator";

function Tile({
  label,
  value,
  values,
  spread,
}: {
  label: string;
  value: string;
  values: number[];
  spread: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-3 pt-2 pb-2.5">
      <span className="text-caption text-label-3">{label}</span>
      <span className="font-mono text-body font-semibold tabular text-label">{value}</span>
      {values.length >= 2 ? <Sparkline data={values.slice(-24)} /> : <span className="h-6" />}
      <span className="font-mono text-caption2 tabular text-label-3">{spread}</span>
    </div>
  );
}

export function FrameDeliveryStats({ stats }: { stats: ConnectionStats }) {
  const srv = stats.server;
  return (
    <Section
      title="Frame delivery"
      footer={
        <>
          Capture offers include redraw and requested idle captures. Rates are measured separately.
          Idle frames are not loss. Server counts cover the helper lifetime; transport counts chunks
          across all viewers. Browser counts cover this stream, including frames superseded before
          painting.
        </>
      }
    >
      <InfoRow
        label="Capture offers"
        value={srv?.sourceFps != null ? `${fmt1(srv.sourceFps)} fps` : "—"}
      />
      <InfoRow label="Encoded" value={srv ? `${fmt1(srv.serverFps)} fps` : "—"} />
      <InfoRow label="Painted" value={`${fmt1(stats.fps)} fps`} />
      <InfoRow label="Capture skipped" value={String(srv?.captureDroppedFrames ?? "—")} />
      <InfoRow label="Encoder lost" value={String(srv?.encoderDroppedFrames ?? "—")} />
      <InfoRow label="Transport skipped" value={String(srv?.transportDroppedChunks ?? "—")} />
      <InfoRow label="Browser discarded" value={String(stats.droppedFrames)} />
    </Section>
  );
}

// Server-side adaptive state (target bitrate / QP / congestion) + client
// recovery counters — what the encoder is doing in response to link conditions.
function AdaptiveSection({ stats }: { stats: ConnectionStats | null }) {
  const srv = stats?.server ?? null;
  const kfMs = stats?.keyframeIntervalMs ?? null;
  const recoveries = stats?.recoveries ?? 0;
  return (
    <Section title="Adaptive">
      <InfoRow
        label="Link"
        value={
          srv ? (
            <span className={srv.congested ? "text-orange" : undefined}>
              {srv.congested ? "Congested" : "Clear"}
            </span>
          ) : (
            "—"
          )
        }
      />
      <InfoRow label="Target bitrate" value={srv ? fmtBitrate(srv.targetBitrateBps) : "—"} />
      <InfoRow label="Max QP" value={srv ? String(srv.maxQP) : "—"} />
      <InfoRow
        label="Queue"
        value={
          srv ? (
            <span className={srv.queueMs > 50 ? "text-orange" : undefined}>{srv.queueMs} ms</span>
          ) : (
            "—"
          )
        }
      />
      <InfoRow
        label="Keyframes"
        value={kfMs != null ? `every ${(kfMs / 1000).toFixed(1)} s` : "—"}
      />
      <InfoRow
        label="Recoveries"
        value={<span className={recoveries > 0 ? "text-orange" : undefined}>{recoveries}</span>}
      />
    </Section>
  );
}

export interface StreamStatsProps {
  live: boolean;
  codecMode: "avcc" | "mjpeg";
  streamConfig: StreamConfig | null;
  /** SimulatorView's onConnectionStats is routed here so only this section — not
   * the whole app tree — re-renders on the 1 Hz emit. */
  sinkRef: { current: ((snap: ConnectionStats) => void) | null };
  /** Current perf/quality streaming mode + setter (H.264 only). */
  mode: StreamMode;
  modeAvailable?: boolean;
  onModeChange: (mode: StreamMode) => void;
}

/** The Activity tab's "Stream" section, plus frame delivery and adaptive state for H.264. */
export function StreamStats({
  live,
  codecMode,
  streamConfig,
  sinkRef,
  mode,
  modeAvailable = codecMode === "avcc",
  onModeChange,
}: StreamStatsProps) {
  const { latest, history, record } = useConnectionStats(true);

  useEffect(() => {
    sinkRef.current = record;
    return () => {
      if (sinkRef.current === record) sinkRef.current = null;
    };
  }, [record, sinkRef]);

  const hasData = history.fps.length > 0 && latest != null;
  const codecLabel = latest?.codec ?? (codecMode === "avcc" ? "H.264" : "MJPEG");
  const resolution = streamConfig ? `${streamConfig.width}×${streamConfig.height}` : "—";
  const decode = latest?.decodeMs ?? null;
  const dropped = latest?.droppedFrames ?? 0;

  return (
    <>
      <Section
        title="Stream"
        accessory={
          <span className="flex min-w-0 items-center gap-1.5">
            <Badge tone={live ? "green" : "neutral"} dot>
              {live ? "Live" : "Offline"}
            </Badge>
            <Badge className="max-w-[120px] truncate">{codecLabel}</Badge>
          </span>
        }
      >
        <div className="row flex min-h-10 items-center justify-between gap-2 px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-caption text-label-2">{resolution}</span>
            {dropped > 0 && (
              <span className="truncate font-mono text-caption2 text-orange">
                {dropped} discarded
              </span>
            )}
          </span>
          {modeAvailable && (
            <Segmented<StreamMode>
              aria-label="Stream mode"
              size="sm"
              className="w-[148px] shrink-0"
              value={mode}
              onChange={onModeChange}
              items={[
                { value: "perf", label: "Perf", disabled: !live },
                { value: "quality", label: "Quality", disabled: !live },
              ]}
            />
          )}
        </div>
        {hasData ? (
          <div className={`row ${grid}`}>
            <Tile
              label="Painted"
              value={`${fmt0(latest.fps)} fps`}
              values={history.fps}
              spread={statSpread(history.fps, fmt0)}
            />
            <Tile
              label="Bitrate"
              value={fmtBitrate(latest.bitrateBps)}
              values={history.bitrateBps}
              spread={statSpread(history.bitrateBps, fmtBitrateStat)}
            />
            <Tile
              label="Jitter"
              value={`${fmt1(latest.jitterMs)} ms`}
              values={history.jitterMs}
              spread={statSpread(history.jitterMs, fmt1)}
            />
            <Tile
              label="Decode"
              value={decode != null ? `${fmt1(decode)} ms` : "—"}
              values={decode != null ? history.decodeMs : []}
              spread={statSpread(decode != null ? history.decodeMs : [], fmt1)}
            />
          </div>
        ) : (
          <p className="row px-3 py-6 text-center text-footnote text-label-3">
            Waiting for stream…
          </p>
        )}
      </Section>
      {codecMode === "avcc" && latest && <FrameDeliveryStats stats={latest} />}
      {codecMode === "avcc" && hasData && <AdaptiveSection stats={latest} />}
    </>
  );
}
