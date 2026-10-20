import { Moon, Search, Sun, SunMoon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Inspector } from "../../../../src/inspector/inspector";
import { sims } from "../../../../src/lib/mock";
import { useApp, type Capture } from "../../../../src/lib/store";
import { DeviceDock } from "../../../../src/shell/device-dock";
import { Navigator } from "../../../../src/shell/navigator";
import { Toolbar } from "../../../../src/shell/toolbar";
import { Kbd } from "../../../../src/ui/kbd";
import { EPOCH } from "../../env";
import { clamp, curve, ease, mix, spring } from "../../lib/time";
import { PALETTE_KEYS, PALETTE_QUERY } from "../beats";
import { cue } from "../cues";
import { size } from "../device";
import { GAP, hero, INS_W, MAIN, NAV_W } from "../layout";
import { other } from "../scheme";
import { settingsPoint } from "../screens";
import { Typed } from "../type";
import { Console } from "./console";
import { Toasts } from "./toasts";

/* The borrowed Navigator and Toolbar list the preview's sample simulators; in
 * the film they run what the captured devices run. */
const RUNTIMES: Record<string, string> = {
  "iOS 26.1": "iOS 27",
  "watchOS 26.1": "watchOS 27",
  "iOS 18.6": "iOS 26.1",
};
for (const sim of sims) sim.runtime = RUNTIMES[sim.runtime] ?? sim.runtime;

const BASE_CAPTURES: Capture[] = [
  { id: 1, kind: "screenshot", at: "9:38", meta: "1206 × 2622 · PNG" },
  { id: 2, kind: "recording", at: "9:31", meta: "0:24 · 6.8 MB · MP4" },
];

/** Keeps the borrowed Stage store in step with the playhead. */
function Sync({ t }: { t: number }) {
  const { set } = useApp();
  const dark = t >= cue.appearance + 0.05;
  const recording = t >= cue.record && t < cue.stop;
  const tab = t >= cue.captureTab ? "capture" : "device";
  const saved = t >= cue.stop;
  const shot = t >= cue.screenshot;
  useLayoutEffect(() => {
    set({
      simAppearance: dark ? "dark" : "light",
      appOpen: false,
      recording,
      recordStartedAt: recording ? EPOCH + cue.record * 1000 : null,
      inspectorTab: tab,
      captures: [
        ...(shot ? [{ id: 4, kind: "screenshot" as const, at: "9:41", meta: "1206 × 2622 · PNG" }] : []),
        ...(saved ? [{ id: 3, kind: "recording" as const, at: "9:41", meta: "0:04 · 1.2 MB · MP4" }] : []),
        ...BASE_CAPTURES,
      ],
    });
  }, [dark, recording, tab, saved, shot, set]);
  return null;
}

/** A surface's way in and out: spring in from its side, fling back out the same way. */
function slide(t: number, at: number, out: number) {
  return clamp(spring(t, at, 0.62, 0.06)) - ease(t, out, 0.32, curve.in);
}

/*
 * Where the pointer goes, measured off the composed Stage (the dock sits under
 * the device at STAGE_FIT). The device's own Settings icon is computed from
 * the device's pose.
 */
export const AT = {
  start: { x: 1010, y: 640 },
  appearance: { x: 635, y: 746 },
  search: { x: 967, y: 32 },
  record: { x: 730, y: 746 },
  stop: { x: 731, y: 32 },
  camera: { x: 687, y: 746 },
};
export const SWEEP_ORIGIN = AT.search;

type Stop = { at: number; to: { x: number; y: number }; dur?: number };
const PATH = (): Stop[] => [
  { at: cue.cursor, to: AT.appearance, dur: 0.75 },
  { at: cue.appearance + 0.15, to: AT.search, dur: 0.42 },
  { at: cue.record - 0.8, to: AT.record, dur: 0.55 },
  { at: cue.record + 0.35, to: settingsPoint(hero(cue.tapSettings)), dur: 0.55 },
  { at: cue.tapSettings + 0.5, to: AT.stop, dur: 0.75 },
  { at: cue.stop + 0.3, to: AT.camera, dur: 0.45 },
];
/** Presses: the pointer dips, the thing under it responds on the same frame. */
export const CLICKS = [
  cue.appearance,
  cue.palette - 0.1,
  cue.record,
  cue.tapSettings,
  cue.stop,
  cue.screenshot,
];

export function pointerAt(t: number) {
  let { x, y } = AT.start;
  let prev = AT.start;
  for (const s of PATH()) {
    const p = spring(t, s.at, s.dur ?? 0.6);
    x += (s.to.x - prev.x) * p;
    y += (s.to.y - prev.y) * p;
    prev = s.to;
  }
  return { x, y };
}

/**
 * Act III: the Stage assembles around the device on the beat (toolbar,
 * Navigator, Inspector, dock), exactly as the shipped UI lays it out. Then
 * it is used: appearance, the palette, a recording, a tap, a screenshot, and
 * the console with the device's real accessibility tree.
 */
