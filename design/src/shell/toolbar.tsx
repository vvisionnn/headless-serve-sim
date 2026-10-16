import { Menu } from "@base-ui/react/menu";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, LayoutGrid, PanelBottom, PanelLeft, PanelRight, Search, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { sims } from "../lib/mock";
import { spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { StatusDot } from "../ui/badge";
import { IconButton } from "../ui/button";
import { GlassGroup } from "../ui/glass";
import { Kbd } from "../ui/kbd";
import { RollingNumber } from "../ui/rolling-number";
import { Tip } from "../ui/tooltip";
import { PhoneLinkButton } from "./phone-link";

/**
 * Toolbar: transparent, floating over the stage. Controls sit in Liquid Glass
 * capsules grouped by what they act on; the title is the current simulator,
 * and it is also the switcher.
 */
export function Toolbar() {
  const app = useApp();
  const wall = app.scene === "wall";
  return (
    <div className="pointer-events-none relative flex h-[52px] items-center gap-2 px-2.5 [&>*]:pointer-events-auto">
      <GlassGroup>
        <Tip label={app.navigatorOpen ? "Hide simulators" : "Show simulators"} keys={["⌘", "0"]}>
          <IconButton label="Toggle simulators" onClick={() => app.set((s) => ({ navigatorOpen: !s.navigatorOpen }))}>
            <PanelLeft />
          </IconButton>
        </Tip>
      </GlassGroup>

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={wall ? "wall" : app.scene === "empty" ? "empty" : app.device} initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -6, filter: "blur(4px)" }} transition={spring.ui}>
          {wall ? <WallTitle /> : app.scene === "empty" ? <EmptyTitle /> : <DeviceTitle />}
        </motion.div>
      </AnimatePresence>

      <div className="flex-1" />

      <RecordingPill />

      <div className="flex-1" />

      <GlassGroup>
        <Tip label={wall ? "Focus on one simulator" : "Show all simulators"}>
          <IconButton label="Toggle wall view" active={wall} onClick={() => app.set({ scene: wall ? "workspace" : "wall" })}>
            <LayoutGrid />
          </IconButton>
        </Tip>
        <PhoneLinkButton />
        <Tip label={app.consoleOpen ? "Hide console" : "Show console"} keys={["⌘", "J"]}>
          <IconButton label="Toggle console" active={app.consoleOpen} onClick={() => app.set((s) => ({ consoleOpen: !s.consoleOpen }))}>
            <PanelBottom />
          </IconButton>
        </Tip>
      </GlassGroup>
      <GlassGroup>
        <button
          type="button"
          onClick={() => app.set({ paletteOpen: true })}
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
        <Tip label={app.inspectorOpen ? "Hide inspector" : "Show inspector"} keys={["⌥", "⌘", "0"]}>
          <IconButton label="Toggle inspector" onClick={() => app.set((s) => ({ inspectorOpen: !s.inspectorOpen }))}>
            <PanelRight />
          </IconButton>
        </Tip>
      </GlassGroup>
    </div>
  );
}

function useFps() {
  const [fps, setFps] = useState(60);
  useEffect(() => {
    const t = setInterval(() => setFps(Math.random() < 0.8 ? 60 : 58 + Math.round(Math.random())), 1400);
    return () => clearInterval(t);
  }, []);
  return fps;
}

function DeviceTitle() {
  const app = useApp();
  const fps = useFps();
  const sim = sims.find((s) => s.kind === app.device)!;
  const disconnected = app.scene === "disconnected";
  const live = sims.filter((s) => s.state === "live");
  return (
    <Menu.Root>
      <Menu.Trigger className="group flex h-10 flex-col justify-center rounded-[12px] px-2.5 text-left outline-none transition-colors hover:bg-fill-3 data-[popup-open]:bg-fill-3">
        <span className="flex items-center gap-1 text-headline text-label">
          {sim.name}
          <ChevronDown className="size-3.5 text-label-3 transition-transform duration-300 group-data-[popup-open]:rotate-180" strokeWidth={2.25} />
        </span>
        <span className="flex items-center gap-1.5 text-caption text-label-2">
          {sim.runtime}
          <span className="text-label-4">·</span>
          {disconnected ? (
            <>
              <StatusDot tone="orange" /> Reconnecting
            </>
          ) : (
            <>
              <StatusDot tone="green" live />
              <span className="flex items-center gap-1 font-mono">
                <RollingNumber value={String(fps)} /> fps
              </span>
            </>
          )}
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start" className="z-[80]">
          <Menu.Popup className="glass-pop menu-pop min-w-[260px] origin-[var(--transform-origin)] rounded-[14px] p-[5px] outline-none">
            <div className="px-2.5 pt-1.5 pb-1 text-caption font-semibold text-label-3">Streaming now</div>
            {live.map((s) => (
              <Menu.Item
                key={s.udid}
                onClick={() => app.set({ device: s.kind, scene: "workspace" })}
                className="flex min-h-9 cursor-default items-center gap-2.5 rounded-[9px] px-2.5 text-body outline-none select-none data-[highlighted]:bg-ink data-[highlighted]:text-on-ink"
              >
                <span className="flex w-3.5 justify-center">{s.kind === app.device && <Check className="size-3.5" strokeWidth={2.5} />}</span>
                <span className="flex-1">{s.name}</span>
                <span className="font-mono text-caption opacity-60">:{s.port}</span>
              </Menu.Item>
            ))}
            <div className="mx-2 my-1 h-px bg-separator" />
            <Menu.Item
              onClick={() => app.set({ navigatorOpen: true })}
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

function EmptyTitle() {
  return (
    <div className="flex h-10 flex-col justify-center px-2.5">
      <span className="text-headline text-label">No simulator</span>
      <span className="flex items-center gap-1.5 text-caption text-label-2">
        <StatusDot tone="neutral" /> Nothing streaming
      </span>
    </div>
  );
}

function WallTitle() {
  return (
    <div className="flex h-10 flex-col justify-center px-2.5">
      <span className="text-headline text-label">All simulators</span>
      <span className="flex items-center gap-1.5 text-caption text-label-2">
        <StatusDot tone="green" live /> 3 streaming · 1 booted
      </span>
    </div>
  );
}

/** While recording, a red capsule holds the toolbar's centre — always visible. */
function RecordingPill() {
  const { recording, recordStartedAt, toggleRecording } = useApp();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [recording]);
  const secs = recording && recordStartedAt ? Math.floor((now - recordStartedAt) / 1000) : 0;
  return (
    <AnimatePresence>
      {recording && (
        <motion.button
          type="button"
          onClick={toggleRecording}
          className={cn("glass-sm absolute left-1/2 flex h-8 items-center gap-2 rounded-full pr-1 pl-3 text-body font-semibold text-label")}
          initial={{ opacity: 0, scale: 0.6, x: "-50%", filter: "blur(6px)" }}
          animate={{ opacity: 1, scale: 1, x: "-50%", filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.7, x: "-50%", filter: "blur(6px)" }}
          transition={spring.ui}
        >
          <StatusDot tone="red" live className="size-2" />
          <span className="font-mono tabular">
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
          </span>
          <span className="flex h-6 items-center gap-1 rounded-full bg-red px-2.5 text-footnote font-semibold text-white">
            <Square className="size-2.5" fill="currentColor" /> Stop
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
