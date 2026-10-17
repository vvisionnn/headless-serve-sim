import { AnimatePresence, motion } from "motion/react";
import {
  Accessibility,
  Activity,
  AppWindow,
  Camera,
  Circle,
  Globe,
  House,
  Keyboard,
  LayoutGrid,
  Link,
  Monitor,
  Moon,
  MousePointerClick,
  PanelBottom,
  PanelLeft,
  PanelRight,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Smartphone,
  SquareDashed,
  Sun,
  SunMoon,
  Tablet,
  Video,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { spring } from "../lib/motion";
import { StatusDot } from "../ui/badge";
import { Kbd, Shortcut } from "../ui/kbd";
import { runtimeLabel, type SimDevice } from "../utils/devices";
import { isCommandPaletteShortcut } from "../utils/shortcuts";
import { useShell, type Shell } from "./shell-context";

export interface CommandPaletteProps {
  devices: SimDevice[];
  currentUdid: string | null;
  onSelectDevice: (device: SimDevice) => void;
  phonePreviewUrl?: string;
}

export interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  caption?: string;
  icon: LucideIcon | ComponentType;
  keys?: string[];
  dot?: "green" | "orange" | "neutral";
  /** Listed only once the user types — keeps a long simulator catalog from
   *  burying the actions on an empty query. */
  searchOnly?: boolean;
  run: () => void;
}

