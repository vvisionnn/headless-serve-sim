import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Smartphone, Tablet, Watch } from "lucide-react";
import { useState } from "react";
import { DeviceFrame, deviceSize } from "../device/device-frame";
import { sims, type Sim } from "../lib/mock";
import { spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { Button } from "../ui/button";

const glyph = { iphone: Smartphone, ipad: Tablet, watch: Watch };

/**
 * Nothing streaming yet. An empty device waits on the stage; booting one fills
 * it — the empty state and the working state are the same place.
 */
export function EmptyScene() {
  const app = useApp();
  const [booting, setBooting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const a = deviceSize("iphone");
  const s = 0.2;
  const boot = (sim: Sim) => {
    setBooting(sim.udid);
    setTimeout(() => app.set({ scene: "workspace", device: sim.kind }), 2300);
  };
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-16 px-10 max-lg:flex-col max-lg:gap-8">
      <motion.div
        className="relative shrink-0"
        style={{ width: a.width * s, height: a.height * s }}
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      >
        <div style={{ filter: "var(--device-shadow)" }}>
          <DeviceFrame kind="iphone" scale={s}>
            <div className="absolute inset-0 bg-[#050506]">
              {/* An off screen still catches the room's light. */}
              <div className="absolute inset-0 bg-[linear-gradient(125deg,rgba(255,255,255,0.09)_0%,rgba(255,255,255,0.02)_38%,transparent_39%,transparent_100%)]" />
              <AnimatePresence>
                {booting && (
                  <motion.div className="absolute inset-0 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <svg width="96" height="96" viewBox="0 0 24 24" fill="#fff">
                      <path d="M16.37 12.55c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.72-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.6 1.1 8.76.73 1.05 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.32-3.5ZM14.2 6.07c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.56-1.23Z" />
                    </svg>
                    <div className="absolute bottom-[32%] left-1/2 h-[5px] w-[130px] -translate-x-1/2 overflow-hidden rounded-full bg-white/25">
                      <motion.div className="h-full rounded-full bg-white" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 2.2, ease: [0.4, 0, 0.2, 1] }} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </DeviceFrame>
        </div>
      </motion.div>

      <motion.div className="flex w-[380px] flex-col gap-6" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={spring.surface}>
        <div className="flex flex-col gap-2">
          <h1 className="text-title1 text-label">No simulator is streaming</h1>
          <p className="text-body text-label-2">Pick one to boot and stream it here. Everything you do in this window goes straight to the device.</p>
        </div>
        <div className="group-box flex flex-col p-1">
          {sims.slice(0, 5).map((sim) => {
            const G = glyph[sim.kind];
            const isBooting = booting === sim.udid;
            return (
              <div key={sim.udid} className="flex min-h-12 items-center gap-3 rounded-[10px] px-2.5 transition-colors hover:bg-fill-3">
                <span className="flex size-8 items-center justify-center rounded-[9px] bg-fill-2 text-label">
                  <G className="size-4" strokeWidth={1.75} />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-body font-medium text-label">{sim.name}</span>
                  <span className="text-caption text-label-3">{sim.runtime}</span>
                </span>
                <AnimatePresence mode="popLayout" initial={false}>
                  {isBooting ? (
                    <motion.span key="b" className="shimmer-text text-footnote font-semibold" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                      Booting…
                    </motion.span>
                  ) : (
                    <motion.span key="a" exit={{ opacity: 0, scale: 0.9 }}>
                      <Button size="sm" variant={sim.state === "booted" ? "primary" : "secondary"} disabled={!!booting} onClick={() => boot(sim)}>
                        {sim.state === "shutdown" ? "Boot & stream" : "Stream"}
                      </Button>
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-caption font-medium text-label-3">Or start one from the terminal</span>
          <div className="flex h-9 items-center gap-2 rounded-[10px] bg-fill-3 pr-1 pl-3 font-mono text-footnote text-label shadow-[inset_0_0_0_0.5px_var(--separator)]">
            <span className="text-label-3">$</span>
            <span className="flex-1 truncate">headless-serve-sim --detach "iPhone 17 Pro"</span>
            <button
              type="button"
              aria-label="Copy command"
              onClick={() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="flex size-7 items-center justify-center rounded-[7px] text-label-2 hover:bg-fill-2"
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={String(copied)} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={spring.snappy}>
                  {copied ? <Check className="size-3.5 text-green" strokeWidth={2.5} /> : <Copy className="size-3.5" />}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
