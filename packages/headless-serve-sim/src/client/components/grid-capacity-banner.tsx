import { formatGridBytes, type MemoryReport } from "../utils/grid";

export function GridCapacityBanner({ report }: { report: MemoryReport | null }) {
  if (!report || report.totalBytes === 0) return null;
  const { estimatedAdditional, availableBytes, totalBytes, runningSimulators } = report;
  const usedFraction = Math.max(0, Math.min(1, 1 - availableBytes / totalBytes));
  const capacity = runningSimulators + estimatedAdditional;
  const dotColor =
    estimatedAdditional === 0 ? "#ff453a" : estimatedAdditional <= 1 ? "#ffd60a" : "#30d158";
  const barColor =
    usedFraction > 0.9 ? "#ff453a" : usedFraction > 0.75 ? "#ffd60a" : "#30d158";
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-surface-3 border border-divider font-mono text-[11px] text-fg-2 leading-none">
      <span className="size-1.5 shrink-0" style={{ background: dotColor }} />
      <span>{runningSimulators}/{capacity} sims</span>
      <span className="text-fg-3">·</span>
      <span className="text-fg-2">{formatGridBytes(availableBytes)} free</span>
      <span aria-hidden className="ml-0.5 w-7 h-[3px] bg-surface-2 overflow-hidden inline-block">
        <span
          className="block h-full transition-[width,background] duration-300 ease-out"
          style={{
            width: `${(usedFraction * 100).toFixed(1)}%`,
            background: barColor,
          }}
        />
      </span>
    </div>
  );
}
