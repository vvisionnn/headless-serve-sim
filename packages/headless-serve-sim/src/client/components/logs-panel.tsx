import { useEffect, useMemo, useRef, useState } from "react";
import type { SimLogLevel } from "../../sim-log-stream";
import { Panel, PanelCloseButton, PanelHeader, PanelTitle } from "../Panel";
import { useSimLogs, type SimLogsStatus } from "../hooks/use-sim-logs";
import { filterSimLogs, simLogProcesses, type SimLogEntry } from "../utils/sim-logs";

const MAX_RENDERED_ROWS = 800;

const STATUS_LABELS: Record<SimLogsStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  paused: "Paused",
  unavailable: "Unavailable",
  waiting: "Waiting for app",
};

const STATUS_COLORS: Record<SimLogsStatus, string> = {
  connecting: "var(--color-warning)",
  live: "var(--color-success)",
  reconnecting: "var(--color-warning)",
  paused: "var(--color-fg-3)",
  unavailable: "var(--color-danger)",
  waiting: "var(--color-fg-3)",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

function displayTimestamp(timestamp: string): string {
  const match = timestamp.match(/(?:^|\s)(\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)/);
  return match?.[1] ?? timestamp;
}

function levelColor(level: string): string {
  if (level === "error" || level === "fault") return "var(--color-danger)";
  if (level === "debug") return "var(--color-fg-3)";
  return "var(--color-fg-2)";
}

export function SimLogRows({ entries }: { entries: readonly SimLogEntry[] }) {
  return (
    <>
      {entries.map((entry) => {
        const source = [entry.subsystem, entry.category].filter(Boolean).join(":");
        return (
          <div
            key={entry.id}
            className="grid grid-cols-[104px_72px_minmax(112px,0.42fr)_minmax(0,1fr)] items-start gap-2 border-b border-divider px-3 py-1.5 font-mono text-[11px] leading-[1.45] last:border-b-0"
            data-log-level={entry.level}
          >
            <time
              className="whitespace-nowrap text-fg-3 [font-variant-numeric:tabular-nums]"
              title={entry.timestamp}
            >
              {displayTimestamp(entry.timestamp) || "—"}
            </time>
            <span className="truncate font-semibold" style={{ color: levelColor(entry.level) }}>
              {entry.level}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-fg" title={entry.process}>
                {entry.process || "Simulator"}
              </span>
              {source && (
                <span className="block truncate text-fg-3" title={source}>
                  {source}
                </span>
              )}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words text-fg select-text">
              {entry.message}
            </span>
          </div>
        );
      })}
    </>
  );
}

export function LogsPanel({
  open,
  onClose,
  endpoint,
  appProcessId,
  width,
}: {
  open: boolean;
  onClose: () => void;
  endpoint?: string;
  appProcessId: number | null;
  width: number;
}) {
  const [includeSystem, setIncludeSystem] = useState(false);
  const logs = useSimLogs(endpoint, { appProcessId, includeSystem });
  const [search, setSearch] = useState("");
  const [process, setProcess] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const followTailRef = useRef(true);

  const scoped = useMemo(
    () =>
      filterSimLogs(logs.entries, {
        search: "",
        process: "",
        appProcessId,
        includeSystem,
      }),
    [appProcessId, includeSystem, logs.entries],
  );
  const processes = useMemo(() => simLogProcesses(scoped), [scoped]);
  const filtered = useMemo(
    () =>
      filterSimLogs(logs.entries, {
        search,
        process,
        appProcessId,
        includeSystem,
      }),
    [appProcessId, includeSystem, logs.entries, search, process],
  );
  const rendered = filtered.slice(-MAX_RENDERED_ROWS);
  const omitted = filtered.length - rendered.length;
  const lastRenderedId = rendered.at(-1)?.id;

  useEffect(() => {
    if (process && !processes.includes(process)) setProcess("");
  }, [process, processes]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (followTailRef.current && scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [lastRenderedId]);

  const clear = () => {
    logs.clear();
    setProcess("");
    followTailRef.current = true;
  };

  return (
    <Panel open={open} width={width}>
      <PanelHeader>
        <div className="flex min-w-0 items-center gap-3">
          <PanelTitle>Logs</PanelTitle>
          <span
            className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-fg-2"
            role="status"
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: STATUS_COLORS[logs.status] }}
              aria-hidden="true"
            />
            <span className="truncate">{STATUS_LABELS[logs.status]}</span>
          </span>
        </div>
        <PanelCloseButton onClick={onClose} ariaLabel="Close logs panel" />
      </PanelHeader>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-divider bg-surface-2 px-3 py-2.5">
        <label className="relative min-w-[180px] flex-1">
          <span className="sr-only">Search logs</span>
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            aria-label="Search logs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search message or source"
            className="h-8 w-full rounded-card border border-divider bg-panel pl-8 pr-2.5 text-[12px] text-fg outline-none placeholder:text-fg-3 focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
          />
        </label>
        <select
          aria-label="Capture level"
          value={logs.level}
          onChange={(event) => logs.setLevel(event.target.value as SimLogLevel)}
          className="h-8 rounded-card border border-divider bg-panel px-2 text-[12px] text-fg outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
        >
          <option value="default">Default</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
        <select
          aria-label="Filter by process"
          value={process}
          onChange={(event) => setProcess(event.target.value)}
          className="h-8 max-w-[180px] rounded-card border border-divider bg-panel px-2 text-[12px] text-fg outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
        >
          <option value="">All processes</option>
          {processes.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <label className="flex h-8 cursor-pointer items-center gap-2 rounded-pill border border-divider bg-panel px-3 text-[12px] font-medium text-fg-2 hover:bg-hover">
          <input
            type="checkbox"
            aria-label="Include system logs"
            checked={includeSystem}
            onChange={(event) => setIncludeSystem(event.target.checked)}
            className="size-3.5 accent-[var(--color-accent-solid)]"
          />
          System logs
        </label>
        <button
          type="button"
          onClick={() => logs.setPaused((paused) => !paused)}
          disabled={!endpoint}
          aria-pressed={logs.paused}
          className="h-8 cursor-pointer rounded-pill border border-divider bg-panel px-3 text-[12px] font-medium text-fg-2 hover:bg-hover disabled:cursor-not-allowed disabled:text-fg-3 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
        >
          {logs.paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={logs.entries.length === 0}
          className="h-8 cursor-pointer rounded-pill border border-divider bg-panel px-3 text-[12px] font-medium text-fg-2 hover:bg-hover disabled:cursor-not-allowed disabled:text-fg-3 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
        >
          Clear
        </button>
      </div>

      <div className="flex shrink-0 items-center justify-between border-b border-divider px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.05em] text-fg-3">
        <span>
          {filtered.length} shown · {logs.entries.length} retained
        </span>
        <span>{formatBytes(logs.totalBytes)}</span>
      </div>

      <div
        ref={scrollerRef}
        role="log"
        aria-live="off"
        aria-label="Simulator logs"
        onScroll={(event) => {
          const element = event.currentTarget;
          followTailRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 64;
        }}
        className="min-h-0 flex-1 overflow-auto bg-panel-deep"
      >
        {omitted > 0 && (
          <div className="border-b border-divider px-3 py-2 text-center text-[11px] text-fg-3">
            {omitted} older matching rows hidden for performance
          </div>
        )}
        {rendered.length > 0 ? (
          <SimLogRows entries={rendered} />
        ) : (
          <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center text-[12px] text-fg-3">
            {logs.entries.length > 0
              ? "No logs match the current filters."
              : logs.status === "waiting"
                ? "Waiting for a foreground app…"
                : logs.paused
                  ? "Capture is paused."
                  : "Waiting for simulator logs…"}
          </div>
        )}
      </div>
    </Panel>
  );
}
