import { formatGridBytes, type MemoryReport } from "../utils/grid";

export function GridCapacityBanner({ report }: { report: MemoryReport | null }) {
  if (!report || report.totalBytes === 0) return null;
  const { estimatedAdditional, availableBytes, totalBytes, runningSimulators } = report;
  const usedFraction = Math.max(0, Math.min(1, 1 - availableBytes / totalBytes));
  const capacity = runningSimulators + estimatedAdditional;
  const dotColor =
    estimatedAdditional === 0
      ? "var(--color-danger)"
      : estimatedAdditional <= 1
        ? "var(--color-warning)"
        : "var(--color-success)";
  const barColor =
    usedFraction > 0.9
      ? "var(--color-danger)"
      : usedFraction > 0.75
        ? "var(--color-warning)"
        : "var(--color-success)";
  return (
    <div className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 bg-surface-3 border border-divider font-mono text-[11px] text-fg-2 leading-none tracking-[-0.01em]">
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: dotColor }} />
      <span>
        {runningSimulators}/{capacity} sims
      </span>
      <span className="text-fg-3">·</span>
      <span className="text-fg-2">{formatGridBytes(availableBytes)} free</span>
      <span
        aria-hidden
        className="ml-0.5 w-7 h-[3px] rounded-full bg-surface-2 overflow-hidden inline-block"
      >
        <span
          className="block h-full rounded-full transition-[width,background] duration-300 ease-[cubic-bezier(0.4,0,0.6,1)]"
          style={{
            width: `${(usedFraction * 100).toFixed(1)}%`,
            background: barColor,
          }}
        />
      </span>
    </div>
  );
}
