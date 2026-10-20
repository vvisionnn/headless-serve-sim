import { Moon, Search, Sun, SunMoon } from "lucide-react";
import { useLayoutEffect } from "react";
import { Inspector } from "../../../../src/inspector/inspector";
import { useApp } from "../../../../src/lib/store";
import { sims } from "../../../../src/lib/mock";
import { DeviceDock } from "../../../../src/shell/device-dock";
import { Navigator } from "../../../../src/shell/navigator";
import { Toolbar } from "../../../../src/shell/toolbar";
import { Kbd } from "../../../../src/ui/kbd";
import { clamp, curve, ease, mix, spring } from "../../lib/time";
import { cue } from "../cues";
import { PALETTE_KEYS, PALETTE_QUERY } from "../beats";
import { size } from "../device";
import { GAP, hero, INS_W, MAIN, NAV_W } from "../layout";
import { Typed } from "../type";

/* The borrowed Navigator and Toolbar list the preview's sample simulators; in
 * the film they run what the captured devices run. */
const RUNTIMES: Record<string, string> = {
  "iOS 26.1": "iOS 27",
  "watchOS 26.1": "watchOS 27",
  "iOS 18.6": "iOS 26.1",
};
for (const sim of sims) sim.runtime = RUNTIMES[sim.runtime] ?? sim.runtime;

/** Keeps the borrowed Stage store in step with the playhead. */
function Sync({ t }: { t: number }) {
  const { set } = useApp();
  const dark = t >= cue.click + 0.1;
  useLayoutEffect(
    () => set({ simAppearance: dark ? "dark" : "light", appOpen: false }),
    [dark, set],
  );
  return null;
}

/** A surface's way in and out: spring in from its side, back out the same way. */
function slide(t: number, at: number, out: number) {
  return clamp(spring(t, at, 1.05)) - clamp(spring(t, out, 0.95));
}

/* Where the pointer goes; measured off the composed Stage. */
const DOCK_APPEARANCE = { x: 640, y: 749 };
const SEARCH = { x: 950, y: 33 };
export const SWEEP_ORIGIN = SEARCH;

/**
 * Act III: the Stage assembles around the device — toolbar, Navigator,
 * Inspector, dock — exactly as the shipped UI lays it out.
 */
export function StageUI({ t }: { t: number }) {
  if (t < cue.stage - 0.1 || t > cue.stageOut + 1.4) return null;
  const nav = slide(t, cue.navigator, cue.stageOut);
  const ins = slide(t, cue.inspector, cue.stageOut + 0.06);
  const bar = clamp(spring(t, cue.toolbar, 0.8)) * (1 - ease(t, cue.stageOut, 0.4));
  const dock = clamp(spring(t, cue.dock, 0.9)) * (1 - ease(t, cue.stageOut - 0.1, 0.35));
  const h = hero(t);
  return (
    <>
      <Sync t={t} />
      <aside
        className="glass absolute z-30 overflow-hidden rounded-[24px]"
        style={{
          top: GAP,
          bottom: GAP,
          left: GAP,
          width: NAV_W,
          transform: `translateX(${(1 - nav) * -(NAV_W + GAP * 2)}px)`,
          opacity: mix(0.4, 1, nav) * (nav > 0.002 ? 1 : 0),
        }}
      >
        <Navigator />
      </aside>
      <aside
        className="glass absolute z-30 overflow-hidden rounded-[24px]"
        style={{
          top: GAP,
          bottom: GAP,
          right: GAP,
          width: INS_W,
          transform: `translateX(${(1 - ins) * (INS_W + GAP * 2)}px)`,
          opacity: mix(0.4, 1, ins) * (ins > 0.002 ? 1 : 0),
        }}
      >
        <Inspector />
      </aside>
      {bar > 0.002 && (
        <div
          className="absolute top-0 z-20 pt-[6px]"
          style={{
            left: MAIN.left,
            width: MAIN.right - MAIN.left,
            opacity: bar,
            transform: `translateY(${mix(-10, 0, bar)}px)`,
            filter: `blur(${mix(6, 0, bar)}px)`,
          }}
        >
          <Toolbar />
        </div>
      )}
      {dock > 0.002 && (
        <div
          className="absolute top-0 left-0 z-20"
          style={{
            transform: `translate(${h.x}px, ${h.y + size({ kind: "iphone" }, h.s).h / 2 + 22 + mix(14, 0, dock)}px)`,
            opacity: dock,
            filter: `blur(${mix(6, 0, dock)}px)`,
          }}
        >
          <div className="-translate-x-1/2">
            <DeviceDock />
          </div>
        </div>
      )}
      <Palette t={t} />
      <Pointer t={t} />
    </>
  );
}