export function StageUI({ t }: { t: number }) {
  if (t < cue.stage - 0.1 || t > cue.stageOut + 0.8) return null;
  const nav = slide(t, cue.navigator, cue.stageOut);
  const ins = slide(t, cue.inspector, cue.stageOut + 0.04);
  const bar = clamp(spring(t, cue.toolbar, 0.5)) * (1 - ease(t, cue.stageOut, 0.25));
  const dock = clamp(spring(t, cue.dock, 0.55, 0.1)) * (1 - ease(t, cue.stageOut - 0.05, 0.25));
  const tabSwitch = Math.exp(-Math.max(0, t - cue.captureTab) * 9) * (t >= cue.captureTab ? 1 : 0);
  const h = hero(t);
  const recording = t >= cue.record && t < cue.stop;
  return (
    <>
      <Sync t={t} />
      {recording && <RecordGlow t={t} />}
      <aside
        className="glass absolute z-30 overflow-hidden rounded-[24px]"
        style={{
          top: GAP,
          bottom: GAP,
          left: GAP,
          width: NAV_W,
          transform: `translateX(${(1 - nav) * -(NAV_W + GAP * 2)}px)`,
          opacity: mix(0.3, 1, nav) * (nav > 0.002 ? 1 : 0),
          filter: nav < 0.98 ? `blur(${(1 - nav) * 8}px)` : undefined,
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
          opacity: mix(0.3, 1, ins) * (ins > 0.002 ? 1 : 0),
          filter: ins < 0.98 ? `blur(${(1 - ins) * 8}px)` : undefined,
        }}
      >
        <div
          className="h-full"
          style={{ filter: tabSwitch > 0.02 ? `blur(${tabSwitch * 6}px)` : undefined, opacity: 1 - tabSwitch * 0.5 }}
        >
          <Inspector />
        </div>
      </aside>
      {bar > 0.002 && (
        <div
          className="absolute top-0 z-20 pt-[6px]"
          style={{
            left: MAIN.left,
            width: MAIN.right - MAIN.left,
            opacity: bar,
            transform: `translateY(${mix(-14, 0, bar)}px)`,
            filter: `blur(${mix(6, 0, bar)}px)`,
          }}
        >
          <Toolbar />
        </div>
      )}
      {dock > 0.002 && <Dock t={t} h={h} dock={dock} />}
      <Console t={t} />
      <Toasts t={t} />
      <Palette t={t} />
      <Keys t={t} />
      <Pointer t={t} />
    </>
  );
}

