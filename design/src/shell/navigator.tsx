import { AnimatePresence, motion } from "motion/react";
import { Play, RefreshCw, Search, Smartphone, Square, Tablet, Watch } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { sims, type Sim } from "../lib/mock";
import { spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { StatusDot } from "../ui/badge";
import { IconButton } from "../ui/button";
import { TextField } from "../ui/field";
import { Tip } from "../ui/tooltip";

const glyph = { iphone: Smartphone, ipad: Tablet, watch: Watch };

/**
 * Navigator: every simulator on this Mac, grouped by runtime. Selection is a
 * single soft fill that glides between rows; a row's action (start / stop)
 * appears only where the pointer is.
 */
export function Navigator() {
  const { device, scene, set, toast } = useApp();
  const [q, setQ] = useState("");
  const [states, setStates] = useState<Record<string, Sim["state"]>>(() => Object.fromEntries(sims.map((s) => [s.udid, s.state])));
  const groups = useMemo(() => {
    const list = sims.filter((s) => `${s.name} ${s.runtime}`.toLowerCase().includes(q.toLowerCase()));
    const map = new Map<string, Sim[]>();
    for (const s of list) map.set(s.runtime, [...(map.get(s.runtime) ?? []), s]);
    return [...map];
  }, [q]);
  const running = Object.values(states).filter((s) => s === "live" || s === "booted").length;
  const selected = scene === "wall" ? null : sims.find((s) => s.kind === device && states[s.udid] === "live")?.udid;

  const toggle = (s: Sim) => {
    const st = states[s.udid];
    if (st === "shutdown") {
      setStates((p) => ({ ...p, [s.udid]: "booting" }));
      setTimeout(() => {
        setStates((p) => ({ ...p, [s.udid]: "live" }));
        toast({ title: `${s.name} is streaming`, detail: `${s.runtime} · localhost:${3104}`, tone: "success" });
      }, 2400);
    } else {
      setStates((p) => ({ ...p, [s.udid]: "shutdown" }));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-2 pr-2.5 pl-4">
        <h2 className="flex-1 text-title3 text-label">Simulators</h2>
        <Tip label="Refresh">
          <IconButton label="Refresh simulators" size="md">
            <RefreshCw />
          </IconButton>
        </Tip>
      </header>
      <div className="px-3 pb-2">
        <TextField leading={<Search />} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="[&_input]:h-[30px] [&_input]:rounded-[10px] [&_input]:bg-fill-3 [&_input]:shadow-none" />
      </div>
      <div className="thin-scrollbar scroll-fade flex-1 overflow-y-auto px-2 pt-1 pb-3">
        {groups.map(([runtime, list]) => (
          <section key={runtime} className="mb-3">
            <h3 className="px-2.5 pt-2 pb-1 text-caption font-semibold text-label-3">{runtime}</h3>
            <ul className="flex flex-col gap-px">
              {list.map((s) => {
                const st = states[s.udid]!;
                const Glyph = glyph[s.kind];
                const isSel = selected === s.udid;
                return (
                  <li key={s.udid} className="group relative">
                    {isSel && <motion.span layoutId="nav-selection" className="absolute inset-0 rounded-[10px] bg-fill-2" transition={spring.ui} />}
                    <button
                      type="button"
                      onClick={() => st === "live" && set({ device: s.kind, scene: "workspace" })}
                      className="relative flex w-full items-center gap-2.5 rounded-[10px] py-1.5 pr-9 pl-2 text-left transition-colors hover:bg-fill-3"
                    >
                      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-fill-3 text-label", st === "shutdown" && "text-label-2")}>
                        <Glyph className="size-[15px]" strokeWidth={1.75} />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className={cn("truncate text-body font-medium", st === "shutdown" ? "text-label-2" : "text-label")}>{s.name}</span>
                        <span className="flex items-center gap-1.5 text-caption text-label-3">
                          <AnimatePresence mode="popLayout" initial={false}>
                            <motion.span key={st} className="flex items-center gap-1.5" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={spring.snappy}>
                              {st === "live" && (
                                <>
                                  <StatusDot tone="green" live /> Live <span className="font-mono">:{s.port ?? 3104}</span>
                                </>
                              )}
                              {st === "booted" && (
                                <>
                                  <StatusDot tone="neutral" /> Booted · not streaming
                                </>
                              )}
                              {st === "booting" && <span className="shimmer-text font-medium">Booting…</span>}
                              {st === "shutdown" && "Shut down"}
                            </motion.span>
                          </AnimatePresence>
                        </span>
                      </span>
                    </button>
                    {st !== "booting" && (
                      <Tip label={st === "shutdown" ? "Boot & stream" : st === "booted" ? "Start stream" : "Shut down"} side="right">
                        <IconButton
                          label={st === "shutdown" ? `Boot ${s.name}` : `Shut down ${s.name}`}
                          size="sm"
                          onClick={() => toggle(s)}
                          className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-[11px]"
                        >
                          {st === "live" ? <Square fill="currentColor" /> : <Play fill="currentColor" />}
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
      <footer className="flex flex-col gap-2 border-t-[0.5px] border-separator px-4 pt-3 pb-3.5">
        <div className="flex items-baseline justify-between text-caption">
          <span className="font-medium text-label-2">
            {running} of 5 running
          </span>
          <span className="font-mono text-label-3">12.4 GB free</span>
        </div>
        <div className="flex h-1 gap-[3px]">
          {Array.from({ length: 5 }, (_, i) => (
            <motion.span key={i} className="h-full flex-1 rounded-full" animate={{ backgroundColor: i < running ? "var(--ink)" : "var(--fill)" }} transition={{ duration: 0.4 }} />
          ))}
        </div>
      </footer>
    </div>
  );
}
