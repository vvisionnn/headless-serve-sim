import { AnimatePresence, motion } from "motion/react";
import {
  Glasses,
  Play,
  RefreshCw,
  Search,
  Smartphone,
  Square,
  Tablet,
  Tv,
  Watch,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { GRID_MAX_PAGE_SIZE, useGridDevices } from "../hooks/use-grid-devices";
import { useGridMemory } from "../hooks/use-grid-memory";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { StatusDot } from "../ui/badge";
import { IconButton } from "../ui/button";
import { TextField } from "../ui/field";
import { Tip } from "../ui/tooltip";
import { deviceKind, runtimeLabel, runtimeOrder, type SimDevice } from "../utils/devices";
import { formatGridBytes, type GridDevice, type MemoryReport } from "../utils/grid";
import { useOptionalShell } from "./shell-context";
import { publishNavigatorLayout, type NavigatorLayout } from "./stage-handoff";

export interface NavigatorProps {
  devices: SimDevice[];
  loading: boolean;
  error: string | null;
  currentUdid: string | null;
  stoppingUdids: Set<string>;
  switching: boolean;
  onRefresh: () => void;
  /** Boot (if needed), start streaming and switch the page to this simulator. */
  onSelect: (device: SimDevice) => void;
  onStop: (udid: string) => void;
  /** The search and scroll a switch carried over from the last shell. */
  initial?: NavigatorLayout;
}

export type SimRowState =
  | { kind: "live"; port: number }
  | { kind: "booted" }
  | { kind: "booting" }
  | { kind: "stopping" }
  | { kind: "shutdown" };

/** What one row says about its simulator, from simctl state plus the grid's helper info. */
export function simRowState(
  device: SimDevice,
  helper: GridDevice["helper"] | undefined,
  stopping: boolean,
  pending: boolean,
): SimRowState {
  if (stopping) return { kind: "stopping" };
  if (helper) return { kind: "live", port: helper.port };
  if (pending || device.state === "Booting") return { kind: "booting" };
  if (device.state === "Booted") return { kind: "booted" };
  return { kind: "shutdown" };
}

/** Filter by `query`, then group by runtime: platform order, phones first, then by name. */
export function groupSimulators(devices: SimDevice[], query: string): [string, SimDevice[]][] {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, SimDevice[]>();
  for (const d of devices) {
    if (q && !`${d.name} ${d.runtime} ${runtimeLabel(d.runtime)}`.toLowerCase().includes(q))
      continue;
    groups.set(d.runtime, [...(groups.get(d.runtime) ?? []), d]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => deviceKind(a.name) - deviceKind(b.name) || a.name.localeCompare(b.name));
  }
  return [...groups].sort(([a], [b]) => runtimeOrder(a) - runtimeOrder(b) || a.localeCompare(b));
}

export interface CapacitySummary {
  running: number;
  /** Simulators that fit in memory in total; null when there's no report. */
  capacity: number | null;
  free: string | null;
  tone: "ink" | "orange" | "red";
}

/** Footer numbers: capacity is what runs now plus what memory still has room for. */
export function capacitySummary(report: MemoryReport | null, bootedCount: number): CapacitySummary {
  if (!report) return { running: bootedCount, capacity: null, free: null, tone: "ink" };
  const left = report.estimatedAdditional;
  return {
    running: report.runningSimulators,
    capacity: report.runningSimulators + left,
    free: formatGridBytes(report.availableBytes),
    tone: left === 0 ? "red" : left <= 1 ? "orange" : "ink",
  };
}

function glyphFor(name: string) {
  const n = name.toLowerCase();
  if (n.includes("ipad")) return Tablet;
  if (n.includes("watch")) return Watch;
  if (n.includes("vision")) return Glasses;
  if (n.includes("tv")) return Tv;
  return Smartphone;
}

const MAX_SEGMENTS = 12;

/**
 * Navigator: every simulator on this Mac, grouped by runtime. Selection is a
 * single soft fill that glides between rows; a row's action (boot / stop)
 * appears only where the pointer is.
 */
export function Navigator(props: NavigatorProps) {
  const { devices, loading, error, currentUdid, stoppingUdids, switching } = props;
  const shell = useOptionalShell();
  // A switch carries the search and scroll over, so the list stays put.
  const [initial] = useState(props.initial);
  const [query, setQuery] = useState(initial?.query ?? "");
  const listRef = useRef<HTMLDivElement>(null);
  const [owner] = useState(() => ({}));
  useLayoutEffect(() => {
    if (listRef.current && initial) listRef.current.scrollTop = initial.scrollTop;
    return () => publishNavigatorLayout(owner, null);
  }, [owner, initial]);
  // Only on the user's own changes: a leaving navigator that re-renders
  // mustn't take back what the next one now holds.
  const publish = () =>
    publishNavigatorLayout(owner, { query, scrollTop: listRef.current?.scrollTop ?? 0 });
  useLayoutEffect(() => {
    publishNavigatorLayout(owner, { query, scrollTop: listRef.current?.scrollTop ?? 0 });
  }, [owner, query]);
  const [pendingUdid, setPendingUdid] = useState<string | null>(null);

  const config = typeof window === "undefined" ? undefined : window.__SIM_PREVIEW__;
  const busy = switching || stoppingUdids.size > 0;
  // Every row needs its helper port, not just the first page's.
  const grid = useGridDevices(config?.gridApiEndpoint, true, busy, GRID_MAX_PAGE_SIZE);
  const memory = useGridMemory(config?.gridMemoryEndpoint, true);

  const helpers = useMemo(
    () => new Map((grid.devices ?? []).map((g) => [g.device, g.helper] as const)),
    [grid.devices],
  );
  const groups = useMemo(() => groupSimulators(devices, query), [devices, query]);
  const summary = capacitySummary(memory, devices.filter((d) => d.state === "Booted").length);
  const selected = shell?.wallOpen ? null : currentUdid;

  const select = (d: SimDevice) => {
    if (switching || d.udid === currentUdid) return;
    setPendingUdid(d.udid);
    props.onSelect(d);
  };
  const refresh = () => {
    props.onRefresh();
    grid.refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-2 pr-2.5 pl-4">
        <h2 className="flex-1 text-title3 text-label">Simulators</h2>
        <Tip label="Refresh">
          <IconButton label="Refresh simulators" size="md" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} />
          </IconButton>
        </Tip>
      </header>
      <div className="px-3 pb-2">
        <TextField
          leading={<Search />}
          placeholder="Search"
          aria-label="Search simulators"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="[&_input]:h-[30px] [&_input]:rounded-[10px] [&_input]:bg-fill-3 [&_input]:shadow-none"
        />
      </div>
      <div
        ref={listRef}
        onScroll={publish}
        className="thin-scrollbar scroll-fade flex-1 overflow-y-auto px-2 pt-1 pb-3"
      >
        {error && <p className="px-2.5 py-2 text-footnote break-words text-red">{error}</p>}
        {groups.length === 0 && !error && (
          <p
            className={cn(
              "px-2.5 py-6 text-center text-footnote",
              loading ? "shimmer-text font-medium" : "text-label-3",
            )}
          >
            {loading ? "Loading…" : query ? "No matches" : "No simulators found"}
          </p>
        )}
        {groups.map(([runtime, list]) => (
          <section key={runtime} className="mb-3">
            <h3 className="px-2.5 pt-2 pb-1 text-caption font-semibold text-label-3">
              {runtimeLabel(runtime)}
            </h3>
            <ul className="flex flex-col gap-px">
              {list.map((d) => {
                const st = simRowState(
                  d,
                  helpers.get(d.udid),
                  stoppingUdids.has(d.udid),
                  switching && pendingUdid === d.udid,
                );
                const Glyph = glyphFor(d.name);
                const off = st.kind === "shutdown";
                const canStop = st.kind === "live" || st.kind === "booted";
                return (
                  <li key={d.udid} className="group relative">
                    {selected === d.udid && (
                      <motion.span
                        layoutId="nav-selection"
                        className="absolute inset-0 rounded-[10px] bg-fill-2"
                        transition={spring.ui}
                      />
                    )}
                    <button
                      type="button"
                      disabled={st.kind === "stopping" || st.kind === "booting"}
                      aria-current={d.udid === currentUdid ? "true" : undefined}
                      onClick={() => select(d)}
                      className="relative flex w-full items-center gap-2.5 rounded-[10px] py-1.5 pr-9 pl-2 text-left transition-colors hover:bg-fill-3 disabled:cursor-default"
                    >
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-fill-3 text-label",
                          off && "text-label-2",
                        )}
                      >
                        <Glyph className="size-[15px]" strokeWidth={1.75} />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span
                          className={cn(
                            "truncate text-body font-medium",
                            off ? "text-label-2" : "text-label",
                          )}
                        >
                          {d.name}
                        </span>
                        <span className="flex items-center gap-1.5 text-caption text-label-3">
                          <AnimatePresence mode="popLayout" initial={false}>
                            <motion.span
                              key={st.kind}
                              className="flex items-center gap-1.5"
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={spring.snappy}
                            >
                              {st.kind === "live" && (
                                <>
                                  <StatusDot tone="green" live /> Live{" "}
                                  <span className="font-mono">:{st.port}</span>
                                </>
                              )}
                              {st.kind === "booted" && (
                                <>
                                  <StatusDot tone="neutral" /> Booted · not streaming
                                </>
                              )}
                              {st.kind === "booting" && (
                                <span className="shimmer-text font-medium">Booting…</span>
                              )}
                              {st.kind === "stopping" && (
                                <span className="shimmer-text font-medium">Stopping…</span>
                              )}
                              {off && "Shut down"}
                            </motion.span>
                          </AnimatePresence>
                        </span>
                      </span>
                    </button>
                    {(off || canStop) && (
                      <Tip label={off ? "Boot & stream" : "Shut down"} side="right">
                        <IconButton
                          label={off ? `Boot ${d.name}` : `Shut down ${d.name}`}
                          size="sm"
                          disabled={off && switching}
                          onClick={() => (off ? select(d) : props.onStop(d.udid))}
                          className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-[11px]"
                        >
                          {off ? <Play fill="currentColor" /> : <Square fill="currentColor" />}
                        </IconButton>
                      </Tip>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <CapacityFooter summary={summary} />
    </div>
  );
}

function CapacityFooter({ summary }: { summary: CapacitySummary }) {
  const { running, capacity, free, tone } = summary;
  const segments = capacity === null ? 0 : Math.max(1, Math.min(capacity, MAX_SEGMENTS));
  const filled =
    capacity === null
      ? 0
      : capacity <= MAX_SEGMENTS
        ? running
        : Math.round((running / capacity) * MAX_SEGMENTS);
  const on = tone === "ink" ? "var(--ink)" : `var(--${tone})`;
  return (
    <footer className="flex flex-col gap-2 border-t-[0.5px] border-separator px-4 pt-3 pb-3.5">
      <div className="flex items-baseline justify-between text-caption">
        <span className="font-medium text-label-2">
          {capacity === null ? `${running} running` : `${running} of ${capacity} running`}
        </span>
        {free && <span className="font-mono text-label-3">{free} free</span>}
      </div>
      {segments > 0 && (
        <div className="flex h-1 gap-[3px]">
          {Array.from({ length: segments }, (_, i) => (
            <motion.span
              key={i}
              className="h-full flex-1 rounded-full"
              initial={false}
              animate={{ backgroundColor: i < filled ? on : "var(--fill)" }}
              transition={{ duration: 0.4 }}
            />
          ))}
        </div>
      )}
    </footer>
  );
}
