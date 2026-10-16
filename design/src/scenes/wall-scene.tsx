import { motion } from "motion/react";
import { Play } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { DeviceFrame, deviceSize } from "../device/device-frame";
import { glowFor, ScreenGlow } from "../shell/stage";
import { ScreenContent } from "../shell/screen";
import { sims, type Sim } from "../lib/mock";
import { spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { StatusDot } from "../ui/badge";
import { Button } from "../ui/button";

const wall: Sim[] = [sims[0]!, sims[1]!, sims[2]!, sims[3]!];

/**
 * Wall: every running simulator side by side, each live. Click one and it
 * flies forward into the stage — the same object, not a new screen.
 */
export function WallScene({ insetBottom }: { insetBottom: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1000, h: 700 });
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setBox({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);
  const cols = box.w > 1100 ? 4 : 2;
  const rows = Math.ceil(wall.length / cols);
  const cellW = (box.w - 48) / cols;
  const cellH = (box.h - insetBottom - 40) / rows;
  return (
    <div ref={ref} className="absolute inset-0">
      <div className="absolute inset-x-6 top-2 grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, bottom: insetBottom + 24 }}>
        {wall.map((s, i) => (
          <Tile key={s.udid} sim={s} index={i} cellW={cellW} cellH={cellH} />
        ))}
      </div>
    </div>
  );
}

function Tile({ sim, index, cellW, cellH }: { sim: Sim; index: number; cellW: number; cellH: number }) {
  const app = useApp();
  const live = sim.state === "live";
  const kind = sim.kind;
  const a = deviceSize(kind);
  // A product lineup, not a grid of equal boxes: each device keeps a height
  // proportional to the family, so a watch reads as a watch beside a phone.
  const share = kind === "watch" ? 0.34 : kind === "ipad" ? 0.74 : 1;
  const fit = Math.min((cellW * 0.86) / a.width, ((cellH - 72) * 0.82 * share) / a.height);
  const [hover, setHover] = useState(false);
  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-4"
      initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ ...spring.surface, delay: 0.06 * index }}
    >
      <motion.button
        type="button"
        disabled={!live}
        onHoverStart={() => setHover(true)}
        onHoverEnd={() => setHover(false)}
        onClick={() => live && app.set({ device: kind, scene: "workspace" })}
        className="relative outline-none"
        style={{ width: a.width * fit, height: a.height * fit }}
        animate={{ y: hover && live ? -6 : 0 }}
        transition={spring.ui}
        aria-label={`Focus ${sim.name}`}
      >
        <motion.div layoutId={live ? `device-${sim.udid}` : undefined} className="absolute inset-0" transition={spring.surface}>
          {live && <ScreenGlow colors={glowFor(kind, kind === "iphone" && app.appOpen, app.simAppearance === "dark")} w={a.width * fit} h={a.height * fit} />}
          <div className="relative" style={{ filter: "var(--device-shadow)" }}>
            <DeviceFrame kind={kind} scale={fit}>
              {live ? (
                <div className="pointer-events-none absolute inset-0">
                  <ScreenContent kind={kind} dark={app.simAppearance === "dark"} appOpen={kind === "iphone" ? app.appOpen : false} onOpenApp={() => {}} />
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0b0b0d] text-white">
                  <span className="text-[17px] font-semibold">Not streaming</span>
                  <span className="rounded-full bg-white/14 px-4 py-2 text-[15px] font-semibold">Start stream</span>
                </div>
              )}
            </DeviceFrame>
          </div>
        </motion.div>
      </motion.button>
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-headline text-label">{sim.name}</span>
        <span className="flex items-center gap-1.5 text-caption text-label-2">
          {live ? (
            <>
              <StatusDot tone="green" live /> Live <span className="font-mono">:{sim.port}</span>
            </>
          ) : (
            <>
              <StatusDot tone="neutral" /> Booted
              <Button size="sm" variant="plain" icon={<Play fill="currentColor" className="!size-2.5" />} className="ml-1 h-5 px-2">
                Stream
              </Button>
            </>
          )}
        </span>
      </div>
    </motion.div>
  );
}
