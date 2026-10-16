import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Bell,
  Camera,
  Circle,
  Gauge,
  House,
  Keyboard,
  LayoutGrid,
  MapPin,
  Moon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Search,
  ShieldCheck,
  Signal,
  Smartphone,
  Tablet,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { sims } from "../lib/mock";
import { spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { StatusDot } from "../ui/badge";
import { Kbd, Shortcut } from "../ui/kbd";

interface Command {
  id: string;
  group: string;
  label: string;
  caption?: string;
  icon: LucideIcon;
  keys?: string[];
  dot?: "green" | "neutral" | "orange";
  run: () => void;
}

const kindIcon = { iphone: Smartphone, ipad: Tablet, watch: Watch } as const;

/** ⌘K — every action, tool and simulator, one keystroke away. */
export function CommandPalette() {
  const app = useApp();
  const { paletteOpen, set } = app;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [hl, setHl] = useState({ y: 0, h: 0 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        set((s) => ({ paletteOpen: !s.paletteOpen }));
      } else if (e.key === "Escape") set({ paletteOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setActive(0);
    }
  }, [paletteOpen]);

  const commands = useMemo<Command[]>(() => {
    const inspector = (tab: "device" | "app" | "capture" | "activity") => () => set({ inspectorOpen: true, inspectorTab: tab, scene: "workspace" });
    return [
      ...sims.map<Command>((s) => ({
        id: `sim-${s.udid}`,
        group: "Simulators",
        label: s.name,
        caption: `${s.runtime} · ${s.state === "live" ? `Live on :${s.port}` : s.state === "booted" ? "Booted" : "Shut down"}`,
        icon: kindIcon[s.kind],
        dot: s.state === "live" ? "green" : s.state === "booted" ? "orange" : "neutral",
        run: () => set({ device: s.kind, scene: "workspace" }),
      })),
      { id: "home", group: "Device", label: "Home", icon: House, keys: ["⇧", "⌘", "H"], run: () => set({ appOpen: false }) },
      { id: "rotate", group: "Device", label: "Rotate", icon: RotateCcw, run: () => set((s) => ({ orientation: ((s.orientation + 90) % 360) as 0 | 90 | 180 | 270 })) },
      { id: "appearance", group: "Device", label: "Toggle appearance", icon: Moon, keys: ["⇧", "⌘", "A"], run: () => set((s) => ({ simAppearance: s.simAppearance === "dark" ? "light" : "dark" })) },
      { id: "keyboard", group: "Device", label: "Software keyboard", icon: Keyboard, keys: ["⌥", "⌘", "K"], run: () => {} },
      { id: "shot", group: "Capture", label: "Take screenshot", icon: Camera, keys: ["⌘", "S"], run: app.screenshot },
      { id: "rec", group: "Capture", label: app.recording ? "Stop recording" : "Start recording", icon: Circle, run: app.toggleRecording },
      { id: "p-insp", group: "Panels", label: "Show inspector", icon: PanelRight, run: () => set({ inspectorOpen: true }) },
      { id: "p-cons", group: "Panels", label: "Show console", icon: PanelBottom, run: () => set({ consoleOpen: true, consoleTab: "logs" }) },
      { id: "p-nav", group: "Panels", label: "Show simulators", icon: PanelLeft, run: () => set({ navigatorOpen: true }) },
      { id: "p-wall", group: "Panels", label: "Wall view", caption: "Every running simulator side by side", icon: LayoutGrid, run: () => set({ scene: "wall" }) },
      { id: "i-status", group: "Inspector", label: "Status bar overrides", icon: Signal, run: inspector("device") },
      { id: "i-loc", group: "Inspector", label: "Location", caption: "Play a trail route", icon: MapPin, run: inspector("device") },
      { id: "i-perm", group: "Inspector", label: "Permissions", icon: ShieldCheck, run: inspector("app") },
      { id: "i-push", group: "Inspector", label: "Push notification", icon: Bell, run: inspector("app") },
      { id: "i-act", group: "Inspector", label: "Activity", caption: "CPU, memory and stream health", icon: Activity, run: inspector("activity") },
      { id: "i-stream", group: "Inspector", label: "Stream quality", icon: Gauge, run: inspector("activity") },
    ];
  }, [set, app.screenshot, app.toggleRecording, app.recording]);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => words.every((w) => `${c.label} ${c.caption ?? ""} ${c.group}`.toLowerCase().includes(w)));
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);

  // The highlight is one object that slides between rows, not a per-row fill.
  useEffect(() => {
    const el = rowRefs.current[active];
    if (!el) return;
    setHl({ y: el.offsetTop, h: el.offsetHeight });
    el.scrollIntoView({ block: "nearest" });
  }, [active, results, paletteOpen]);

  const run = (c?: Command) => {
    if (!c) return;
    set({ paletteOpen: false });
    c.run();
  };

  let lastGroup = "";
  return createPortal(
    <AnimatePresence>
      {paletteOpen && (
        <motion.div key="palette" className="fixed inset-0 z-[100]" initial={{ opacity: 1 }} exit={{ opacity: 1 }}>
          <motion.div
            className="absolute inset-0 bg-[var(--scrim)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.2 }}
            onClick={() => set({ paletteOpen: false })}
          />
          <motion.div
            role="dialog"
            aria-label="Command palette"
            className="glass-pop absolute top-[18vh] left-1/2 flex max-h-[min(520px,64vh)] w-[600px] max-w-[calc(100vw-32px)] origin-top flex-col overflow-hidden rounded-[20px]"
            initial={{ opacity: 0, scale: 0.96, y: -8, x: "-50%", filter: "blur(8px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, x: "-50%", filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.98, y: -4, x: "-50%", filter: "blur(4px)", transition: { duration: 0.14 } }}
            transition={spring.ui}
          >
            <div className="flex h-12 shrink-0 items-center gap-2.5 border-b-[0.5px] border-separator px-4">
              <Search className="size-[17px] text-label-3" strokeWidth={2} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(results.length - 1, a + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    run(results[active]);
                  }
                }}
                placeholder="Search actions, tools and simulators"
                className="h-full flex-1 bg-transparent text-title3 font-normal text-label outline-none placeholder:text-label-3"
              />
              <Kbd>esc</Kbd>
            </div>
            <div ref={list} className="thin-scrollbar relative min-h-0 flex-1 overflow-y-auto p-1.5">
              {results.length > 0 && (
                <motion.div
                  aria-hidden
                  className="absolute right-1.5 left-1.5 rounded-[10px] bg-fill-2"
                  initial={false}
                  animate={{ y: hl.y, height: hl.h }}
                  transition={spring.snappy}
                  style={{ top: 0 }}
                />
              )}
              {results.length === 0 && <div className="py-10 text-center text-footnote text-label-3">No matches for "{query}".</div>}
              {results.map((c, i) => {
                const header = c.group !== lastGroup;
                lastGroup = c.group;
                return (
                  <div key={c.id}>
                    {header && <div className="px-2.5 pt-2.5 pb-1 text-caption font-semibold text-label-3">{c.group}</div>}
                    <button
                      ref={(el) => {
                        rowRefs.current[i] = el;
                      }}
                      type="button"
                      onPointerMove={() => active !== i && setActive(i)}
                      onClick={() => run(c)}
                      className="relative flex h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left outline-none"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-fill-2 text-label [&_svg]:size-[15px]">
                        <c.icon strokeWidth={1.9} />
                      </span>
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="truncate text-body font-medium text-label">{c.label}</span>
                        {c.caption && <span className="truncate text-footnote text-label-3">{c.caption}</span>}
                      </span>
                      {c.dot && <StatusDot tone={c.dot} live={c.dot === "green"} />}
                      {c.keys && <Shortcut keys={c.keys} />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className={cn("flex h-9 shrink-0 items-center gap-3 border-t-[0.5px] border-separator px-4 text-caption text-label-3")}>
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> to navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> to run
              </span>
              <span className="flex items-center gap-1">
                <Kbd>esc</Kbd> to close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
