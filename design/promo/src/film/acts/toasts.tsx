import { CircleCheck } from "lucide-react";
import { clamp, curve, ease, mix, spring } from "../../lib/time";
import { cue } from "../cues";
import { INS_W } from "../layout";

/** The Stage's toasts, drawn from the playhead: newest in front, the rest stacked behind. */
export const TOASTS = [
  { at: cue.saved, title: "Recording saved", detail: "Recording 9.41.mp4 · 0:04 · 1.2 MB" },
  { at: cue.screenshot + 0.12, title: "Screenshot saved", detail: "Screenshot 9.41.png · 1206 × 2622" },
];

export function Toasts({ t }: { t: number }) {
  const out = ease(t, cue.console - 0.1, 0.3, curve.in);
  if (t < TOASTS[0]!.at || out >= 1) return null;
  const shown = TOASTS.filter((x) => t >= x.at);
  return (
    <div className="absolute z-[60] w-[320px]" style={{ right: INS_W + 30, bottom: 20 }}>
      {shown.map((x, i) => {
        // How many arrived after this one, eased: it slides back as each does.
        const behind = shown.slice(i + 1).reduce((a, n) => a + clamp(spring(t, n.at, 0.4)), 0);
        const p = spring(t, x.at, 0.45, 0.14);
        return (
          <div
            key={x.at}
            className="glass-pop absolute right-0 bottom-0 left-0 flex items-center gap-3 rounded-[16px] px-3.5 py-3"
            style={{
              zIndex: 10 - Math.round(behind),
              transformOrigin: "50% 100%",
              opacity: clamp(p * 2) * (1 - out) * (behind > 2 ? 0 : 1),
              transform: `translateY(${mix(24, 0, p) - behind * 9 + out * 20}px) scale(${mix(0.94, 1, clamp(p)) - behind * 0.045})`,
              filter: `blur(${mix(6, 0, clamp(p))}px)`,
            }}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-green/12 text-green">
              <CircleCheck className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-semibold text-label">{x.title}</span>
              <span className="truncate font-mono text-caption text-label-3">{x.detail}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
