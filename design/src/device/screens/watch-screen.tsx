import { AnimatePresence, motion } from "motion/react";
import { spring } from "../../lib/motion";

function Ring({ r, p, color, w = 6 }: { r: number; p: number; color: string; w?: number }) {
  const c = 2 * Math.PI * r;
  return (
    <>
      <circle r={r} fill="none" stroke={color} strokeOpacity="0.22" strokeWidth={w} />
      <circle r={r} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90)" />
    </>
  );
}

/** Watch face, and the Trails workout when the app is foreground. */
export function WatchScreen({ appOpen, onOpenApp }: { appOpen: boolean; onOpenApp: (v: boolean) => void }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black text-white" style={{ fontFamily: "var(--font-rounded)" }} onClick={() => onOpenApp(!appOpen)}>
      <AnimatePresence initial={false} mode="popLayout">
        {!appOpen ? (
          <motion.div key="face" className="absolute inset-0" initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }} transition={spring.surface}>
            <div className="absolute top-[22px] left-[22px] text-[13px] font-semibold text-[#ff9f0a]">FRI 17</div>
            <div className="absolute top-[34px] left-[18px] text-[78px] leading-none font-semibold tracking-[-0.04em] tabular-nums">10:09</div>
            <svg className="absolute bottom-[26px] left-[22px]" width="62" height="62" viewBox="-31 -31 62 62">
              <Ring r={26} p={0.72} color="#fa114f" />
              <Ring r={18.5} p={0.54} color="#a6ff00" />
              <Ring r={11} p={0.88} color="#00f0ff" />
            </svg>
            <div className="absolute right-[22px] bottom-[34px] flex flex-col items-end">
              <span className="text-[30px] leading-none font-semibold">21°</span>
              <span className="text-[12px] font-semibold text-[#7ec8ff]">CUPERTINO</span>
            </div>
          </motion.div>
        ) : (
          <motion.div key="app" className="absolute inset-0 px-[18px] pt-[16px]" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={spring.surface}>
            <div className="flex items-center justify-between text-[13px] font-semibold">
              <span className="text-[#3fd0a0]">Trails</span>
              <span>10:09</span>
            </div>
            <div className="mt-3 text-[15px] font-semibold text-[#ffd60a] tabular-nums">00:24:18.32</div>
            <div className="mt-1 text-[44px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
              2.41<span className="text-[22px] text-white/70">KM</span>
            </div>
            <div className="mt-2 text-[26px] leading-none font-semibold tabular-nums">
              5'42"<span className="text-[13px] text-white/60"> /KM</span>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[26px] leading-none font-semibold tabular-nums">
              148<span className="text-[13px] text-[#ff375f]">BPM</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