/** Every query word must appear in the label, caption or group. */
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands.filter((c) => !c.searchOnly);
  return commands.filter((c) => {
    const haystack = `${c.label} ${c.caption ?? ""} ${c.group}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

function deviceIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("ipad")) return Tablet;
  if (n.includes("watch")) return Watch;
  if (n.includes("vision")) return SquareDashed;
  return Smartphone;
}

function buildCommands(
  shell: Shell,
  { devices, currentUdid, onSelectDevice, phonePreviewUrl }: CommandPaletteProps,
): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  // Running simulators first; shut-down ones only surface when searched for.
  const ordered = [...devices].sort(
    (a, b) =>
      Number(b.udid === currentUdid) - Number(a.udid === currentUdid) ||
      Number(b.state === "Booted") - Number(a.state === "Booted"),
  );
  for (const d of ordered) {
    const current = d.udid === currentUdid;
    const booted = d.state === "Booted";
    out.push({
      id: `sim-${d.udid}`,
      group: "Simulators",
      label: d.name,
      caption: `${runtimeLabel(d.runtime)} · ${current ? "Current" : booted ? "Booted" : "Shut down"}`,
      icon: deviceIcon(d.name),
      dot: current ? "green" : booted ? "orange" : "neutral",
      searchOnly: !current && !booted,
      run: () => onSelectDevice(d),
    });
  }

  if (shell.device) {
    out.push({
      id: "home",
      group: "Device",
      label: "Home",
      icon: House,
      keys: ["⇧", "⌘", "H"],
      run: shell.goHome,
    });
    if (shell.canRotate)
      out.push({
        id: "rotate",
        group: "Device",
        label: "Rotate",
        icon: RotateCcw,
        run: shell.rotate,
      });
    out.push(
      {
        id: "appearance",
        group: "Device",
        label: "Toggle appearance",
        icon: SunMoon,
        keys: ["⇧", "⌘", "A"],
        run: shell.toggleAppearance,
      },
      {
        id: "keyboard",
        group: "Device",
        label: "Software keyboard",
        icon: Keyboard,
        keys: ["⌥", "⌘", "K"],
        run: shell.toggleSoftwareKeyboard,
      },
    );
    if (shell.reloadReactNative)
      out.push({
        id: "rn-reload",
        group: "Device",
        label: "Reload React Native",
        icon: RefreshCw,
        run: shell.reloadReactNative,
      });
    out.push({
      id: "ax-overlay",
      group: "Device",
      label: shell.axOverlayEnabled ? "Hide accessibility overlay" : "Show accessibility overlay",
      icon: Accessibility,
      run: shell.toggleAxOverlay,
    });

    out.push({
      id: "shot",
      group: "Capture",
      label: "Take screenshot",
      icon: Camera,
      keys: ["⌘", "S"],
      run: shell.screenshot,
    });
    const rec = shell.recording;
    if (rec.status === "recording")
      out.push({
        id: "rec",
        group: "Capture",
        label: "Stop recording",
        icon: Circle,
        run: rec.stop,
      });
    else if (rec.status === "idle" && rec.available)
      out.push({
        id: "rec",
        group: "Capture",
        label: "Start recording",
        icon: Video,
        run: rec.start,
      });
  }

  out.push(
    {
      id: "p-nav",
      group: "Panels",
      label: shell.navigatorOpen ? "Hide simulators" : "Show simulators",
      icon: PanelLeft,
      run: () => shell.setNavigatorOpen((v) => !v),
    },
    {
      id: "p-insp",
      group: "Panels",
      label: shell.inspectorOpen ? "Hide inspector" : "Show inspector",
      icon: PanelRight,
      run: () => shell.setInspectorOpen((v) => !v),
    },
    {
      id: "p-cons",
      group: "Panels",
      label: shell.consoleOpen ? "Hide console" : "Show console",
      icon: PanelBottom,
      run: () => shell.setConsoleOpen((v) => !v),
    },
    {
      id: "p-wall",
      group: "Panels",
      label: "Wall view",
      caption: "Every running simulator side by side",
      icon: LayoutGrid,
      run: () => shell.setWallOpen(true),
    },
  );

  const consoleTab = (tab: Shell["consoleTab"]) => () => {
    shell.setConsoleTab(tab);
    shell.setConsoleOpen(true);
  };
  out.push(
    { id: "c-logs", group: "Console", label: "Logs", icon: ScrollText, run: consoleTab("logs") },
    {
      id: "c-input",
      group: "Console",
      label: "Input events",
      icon: MousePointerClick,
      run: consoleTab("input"),
    },
    {
      id: "c-ax",
      group: "Console",
      label: "Accessibility tree",
      icon: Accessibility,
      run: consoleTab("accessibility"),
    },
    {
      id: "c-web",
      group: "Console",
      label: "Web Inspector",
      caption: "Safari and WKWebView pages",
      icon: Globe,
      run: consoleTab("web"),
    },
  );

  const inspectorTab = (tab: Shell["inspectorTab"]) => () => {
    shell.setInspectorTab(tab);
    shell.setInspectorOpen(true);
  };
  out.push(
    {
      id: "i-device",
      group: "Inspector",
      label: "Device",
      caption: "Status bar, location, appearance",
      icon: Smartphone,
      run: inspectorTab("device"),
    },
    {
      id: "i-app",
      group: "Inspector",
      label: "App",
      caption: "Install, permissions, push",
      icon: AppWindow,
      run: inspectorTab("app"),
    },
    {
      id: "i-capture",
      group: "Inspector",
      label: "Captures",
      caption: "Screenshots and recordings",
      icon: Camera,
      run: inspectorTab("capture"),
    },
    {
      id: "i-activity",
      group: "Inspector",
      label: "Activity",
      caption: "CPU, memory and stream health",
      icon: Activity,
      run: inspectorTab("activity"),
    },
  );

  const pref = shell.theme.pref;
  out.push(
    {
      id: "t-auto",
      group: "Theme",
      label: "Auto",
      caption: pref === "auto" ? "Current · follows the system" : "Follow the system",
      icon: Monitor,
      run: () => shell.theme.setPref("auto"),
    },
    {
      id: "t-light",
      group: "Theme",
      label: "Light",
      caption: pref === "light" ? "Current" : undefined,
      icon: Sun,
      run: () => shell.theme.setPref("light"),
    },
    {
      id: "t-dark",
      group: "Theme",
      label: "Dark",
      caption: pref === "dark" ? "Current" : undefined,
      icon: Moon,
      run: () => shell.theme.setPref("dark"),
    },
  );

  if (phonePreviewUrl)
    out.push({
      id: "phone-link",
      group: "Share",
      label: "Copy phone preview link",
      caption: phonePreviewUrl.replace(/^https?:\/\//, ""),
      icon: Link,
      run: () => {
        void navigator.clipboard
          ?.writeText(phonePreviewUrl)
          .then(() => shell.toast({ title: "Phone preview link copied", tone: "success" }))
          .catch(() => shell.toast({ title: "Couldn't copy the link", tone: "danger" }));
      },
    });

  return out;
}

/** ⌘K — every action, tool and simulator, one keystroke away. */
export function CommandPalette(props: CommandPaletteProps) {
  const shell = useShell();
  const { paletteOpen: open, setPaletteOpen } = shell;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [hl, setHl] = useState({ y: 0, h: 0 });
  const openRef = useRef(open);
  openRef.current = open;
  const returnFocus = useRef<HTMLElement | null>(null);

  // Capture phase on window runs before the simulator's key forwarding, so
  // ⌘K never reaches the guest and Escape closes us before anything else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isCommandPaletteShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) setPaletteOpen(!openRef.current);
      } else if (e.key === "Escape" && openRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setPaletteOpen]);

  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setActive(0);
    } else {
      returnFocus.current?.focus?.();
      returnFocus.current = null;
    }
  }, [open]);

  const commands = useMemo(() => buildCommands(shell, props), [shell, props]);
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => setActive(0), [query]);

  // The highlight is one object that slides between rows, not a per-row fill.
  useEffect(() => {
    const el = rowRefs.current[active];
    if (!el) return;
    setHl({ y: el.offsetTop, h: el.offsetHeight });
    el.scrollIntoView({ block: "nearest" });
  }, [active, results, open]);

  const run = (c: PaletteCommand | undefined) => {
    if (!c) return;
    setPaletteOpen(false);
    c.run();
  };

  if (typeof document === "undefined") return null;
  let lastGroup = "";
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          className="fixed inset-0 z-[100]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 1 }}
        >
          <motion.div
            className="absolute inset-0 bg-[var(--scrim)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.2 }}
            onClick={() => setPaletteOpen(false)}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="glass-pop absolute top-[18vh] left-1/2 flex max-h-[min(520px,64vh)] w-[600px] max-w-[calc(100vw-32px)] origin-top flex-col overflow-hidden rounded-[20px]"
            initial={{ opacity: 0, scale: 0.96, y: -8, x: "-50%", filter: "blur(8px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, x: "-50%", filter: "blur(0px)" }}
            exit={{
              opacity: 0,
              scale: 0.98,
              y: -4,
              x: "-50%",
              filter: "blur(4px)",
              transition: { duration: 0.14 },
            }}
            transition={spring.ui}
          >
            <div className="flex h-12 shrink-0 items-center gap-2.5 border-b-[0.5px] border-separator px-4">
              <Search className="size-[17px] text-label-3" strokeWidth={2} />
              <input
                autoFocus
                role="combobox"
                aria-expanded="true"
                aria-controls="command-palette-list"
                aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
                aria-label="Search actions, tools and simulators"
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
            <div
              id="command-palette-list"
              role="listbox"
              className="thin-scrollbar relative min-h-0 flex-1 overflow-y-auto p-1.5"
            >
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
              {results.length === 0 && (
                <div className="py-10 text-center text-footnote text-label-3">
                  No matches for “{query}”.
                </div>
              )}
              {results.map((c, i) => {
                const header = c.group !== lastGroup;
                lastGroup = c.group;
                const Icon = c.icon;
                return (
                  <div key={c.id} role="presentation">
                    {header && (
                      <div
                        role="presentation"
                        className="px-2.5 pt-2.5 pb-1 text-caption font-semibold text-label-3"
                      >
                        {c.group}
                      </div>
                    )}
                    <button
                      id={`cmd-${c.id}`}
                      ref={(el) => {
                        rowRefs.current[i] = el;
                      }}
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      tabIndex={-1}
                      onPointerMove={() => active !== i && setActive(i)}
                      onClick={() => run(c)}
                      className="relative flex h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left outline-none"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-fill-2 text-label [&_svg]:size-[15px]">
                        <Icon strokeWidth={1.9} />
                      </span>
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="truncate text-body font-medium text-label">{c.label}</span>
                        {c.caption && (
                          <span className="truncate text-footnote text-label-3">{c.caption}</span>
                        )}
                      </span>
                      {c.dot && <StatusDot tone={c.dot} live={c.dot === "green"} />}
                      {c.keys && <Shortcut keys={c.keys} />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex h-9 shrink-0 items-center gap-3 border-t-[0.5px] border-separator px-4 text-caption text-label-3">
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
