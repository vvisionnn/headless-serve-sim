import { Menu } from "@base-ui/react/menu";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SimLogLevel } from "../../sim-log-stream";
import type { SimLogsStatus, UseSimLogsResult } from "../hooks/use-sim-logs";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { TextField } from "../ui/field";
import { filterSimLogs, simLogProcesses, type SimLogEntry } from "../utils/sim-logs";

const MAX_RENDERED_ROWS = 800;
/** Within this distance of the bottom the list keeps following new rows. */
const FOLLOW_SLACK = 64;
const ALL_PROCESSES = "All processes";

export const LOG_STATUS: Record<
  SimLogsStatus,
  { label: string; tone: "green" | "orange" | "red" | "neutral" }
> = {
  connecting: { label: "Connecting", tone: "orange" },
  live: { label: "Live", tone: "green" },
  reconnecting: { label: "Reconnecting", tone: "orange" },
  paused: { label: "Paused", tone: "neutral" },
  unavailable: { label: "Unavailable", tone: "red" },
  waiting: { label: "Waiting for app", tone: "neutral" },
};

const LEVELS: { value: SimLogLevel; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

function displayTimestamp(timestamp: string): string {
  const match = timestamp.match(/(?:^|\s)(\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)/);
  return match?.[1] ?? timestamp;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="rounded-[3px] bg-ink/12 px-px text-label">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Capsule filter chip that opens a radio menu — ReUI Filters shape. */
function FilterChip<T extends string>({
  field,
  label,
  value,
  options,
  onChange,
}: {
  field: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className="inline-flex h-6 max-w-[220px] shrink-0 items-center gap-1.5 rounded-full bg-fill-3 pr-1.5 pl-2.5 text-footnote shadow-[inset_0_0_0_0.5px_var(--separator)] outline-none transition-colors hover:bg-fill-2 focus-visible:outline-2 focus-visible:outline-[var(--focus)] data-[popup-open]:bg-fill-2"
      >
        <span className="text-label-3">{field}</span>
        <span className="truncate font-medium text-label">{current}</span>
        <ChevronDown className="size-3 shrink-0 text-label-3" strokeWidth={2.4} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start" className="z-[80] outline-none">
          <Menu.Popup className="glass-pop menu-pop thin-scrollbar max-h-[min(360px,var(--available-height))] min-w-[168px] origin-[var(--transform-origin)] overflow-y-auto rounded-[12px] p-[5px] outline-none">
            <Menu.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
              {options.map((o) => (
                <Menu.RadioItem
                  key={o.value}
                  value={o.value}
                  className="grid min-h-7 cursor-default grid-cols-[16px_1fr] items-center gap-1.5 rounded-[7px] pr-3 pl-1.5 text-body text-label outline-none select-none data-[highlighted]:bg-ink data-[highlighted]:text-on-ink"
                >
                  <Menu.RadioItemIndicator className="col-start-1 flex">
                    <Check className="size-[13px]" strokeWidth={2.5} />
                  </Menu.RadioItemIndicator>
                  <span className="col-start-2 truncate">{o.label}</span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ToggleChip({
  on,
  onChange,
  label,
  children,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      aria-label={label}
      whileTap={{ scale: 0.95 }}
      transition={spring.snappy}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-footnote font-medium whitespace-nowrap transition-colors duration-200",
        on
          ? "bg-ink text-on-ink"
          : "bg-fill-3 text-label-2 shadow-[inset_0_0_0_0.5px_var(--separator)] hover:bg-fill-2",
      )}
    >
      <span
        className={cn("size-1.5 rounded-full transition-colors", on ? "bg-on-ink" : "bg-label-3")}
      />
      {children}
    </motion.button>
  );
}

function LevelTag({ level }: { level: string }) {
  if (level === "default") return <span className="text-label-3">—</span>;
  const tone =
    level === "error" || level === "fault"
      ? "font-semibold text-red"
      : level === "info"
        ? "text-label-2"
        : "text-label-3";
  return <span className={cn("text-caption tracking-[0.02em] uppercase", tone)}>{level}</span>;
}

export function SimLogRows({
  entries,
  query = "",
  fresh,
}: {
  entries: readonly SimLogEntry[];
  query?: string;
  /** Ids that arrived after the list mounted; only these animate in. */
  fresh?: ReadonlySet<string>;
}) {
  return (
    <>
      {entries.map((entry) => {
        const source = [entry.subsystem, entry.category].filter(Boolean).join(":");
        const bad = entry.level === "error" || entry.level === "fault";
        return (
          <motion.div
            key={entry.id}
            data-log-level={entry.level}
            initial={fresh?.has(entry.id) ? { opacity: 0, y: 6 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.ui}
            className={cn(
              "grid min-h-7 grid-cols-[118px_52px_128px_minmax(0,1fr)] items-start gap-2 rounded-[7px] px-1.5 py-1 text-footnote transition-colors hover:bg-fill-3",
              bad && "bg-red/5 hover:bg-red/8",
            )}
          >
            <time
              className="truncate pt-px font-mono text-caption text-label-3 tabular-nums"
              title={entry.timestamp}
            >
              {displayTimestamp(entry.timestamp) || "—"}
            </time>
            <span className="pt-px">
              <LevelTag level={entry.level} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-label" title={entry.process}>
                <Highlight text={entry.process || "Simulator"} query={query} />
              </span>
              {source && (
                <span className="truncate text-caption text-label-3" title={source}>
                  {source}
                </span>
              )}
            </span>
            <span className="min-w-0 font-mono text-[11.5px]/[17px] break-words whitespace-pre-wrap text-label select-text">
              <Highlight text={entry.message} query={query} />
            </span>
          </motion.div>
        );
      })}
    </>
  );
}

export function LogsView({
  logs,
  endpoint,
  appProcessId,
  includeSystem,
  onIncludeSystemChange,
  clearToken,
}: {
  logs: UseSimLogsResult;
  endpoint: string | undefined;
  appProcessId: number | null;
  includeSystem: boolean;
  onIncludeSystemChange: (on: boolean) => void;
  /** Bumped by the header's Clear button. */
  clearToken: number;
}) {
  const [search, setSearch] = useState("");
  const [process, setProcess] = useState("");
  const [following, setFollowing] = useState(true);
  const scroller = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  const seen = useRef<Set<string> | null>(null);
  const query = search.trim();

  const scoped = useMemo(
    () => filterSimLogs(logs.entries, { search: "", process: "", appProcessId, includeSystem }),
    [appProcessId, includeSystem, logs.entries],
  );
  const processes = useMemo(() => simLogProcesses(scoped), [scoped]);
  const filtered = useMemo(
    () => filterSimLogs(logs.entries, { search, process, appProcessId, includeSystem }),
    [appProcessId, includeSystem, logs.entries, search, process],
  );
  const rendered = useMemo(() => filtered.slice(-MAX_RENDERED_ROWS), [filtered]);
  const omitted = filtered.length - rendered.length;
  const lastRenderedId = rendered.at(-1)?.id;

  // Rows on screen when the view mounts appear at once; later arrivals rise in.
  const fresh = useMemo(() => {
    const out = new Set<string>();
    if (seen.current) for (const e of rendered) if (!seen.current.has(e.id)) out.add(e.id);
    seen.current = new Set(rendered.map((e) => e.id));
    return out;
  }, [rendered]);

  useEffect(() => {
    if (process && !processes.includes(process)) setProcess("");
  }, [process, processes]);

  useEffect(() => {
    if (!clearToken) return;
    setProcess("");
    followRef.current = true;
    setFollowing(true);
  }, [clearToken]);

  useEffect(() => {
    const el = scroller.current;
    if (followRef.current && el) el.scrollTop = el.scrollHeight;
  }, [lastRenderedId]);

  const jumpToLatest = () => {
    followRef.current = true;
    setFollowing(true);
    const el = scroller.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const empty =
    logs.entries.length > 0
      ? "No logs match the current filters."
      : !includeSystem && appProcessId === null
        ? "Waiting for a foreground app…"
        : logs.paused
          ? "Capture is paused."
          : endpoint
            ? "Waiting for simulator logs…"
            : "Logs are unavailable for this simulator.";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-scrollbar flex h-10 shrink-0 items-center gap-2 overflow-x-auto px-2.5">
        <TextField
          leading={<Search />}
          type="search"
          aria-label="Search logs"
          placeholder="Search messages or processes"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-[280px] min-w-[160px] shrink"
        />
        <FilterChip
          field="Level"
          label="Capture level"
          value={logs.level}
          options={LEVELS}
          onChange={logs.setLevel}
        />
        <FilterChip
          field="Process"
          label="Filter by process"
          value={process || ALL_PROCESSES}
          options={[ALL_PROCESSES, ...processes].map((p) => ({ value: p, label: p }))}
          onChange={(p) => setProcess(p === ALL_PROCESSES ? "" : p)}
        />
        <ToggleChip on={includeSystem} onChange={onIncludeSystemChange} label="Include system logs">
          System logs
        </ToggleChip>
        <span className="ml-auto shrink-0 pl-2 font-mono text-caption whitespace-nowrap text-label-3 tabular-nums">
          {filtered.length.toLocaleString()} shown · {logs.entries.length.toLocaleString()} retained
          · {formatBytes(logs.totalBytes)}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          role="log"
          aria-label="Simulator logs"
          onScroll={(e) => {
            const el = e.currentTarget;
            const atTail = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK;
            followRef.current = atTail;
            if (atTail !== following) setFollowing(atTail);
          }}
          className="thin-scrollbar scroll-fade h-full overflow-y-auto px-1.5 pb-3"
        >
          {filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-footnote text-label-3">
              {empty}
            </div>
          ) : (
            <>
              {omitted > 0 && (
                <div className="px-1.5 pt-1 pb-1.5 text-caption text-label-3">
                  {omitted.toLocaleString()} older matching rows hidden for performance
                </div>
              )}
              <SimLogRows entries={rendered} query={query} fresh={fresh} />
            </>
          )}
        </div>
        <AnimatePresence>
          {!following && filtered.length > 0 && (
            <motion.button
              type="button"
              onClick={jumpToLatest}
              className="glass-pop absolute bottom-3 left-1/2 flex h-7 items-center gap-1.5 rounded-full px-3 text-footnote font-semibold text-label"
              initial={{ opacity: 0, y: 10, x: "-50%", scale: 0.92 }}
              animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
              exit={{ opacity: 0, y: 6, x: "-50%", scale: 0.96 }}
              whileTap={{ scale: 0.95 }}
              transition={spring.ui}
            >
              Jump to latest <ArrowDown className="size-3.5" strokeWidth={2.4} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