/** The ⌘K palette, typing its way to the room's appearance. */
function Palette({ t }: { t: number }) {
  const inP = clamp(spring(t, cue.palette, 0.4));
  const outP = ease(t, cue.paletteRun, 0.16, curve.in);
  if (t < cue.palette || outP >= 1) return null;
  const rows = [
    { label: "Auto", caption: "Follow the system", Icon: SunMoon },
    { label: "Light", Icon: Sun },
    { label: "Dark", Icon: Moon },
  ];
  const active = clamp(spring(t, cue.palette + 0.85, 0.22));
  return (
    <div className="absolute inset-0 z-[100]">
      <div className="absolute inset-0 bg-[var(--scrim)]" style={{ opacity: inP * (1 - outP) }} />
      <div
        className="glass-pop absolute top-[146px] left-1/2 flex w-[600px] origin-top flex-col overflow-hidden rounded-[20px]"
        style={{
          opacity: inP * (1 - outP),
          transform: `translateX(-50%) translateY(${mix(-8, 0, inP) - outP * 4}px) scale(${mix(0.96, 1, inP) - outP * 0.02})`,
          filter: `blur(${mix(8, 0, inP) + outP * 4}px)`,
        }}
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b-[0.5px] border-separator px-4">
          <Search className="size-[17px] text-label-3" strokeWidth={2} />
          <span className="flex-1 text-title3 font-normal text-label">
            <Typed text={PALETTE_QUERY} t={t} times={PALETTE_KEYS} />
          </span>
          <Kbd>esc</Kbd>
        </div>
        <div className="relative p-1.5">
          <div className="px-2.5 pt-2.5 pb-1 text-caption font-semibold text-label-3">Theme</div>
          <div
            className="absolute right-1.5 left-1.5 h-10 rounded-[10px] bg-fill-2"
            style={{ top: 6 + 30 + active * 40 }}
          />
          {rows.map(({ label, caption, Icon }) => (
            <div key={label} className="relative flex h-10 items-center gap-2.5 px-2.5">
              <span className="flex size-7 items-center justify-center rounded-[7px] bg-fill-2 text-label [&_svg]:size-[15px]">
                <Icon strokeWidth={1.9} />
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-body font-medium text-label">{label}</span>
                {caption && <span className="text-footnote text-label-3">{caption}</span>}
              </span>
            </div>
          ))}
        </div>
        <div className="flex h-9 items-center gap-3 border-t-[0.5px] border-separator px-4 text-caption text-label-3">
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> to run
          </span>
        </div>
      </div>
    </div>
  );
}

/** macOS pointer: glides along springs, dips when it clicks. */
function Pointer({ t }: { t: number }) {
  const show = ease(t, cue.cursor, 0.3) * (1 - ease(t, cue.stageOut - 0.4, 0.3));
  if (show <= 0) return null;
  const a = clamp(spring(t, cue.cursor, 0.95));
  const b = clamp(spring(t, cue.click + 0.35, 0.85));
  const start = { x: 900, y: 640 };
  const x = mix(start.x, DOCK_APPEARANCE.x, a) + (SEARCH.x - DOCK_APPEARANCE.x) * b;
  const y = mix(start.y, DOCK_APPEARANCE.y, a) + (SEARCH.y - DOCK_APPEARANCE.y) * b;
  const press = (at: number) => Math.sin(Math.PI * clamp((t - at) / 0.18));
  const k = 1 - 0.14 * Math.max(press(cue.click), press(cue.palette - 0.12));
  return (
    <svg
      className="absolute z-[120]"
      width="22"
      height="30"
      viewBox="0 0 22 30"
      style={{
        left: x - 3,
        top: y - 2,
        opacity: show,
        transform: `scale(${k})`,
        transformOrigin: "3px 2px",
        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))",
      }}
    >
      <path
        d="M3 2 L3 24 L8.6 18.6 L12.4 27.2 L16 25.6 L12.3 17.2 L19.6 17.2 Z"
        fill="#000"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
