import { AnimatePresence, animate, motion } from "motion/react";
import { useEffect, useState } from "react";
import { ConsolePanel } from "../console/console-panel";
import { Inspector } from "../inspector/inspector";
import { rubberband, spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { EmptyScene } from "../scenes/empty-scene";
import { WallScene } from "../scenes/wall-scene";
import { CommandPalette } from "./command-palette";
import { Navigator } from "./navigator";
import { Stage } from "./stage";
import { Toasts } from "./toasts";
import { Toolbar } from "./toolbar";

const NAV_W = 264;
const INS_W = 328;
const GAP = 10;

function useViewport() {
  const [w, setW] = useState(window.innerWidth);
  const [h, setH] = useState(window.innerHeight);
  useEffect(() => {
    const on = () => {
      setW(window.innerWidth);
      setH(window.innerHeight);
    };
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  return { w, h };
}

/**
 * The workspace — Navigator · Stage · Inspector, with the Console drawer under
 * the stage. Panels are floating glass, inset from the window; opening one
 * re-fits the stage on a spring so the device glides rather than jumps.
 */
export function Workspace() {
  const app = useApp();
  const { w, h } = useViewport();
  // Narrow windows: panels float over the stage instead of squeezing it.
  const overlay = w < 1080;
  const navOpen = app.navigatorOpen && app.scene !== "phone";
  const insOpen = app.inspectorOpen && app.scene !== "empty";
  const left = navOpen && !overlay ? NAV_W + GAP * 2 : 0;
  const right = insOpen && !overlay ? INS_W + GAP * 2 : 0;
  const [consoleH, setConsoleH] = useState(300);
  const consoleOpen = app.consoleOpen && app.scene !== "empty";

  useShortcuts();

  return (
    <div className="stage-bg fixed inset-0 overflow-hidden">
      <AnimatePresence>
        {navOpen && (
          <motion.aside
            key="nav"
            className="glass absolute z-30 overflow-hidden rounded-[24px]"
            style={{ top: GAP, bottom: GAP, left: GAP, width: NAV_W }}
            initial={{ x: -NAV_W - GAP * 2, opacity: 0.4 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -NAV_W - GAP * 2, opacity: 0.4 }}
            transition={spring.surface}
          >
            <Navigator />
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {insOpen && (
          <motion.aside
            key="ins"
            className="glass absolute z-30 overflow-hidden rounded-[24px]"
            style={{ top: GAP, bottom: GAP, right: GAP, width: INS_W }}
            initial={{ x: INS_W + GAP * 2, opacity: 0.4 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: INS_W + GAP * 2, opacity: 0.4 }}
            transition={spring.surface}
          >
            <Inspector />
          </motion.aside>
        )}
      </AnimatePresence>

      <motion.main className="absolute top-0 bottom-0" initial={false} animate={{ left, right }} transition={spring.surface}>
        <div className="absolute inset-x-0 top-[52px] bottom-0">
          <AnimatePresence mode="popLayout">
            {(app.scene === "workspace" || app.scene === "disconnected") && (
              <motion.div key="stage" className="absolute inset-0" exit={{ opacity: 0, transition: { duration: 0.2 } }}>
                <Stage insetBottom={consoleOpen ? consoleH + GAP : 0} />
              </motion.div>
            )}
            {app.scene === "wall" && (
              <motion.div key="wall" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <WallScene insetBottom={consoleOpen ? consoleH + GAP : 0} />
              </motion.div>
            )}
            {app.scene === "empty" && (
              <motion.div key="empty" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <EmptyScene />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="absolute inset-x-0 top-0 z-20 pt-[6px]">
          <Toolbar />
        </div>

        <AnimatePresence>
          {consoleOpen && <ConsoleDrawer height={consoleH} maxH={h * 0.62} onHeight={setConsoleH} />}
        </AnimatePresence>
      </motion.main>

      <Toasts />
      <CommandPalette />
    </div>
  );
}

/** Console drawer — rises from the bottom edge and leaves the same way. */
function ConsoleDrawer({ height, maxH, onHeight }: { height: number; maxH: number; onHeight: (h: number) => void }) {
  const [drag, setDrag] = useState<{ y: number; h: number } | null>(null);
  const MIN = 180;
  return (
    <motion.section
      className="glass absolute z-20 flex flex-col overflow-hidden rounded-[22px]"
      style={{ left: GAP, right: GAP, bottom: GAP, height }}
      initial={{ y: height + GAP * 2, opacity: 0.5 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: height + GAP * 2, opacity: 0.5 }}
      transition={spring.surface}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize console"
        className="group absolute inset-x-0 top-0 z-10 flex h-2 cursor-row-resize justify-center touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ y: e.clientY, h: height });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const raw = drag.h + (drag.y - e.clientY);
          // Past the limits the edge keeps following, but with resistance.
          const next = raw < MIN ? MIN - rubberband(MIN - raw, 200) : raw > maxH ? maxH + rubberband(raw - maxH, 200) : raw;
          onHeight(next);
        }}
        onPointerUp={() => {
          setDrag(null);
          const clamped = Math.min(maxH, Math.max(MIN, height));
          if (clamped !== height) animate(height, clamped, { ...spring.momentum, onUpdate: onHeight });
        }}
      >
        <span className="mt-1 h-1 w-9 rounded-full bg-label-4 opacity-0 transition-opacity group-hover:opacity-100" style={{ opacity: drag ? 1 : undefined }} />
      </div>
      <ConsolePanel />
    </motion.section>
  );
}

function useShortcuts() {
  const app = useApp();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (e.metaKey && !e.shiftKey && !e.altKey && k === "0") run(() => app.set((s) => ({ navigatorOpen: !s.navigatorOpen })));
      else if (e.metaKey && e.altKey && (k === "0" || e.code === "Digit0")) run(() => app.set((s) => ({ inspectorOpen: !s.inspectorOpen })));
      else if (e.metaKey && k === "j") run(() => app.set((s) => ({ consoleOpen: !s.consoleOpen })));
      else if (e.metaKey && !e.shiftKey && k === "s") run(app.screenshot);
      else if (e.metaKey && e.shiftKey && k === "a") run(() => app.set((s) => ({ simAppearance: s.simAppearance === "dark" ? "light" : "dark" })));
      else if (e.metaKey && e.shiftKey && k === "h") run(() => app.set({ appOpen: false }));
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [app]);
}
