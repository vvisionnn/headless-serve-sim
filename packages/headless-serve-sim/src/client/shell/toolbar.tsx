import { Menu } from "@base-ui/react/menu";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  LayoutGrid,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Search,
  Square,
} from "lucide-react";
import { useEffect, useState, type MutableRefObject, type ReactNode } from "react";
import { spring } from "../lib/motion";
import { StatusDot } from "../ui/badge";
import { IconButton } from "../ui/button";
import { GlassGroup } from "../ui/glass";
import { Kbd } from "../ui/kbd";
import { RollingNumber } from "../ui/rolling-number";
import { Tip } from "../ui/tooltip";
import { runtimeLabel, type SimDevice } from "../utils/devices";
import { useElapsed } from "./device-dock";
import { useShell } from "./shell-context";

/**
 * Toolbar: transparent, floating over the stage. Controls sit in Liquid Glass
 * capsules grouped by what they act on; the title is the current simulator,
 * and it is also the switcher.
 */
export function Toolbar({
  devices,
  fpsSinkRef,
  wallSummary,
  phoneLink,
  onSelectDevice,
}: {
  devices: SimDevice[];
  /** Receives painted frames per second about once a second. */
  fpsSinkRef: MutableRefObject<((fps: number) => void) | null>;
  /** e.g. "3 streaming · 1 booted" — shown as the Wall's subtitle. */
  wallSummary: string;
  phoneLink?: ReactNode;
  onSelectDevice: (device: SimDevice) => void;
}) {
  const shell = useShell();
  const wall = shell.wallOpen;
  return (
    <div className="pointer-events-none relative flex h-[52px] items-center gap-2 px-2.5 [&>*]:pointer-events-auto">
      <GlassGroup>
        <Tip label={shell.navigatorOpen ? "Hide simulators" : "Show simulators"} keys={["⌘", "0"]}>
          <IconButton label="Toggle simulators" onClick={() => shell.setNavigatorOpen((o) => !o)}>
            <PanelLeft />
          </IconButton>
        </Tip>
      </GlassGroup>

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={wall ? "wall" : (shell.device?.udid ?? "none")}
          initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
          transition={spring.ui}
        >
          {wall ? (
            <PlainTitle title="All simulators" live detail={wallSummary} />
          ) : (
            <DeviceTitle
              devices={devices}
              fpsSinkRef={fpsSinkRef}
              onSelectDevice={onSelectDevice}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex-1" />
      <RecordingPill />
      <div className="flex-1" />

      <GlassGroup>
        <Tip label={wall ? "Focus on one simulator" : "Show all simulators"}>
          <IconButton
            label="Toggle wall view"
            active={wall}
            onClick={() => shell.setWallOpen(!wall)}
          >
            <LayoutGrid />
          </IconButton>
        </Tip>
        {phoneLink}
        <Tip label={shell.consoleOpen ? "Hide console" : "Show console"} keys={["⌘", "J"]}>
          <IconButton
            label="Toggle console"
            active={shell.consoleOpen}
            onClick={() => shell.setConsoleOpen((o) => !o)}
          >
            <PanelBottom />
          </IconButton>
        </Tip>
      </GlassGroup>
      <GlassGroup>
        <button
          type="button"
          onClick={() => shell.setPaletteOpen(true)}
          className="flex h-8 items-center gap-2 rounded-full pr-1.5 pl-2.5 text-body text-label-2 transition-colors hover:bg-fill-2"
        >
          <Search className="size-[15px]" strokeWidth={2} />
          <span className="hidden xl:inline">Search</span>
          <span className="flex gap-0.5">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </GlassGroup>
      <GlassGroup>
        <Tip
          label={shell.inspectorOpen ? "Hide inspector" : "Show inspector"}
          keys={["⌥", "⌘", "0"]}
        >
          <IconButton label="Toggle inspector" onClick={() => shell.setInspectorOpen((o) => !o)}>
            <PanelRight />
          </IconButton>
        </Tip>
      </GlassGroup>
    </div>
  );
}

function PlainTitle({ title, detail, live }: { title: string; detail: string; live?: boolean }) {
  return (
    <div className="flex h-10 flex-col justify-center px-2.5">
      <span className="text-headline text-label">{title}</span>
      <span className="flex items-center gap-1.5 text-caption text-label-2">
        <StatusDot tone={live ? "green" : "neutral"} live={live} /> {detail}
      </span>
    </div>
  );
}

function DeviceTitle({
  devices,
  fpsSinkRef,
  onSelectDevice,
}: {
  devices: SimDevice[];
  fpsSinkRef: MutableRefObject<((fps: number) => void) | null>;
  onSelectDevice: (device: SimDevice) => void;
}) {
  const shell = useShell();
  const [fps, setFps] = useState<number | null>(null);
  useEffect(() => {
    fpsSinkRef.current = (next) => setFps(Math.round(next));
    return () => {
      fpsSinkRef.current = null;
    };
  }, [fpsSinkRef]);
  const device = shell.device;
  const booted = devices.filter((d) => d.state === "Booted");
  return (
    <Menu.Root>
      <Menu.Trigger className="group flex h-10 flex-col justify-center rounded-[12px] px-2.5 text-left outline-none transition-colors hover:bg-fill-3 data-[popup-open]:bg-fill-3">
        <span className="flex items-center gap-1 text-headline text-label">
          {device?.name ?? "Simulator"}
          <ChevronDown
            className="size-3.5 text-label-3 transition-transform duration-300 group-data-[popup-open]:rotate-180"
            strokeWidth={2.25}
          />
        </span>
        <span className="flex items-center gap-1.5 text-caption text-label-2">
          {device?.runtime && (
            <>
              {runtimeLabel(device.runtime)}
              <span className="text-label-4">·</span>
            </>
          )}
          {shell.streaming ? (
            <>
              <StatusDot tone="green" live />
              {/* A still screen streams ~1 frame/s: that's idle, not slow. */}
              {fps != null && fps >= 2 ? (
                <span className="flex items-center gap-1 font-mono">
                  <RollingNumber value={String(fps)} /> fps
                </span>
              ) : (
                "Live"
              )}
            </>
          ) : (
            <>
              <StatusDot tone="orange" /> Connecting
            </>
          )}
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start" className="z-[80]">
          <Menu.Popup className="glass-pop menu-pop min-w-[260px] origin-[var(--transform-origin)] rounded-[14px] p-[5px] outline-none">
            <div className="px-2.5 pt-1.5 pb-1 text-caption font-semibold text-label-3">Booted</div>
            {booted.map((d) => (
              <Menu.Item
                key={d.udid}
                onClick={() => onSelectDevice(d)}
                className="flex min-h-9 cursor-default items-center gap-2.5 rounded-[9px] px-2.5 text-body outline-none select-none data-[highlighted]:bg-ink data-[highlighted]:text-on-ink"
              >
                <span className="flex w-3.5 justify-center">
                  {d.udid === device?.udid && <Check className="size-3.5" strokeWidth={2.5} />}
                </span>
                <span className="flex-1">{d.name}</span>
                <span className="text-caption opacity-60">{runtimeLabel(d.runtime)}</span>
              </Menu.Item>
            ))}
            {booted.length > 0 && <div className="mx-2 my-1 h-px bg-separator" />}
            <Menu.Item
              onClick={() => shell.setNavigatorOpen(true)}
              className="flex min-h-8 cursor-default items-center rounded-[9px] px-2.5 pl-8 text-body text-label-2 outline-none select-none data-[highlighted]:bg-ink data-[highlighted]:text-on-ink"
            >
              All simulators…
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** While recording, a red capsule holds the toolbar's centre — always visible. */
function RecordingPill() {
  const { recording } = useShell();
  const on = recording.status === "recording";
  const elapsed = useElapsed(on ? recording.startedAt : null);
  return (
    <AnimatePresence>
      {on && (
        <motion.button
          type="button"
          onClick={recording.stop}
          aria-label="Stop recording"
          className="glass-sm absolute left-1/2 flex h-8 items-center gap-2 rounded-full pr-1 pl-3 text-body font-semibold text-label"
          initial={{ opacity: 0, scale: 0.6, x: "-50%", filter: "blur(6px)" }}
          animate={{ opacity: 1, scale: 1, x: "-50%", filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.7, x: "-50%", filter: "blur(6px)" }}
          transition={spring.ui}
        >
          <StatusDot tone="red" live className="size-2" />
          <span className="font-mono tabular">{elapsed}</span>
          <span className="flex h-6 items-center gap-1 rounded-full bg-red px-2.5 text-footnote font-semibold text-white">
            <Square className="size-2.5" fill="currentColor" /> Stop
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
