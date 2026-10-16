import { Menu } from "@base-ui/react/menu";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { logs as seed, type LogEntry, type LogLevel } from "../lib/mock";
import { spring } from "../lib/motion";
import { TextField } from "../ui/field";

const templates: Omit<LogEntry, "id" | "time">[] = [
  { level: "debug", process: "Trails", subsystem: "com.acme.trails:render", message: "TrailList commit 7.9 ms · 24 rows · 0 dropped frames" },
  { level: "info", process: "Trails", subsystem: "com.acme.trails:location", message: "Location fix ±5 m · 37.3349, -122.0090 · 1.4 m/s" },
  { level: "default", process: "SpringBoard", subsystem: "com.apple.SpringBoard:Scene", message: "Scene update for com.acme.trails: foreground, active" },
  { level: "default", process: "backboardd", subsystem: "com.apple.backboard:hid", message: "Touch ended at (201.4, 640.0) · digitizer 0" },
  { level: "info", process: "Trails", subsystem: "com.acme.trails:sync", message: "Uploaded 1 of 3 pending recordings (412 KB)" },
  { level: "error", process: "Trails", subsystem: "com.acme.trails:network", message: "POST https://api.acme.dev/v2/recordings returned 503 Service Unavailable" },
  { level: "debug", process: "Trails", subsystem: "com.acme.trails:maps", message: "Tile cache hit 98.2% · 4 misses · 1.1 MB fetched" },
  { level: "default", process: "locationd", subsystem: "com.apple.locationd.Core:Client", message: "{\"msg\":\"fix delivered\", \"bundleId\":\"com.acme.trails\", \"accuracy\":5}" },
];

const levelOrder: Record<string, LogLevel[]> = {
  Default: ["default", "info", "error", "fault"],
  Info: ["default", "info", "error", "fault"],
  Debug: ["default", "info", "debug", "error", "fault"],
};
const systemProcesses = new Set(["SpringBoard", "locationd", "backboardd"]);