/** The dock, under the device; the pointer's position reaches it as real mouse events, so it magnifies. */
function Dock({ t, h, dock }: { t: number; h: ReturnType<typeof hero>; dock: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const p = pointerAt(t);
  const show = pointerShown(t);
  useLayoutEffect(() => {
    const el = ref.current?.firstElementChild;
    if (!el) return;
    const film = el.closest(".film")!.getBoundingClientRect();
    const k = film.width / 1440;
    const r = el.getBoundingClientRect();
    const near = show > 0.5 && Math.abs(p.y * k + film.top - (r.top + r.height / 2)) < 40;
    el.dispatchEvent(
      near
        ? new MouseEvent("mousemove", { bubbles: true, clientX: film.left + p.x * k, clientY: film.top + p.y * k })
        : new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
    );
  });
  return (
    <div
      className="absolute top-0 left-0 z-20"
      style={{
        transform: `translate(${h.x}px, ${h.y + size({ kind: "iphone" }, h.s).h / 2 + 22 + mix(16, 0, dock)}px)`,
        opacity: dock,
        filter: `blur(${mix(6, 0, dock)}px)`,
      }}
    >
      <div ref={ref} className="-translate-x-1/2">
        <DeviceDock />
      </div>
    </div>
  );
}

/** While recording, the floor under the device takes a slow red pulse. */
function RecordGlow({ t }: { t: number }) {
  const h = hero(t);
  const on = ease(t, cue.record, 0.3) * (1 - ease(t, cue.stop - 0.1, 0.25));
  const pulse = 0.65 + 0.35 * Math.cos(((t - cue.record) / 0.5) * Math.PI * 2);
  const { w, h: hh } = size({ kind: "iphone" }, h.s);
  return (
    <div
      aria-hidden
      className="absolute rounded-[50%]"
      style={{
        left: h.x - w * 1.1,
        top: h.y - hh * 0.62,
        width: w * 2.2,
        height: hh * 1.24,
        background: "radial-gradient(closest-side, rgba(255,59,48,0.32), rgba(255,59,48,0.08) 60%, transparent)",
        opacity: on * pulse,
        filter: "blur(30px)",
      }}
    />
  );
}

/** The ⌘K palette, typing its way to the room's appearance. */
function Palette({ t }: { t: number }) {
  const inP = clamp(spring(t, cue.palette, 0.32, 0.06));
  const outP = ease(t, cue.paletteRun, 0.14, curve.in);
  if (t < cue.palette || outP >= 1) return null;
  const rows = [
    { label: "Auto", caption: "Follow the system", Icon: SunMoon },
    { label: "Light", Icon: Sun },
    { label: "Dark", Icon: Moon },
  ];
  // The palette lands on the other appearance from the room's.
  const target = other === "light" ? 1 : 2;
  const active = clamp(spring(t, cue.palette + 0.5, 0.18)) * target;
  return (
    <div className="absolute inset-0 z-[100]">
      <div className="absolute inset-0 bg-[var(--scrim)]" style={{ opacity: inP * (1 - outP) }} />
      <div
        className="glass-pop absolute top-[146px] left-1/2 flex w-[600px] origin-top flex-col overflow-hidden rounded-[20px]"
        style={{
          opacity: inP * (1 - outP),
          transform: `translateX(-50%) translateY(${mix(-10, 0, inP) - outP * 4}px) scale(${mix(0.94, 1, inP) - outP * 0.02})`,
          filter: `blur(${mix(8, 0, clamp(inP)) + outP * 4}px)`,
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

/** Keyboard shortcuts, shown as they're pressed: a glass capsule rises, holds, and goes. */
export const KEYS = [{ at: cue.console - 0.45, keys: ["⌘", "J"], label: "Console" }];
const KEYS_AT = { x: (MAIN.left + MAIN.right) / 2, y: 640 };
function Keys({ t }: { t: number }) {
  return (
    <>
      {KEYS.map((k) => {
        const inP = clamp(spring(t, k.at, 0.35, 0.12));
        const outP = ease(t, k.at + 0.5, 0.2, curve.in);
        if (t < k.at || outP >= 1) return null;
        return (
          <div
            key={k.at}
            className="glass-pop absolute z-[110] flex h-16 items-center gap-3 rounded-[22px] px-5"
            style={{
              left: KEYS_AT.x,
              top: KEYS_AT.y - 32,
              transform: `translateX(-50%) translateY(${mix(14, 0, inP) - outP * 8}px) scale(${mix(0.85, 1, inP)})`,
              opacity: clamp(inP) * (1 - outP),
              filter: `blur(${mix(8, 0, clamp(inP)) + outP * 6}px)`,
            }}
          >
            {k.keys.map((key) => (
              <span
                key={key}
                className="flex size-10 items-center justify-center rounded-[10px] bg-fill-2 text-title2 font-semibold text-label shadow-[inset_0_-1.5px_0_var(--separator)]"
              >
                {key}
              </span>
            ))}
            <span className="ml-1 text-title3 font-semibold text-label">{k.label}</span>
          </div>
        );
      })}
    </>
  );
}

const pointerShown = (t: number) => ease(t, cue.cursor - 0.1, 0.2) * (1 - ease(t, cue.screenshot + 0.45, 0.2));

/** The macOS pointer: it glides on springs and dips when it clicks; over the screen it becomes the Stage's finger. */
function Pointer({ t }: { t: number }) {
  const show = pointerShown(t);
  if (show <= 0) return null;
  const { x, y } = pointerAt(t);
  const press = Math.max(...CLICKS.map((at) => Math.sin(Math.PI * clamp((t - at + 0.06) / 0.18))));
  const finger = within(t, cue.tapSettings - 0.4, cue.tapSettings + 0.45);
  return (
    <>
      {CLICKS.map((at) => {
        const p = ease(t, at, 0.45, curve.quint);
        if (t < at || p >= 1) return null;
        return (
          <span
            key={at}
            className="absolute z-[119] rounded-full border-2 border-[var(--label)]"
            style={{ left: x - 18 * p - 4, top: y - 18 * p - 4, width: 36 * p + 8, height: 36 * p + 8, opacity: (1 - p) * 0.5 }}
          />
        );
      })}
      <span
        className="absolute z-[120] rounded-full"
        style={{
          left: x - 12,
          top: y - 12,
          width: 24,
          height: 24,
          background: "rgba(255,255,255,0.45)",
          border: "1.25px solid rgba(0,0,0,0.55)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.45)",
          opacity: show * finger,
          transform: `scale(${mix(0.6, 1, finger) * (1 - 0.18 * press)})`,
        }}
      />
      <svg
        className="absolute z-[120]"
        width="22"
        height="30"
        viewBox="0 0 22 30"
        style={{
          left: x - 3,
          top: y - 2,
          opacity: show * (1 - finger),
          transform: `scale(${(1 - 0.14 * press) * mix(1, 0.6, finger)})`,
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
    </>
  );
}

/** 1 inside [from, to], with quick edges. */
function within(t: number, from: number, to: number) {
  return Math.min(ease(t, from, 0.15), 1 - ease(t, to - 0.15, 0.15));
}
