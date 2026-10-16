import { animate, motion, useMotionValue } from "motion/react";
import { ArrowLeft, Maximize2 } from "lucide-react";
import { useRef } from "react";
import { screenPoints } from "../device/device-frame";
import { ScreenContent } from "../shell/screen";
import { project, spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { Button } from "../ui/button";

const VW = 393;
const VH = 852;
const BTN = 44;
const PAD = 16;

/**
 * The phone page: what a phone on the LAN sees after scanning the QR code.
 * Just the stream, full-bleed, and one fullscreen control you can throw into
 * any corner — its landing spot is projected from the flick's velocity.
 */
export function PhoneScene() {
  const app = useApp();
  const pts = screenPoints("iphone");
  const k = Math.min(VW / pts.width, VH / pts.height);
  const x = useMotionValue(VW - BTN - PAD);
  const y = useMotionValue(VH - BTN - PAD - 24);
  const frame = useRef<HTMLDivElement>(null);
  const corners = [
    [PAD, PAD + 40],
    [VW - BTN - PAD, PAD + 40],
    [PAD, VH - BTN - PAD - 24],
    [VW - BTN - PAD, VH - BTN - PAD - 24],
  ] as const;
  return (
    <div className="stage-bg fixed inset-0 flex items-center justify-center gap-14 max-lg:flex-col max-lg:gap-6">
      <div className="flex max-w-[300px] flex-col gap-3">
        <Button variant="plain" size="sm" icon={<ArrowLeft />} className="-ml-2 self-start" onClick={() => app.set({ scene: "workspace" })}>
          Back to workspace
        </Button>
        <h1 className="text-title1 text-label">Phone preview</h1>
        <p className="text-body text-label-2">
          Scan the QR code from the toolbar and your phone shows just the simulator — full screen, fully touchable.
        </p>
        <p className="text-footnote text-label-3">Drag the fullscreen button and flick it: it lands in whichever corner the throw is heading for.</p>
      </div>
      <div
        ref={frame}
        className="relative overflow-hidden rounded-[54px] bg-black shadow-[0_0_0_10px_#1c1c1e,0_0_0_11px_#3a3a3c,0_40px_80px_-20px_rgba(0,0,0,0.5)]"
        style={{ width: VW, height: VH }}
      >
        <div className="absolute top-1/2 left-1/2 origin-center" style={{ width: pts.width, height: pts.height, transform: `translate(-50%,-50%) scale(${k})` }}>
          <ScreenContent kind="iphone" dark={app.simAppearance === "dark"} appOpen={app.appOpen} onOpenApp={(v) => app.set({ appOpen: v })} />
        </div>
        <motion.button
          type="button"
          aria-label="Enter fullscreen"
          drag
          dragMomentum={false}
          dragConstraints={frame}
          dragElastic={0.12}
          style={{ x, y, width: BTN, height: BTN }}
          whileTap={{ scale: 0.92 }}
          whileDrag={{ scale: 1.08 }}
          onDragEnd={(_, info) => {
            const px = x.get() + project(info.velocity.x, 0.99);
            const py = y.get() + project(info.velocity.y, 0.99);
            const [cx, cy] = [...corners].sort((a, b) => Math.hypot(a[0] - px, a[1] - py) - Math.hypot(b[0] - px, b[1] - py))[0]!;
            animate(x, cx, { ...spring.momentum, velocity: info.velocity.x });
            animate(y, cy, { ...spring.momentum, velocity: info.velocity.y });
          }}
          className="absolute top-0 left-0 z-10 flex cursor-grab items-center justify-center rounded-full text-white active:cursor-grabbing"
        >
          <span className="absolute inset-0 rounded-full bg-black/35 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.35),0_4px_14px_rgba(0,0,0,0.3)] backdrop-blur-xl" />
          <Maximize2 className="relative size-[18px]" strokeWidth={2.2} />
        </motion.button>
      </div>
    </div>
  );
}