function stamp() {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}${p(Math.floor(Math.random() * 1000), 3)}`;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="rounded-[3px] bg-ink/12 px-px text-label">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** Capsule filter chip that opens a radio menu — ReUI Filters shape. */
function FilterChip<T extends string>({ field, value, options, onChange }: { field: string; value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger className="inline-flex h-6 items-center gap-1.5 rounded-full bg-fill-3 pr-1.5 pl-2.5 text-footnote shadow-[inset_0_0_0_0.5px_var(--separator)] outline-none transition-colors hover:bg-fill-2 data-[popup-open]:bg-fill-2">
        <span className="text-label-3">{field}</span>
        <span className="font-medium text-label">{value}</span>
        <ChevronDown className="size-3 text-label-3" strokeWidth={2.4} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start" className="z-[80] outline-none">
          <Menu.Popup className="glass-pop menu-pop min-w-[168px] origin-[var(--transform-origin)] rounded-[12px] p-[5px] outline-none">
            <Menu.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
              {options.map((o) => (
                <Menu.RadioItem
                  key={o}
                  value={o}
                  className="grid min-h-7 cursor-default grid-cols-[16px_1fr] items-center gap-1.5 rounded-[7px] pr-3 pl-1.5 text-body text-label outline-none select-none data-[highlighted]:bg-ink data-[highlighted]:text-on-ink"
                >
                  <Menu.RadioItemIndicator className="col-start-1 flex">
                    <Check className="size-[13px]" strokeWidth={2.5} />
                  </Menu.RadioItemIndicator>
                  <span className="col-start-2">{o}</span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ToggleChip({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      whileTap={{ scale: 0.95 }}
      transition={spring.snappy}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-footnote font-medium transition-colors duration-200",
        on ? "bg-ink text-on-ink" : "bg-fill-3 text-label-2 shadow-[inset_0_0_0_0.5px_var(--separator)] hover:bg-fill-2",
      )}
    >
      <span className={cn("size-1.5 rounded-full transition-colors", on ? "bg-on-ink" : "bg-label-3")} />
      {children}
    </motion.button>
  );
}

function LevelTag({ level }: { level: LogLevel }) {
  if (level === "default") return <span className="text-label-3">—</span>;
  const tone = level === "error" || level === "fault" ? "text-red font-semibold" : level === "info" ? "text-label-2" : "text-label-3";
  return <span className={cn("text-caption tracking-[0.02em] uppercase", tone)}>{level}</span>;
}

export function LogsView({ paused, clearToken }: { paused: boolean; clearToken: number }) {
  const [entries, setEntries] = useState<LogEntry[]>(seed);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<"Default" | "Info" | "Debug">("Debug");
  const [proc, setProc] = useState("All processes");
  const [system, setSystem] = useState(true);
  const [following, setFollowing] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const nextId = useRef(1000);
  const tpl = useRef(0);
  const fresh = useRef(new Set<number>());

  useEffect(() => {
    if (clearToken) setEntries([]);
  }, [clearToken]);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      const id = nextId.current++;
      fresh.current.add(id);
      const base = templates[tpl.current++ % templates.length]!;
      setEntries((e) => [...e, { ...base, id, time: stamp() }].slice(-400));
    }, 1600);
    return () => clearInterval(t);
  }, [paused]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        levelOrder[level]!.includes(e.level) &&
        (proc === "All processes" || e.process === proc) &&
        (system || !systemProcesses.has(e.process)) &&
        (!q || e.message.toLowerCase().includes(q) || e.process.toLowerCase().includes(q)),
    );
  }, [entries, query, level, proc, system]);

  // Follow the tail unless the reader has scrolled away from it.
  useEffect(() => {
    const el = scroller.current;
    if (el && following) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [shown.length, following]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 px-2.5">
        <TextField leading={<Search />} placeholder="Search messages or processes" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-[280px] flex-1" />
        <FilterChip field="Level" value={level} options={["Default", "Info", "Debug"]} onChange={setLevel} />
        <FilterChip field="Process" value={proc} options={["All processes", "Trails", "SpringBoard", "locationd", "backboardd"]} onChange={setProc} />
        <ToggleChip on={system} onChange={setSystem}>
          System logs
        </ToggleChip>
        <span className="ml-auto font-mono text-caption whitespace-nowrap text-label-3 tabular">
          {shown.length} shown · {(1192 + entries.length).toLocaleString()} retained · {Math.round(372 + entries.length * 0.4)} KB
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
          className="thin-scrollbar scroll-fade h-full overflow-y-auto px-1.5 pb-3"
        >
          {shown.length === 0 ? (
            <div className="flex h-full items-center justify-center text-footnote text-label-3">No logs match these filters.</div>
          ) : (
            shown.map((e) => {
              const isNew = fresh.current.has(e.id);
              const bad = e.level === "error" || e.level === "fault";
              return (
                <motion.div
                  key={e.id}
                  initial={isNew ? { opacity: 0, y: 6 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={spring.ui}
                  onAnimationComplete={() => fresh.current.delete(e.id)}
                  className={cn(
                    "grid min-h-7 grid-cols-[118px_52px_128px_1fr] items-start gap-2 rounded-[7px] px-1.5 py-1 text-footnote transition-colors hover:bg-fill-3",
                    bad && "bg-red/5 hover:bg-red/8",
                  )}
                >
                  <span className="pt-px font-mono text-caption text-label-3 tabular">{e.time}</span>
                  <span className="pt-px">
                    <LevelTag level={e.level} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-label">
                      <Highlight text={e.process} query={query.trim()} />
                    </span>
                    {e.subsystem && <span className="truncate text-caption text-label-3">{e.subsystem}</span>}
                  </span>
                  <span className="min-w-0 font-mono text-[11.5px]/[17px] break-words text-label select-text">
                    <Highlight text={e.message} query={query.trim()} />
                  </span>
                </motion.div>
              );
            })
          )}
        </div>
        <AnimatePresence>
          {!following && shown.length > 0 && (
            <motion.button
              type="button"
              onClick={() => setFollowing(true)}
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
