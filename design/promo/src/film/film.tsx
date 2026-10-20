import { curve, ease, H, mix, W, window_ } from "../lib/time";
import { Commands, commandScreen } from "./acts/commands";
import { Finale, Pocket } from "./acts/finale";
import { FirstLight, GhostWindow, Name, NoWindow } from "./acts/opening";
import { StageUI, SWEEP_ORIGIN } from "./acts/stage-ui";
import { Wall } from "./acts/wall";
import { glowOf } from "./assets";
import { cue } from "./cues";
import { Device } from "./device";
import { hero, withVelocity } from "./layout";
import { HeroScreen } from "./screens";

type Theme = "light" | "dark";

/** The room changes appearance the way the Stage does: a sweep out from a point. */
const SWEEPS: { at: number; theme: Theme; origin: { x: number; y: number } }[] = [
  { at: cue.light, theme: "light", origin: SWEEP_ORIGIN },
  { at: cue.dark, theme: "dark", origin: { x: 394, y: 414 } },
];

function themeLayers(t: number) {
  let base: Theme = "dark";
  const active: { theme: Theme; r: number; origin: { x: number; y: number } }[] = [];
  for (const s of SWEEPS) {
    const p = ease(t, s.at, 1.25, curve.fluid);
    if (p >= 1) {
      base = s.theme;
      active.length = 0;
    } else if (p > 0) {
      active.push({ theme: s.theme, r: p * Math.hypot(W, H) * 1.05, origin: s.origin });
    }
  }
  return { base, active };
}

function Hero({ t }: { t: number }) {
  const pose = withVelocity(t, hero);
  const power = ease(t, cue.screenOn, 1.2, curve.fluid);
  const unlock = ease(t, cue.unlock, 0.75, curve.fluid);
  const dark = ease(t, cue.click + 0.05, 0.9, curve.fluid);
  const live = t >= cue.terminal - 0.5 ? commandScreen(t) : null;
  const open = live?.open ?? 0;
  const lit = power * (1 - Math.min(1, open));
  return (
    <Device
      body={{ kind: "iphone" }}
      pose={pose}
      glow={[
        { colors: glowOf("lock"), o: lit * (1 - unlock) },
        { colors: glowOf("homeLight"), o: lit * unlock * (1 - dark) },
        { colors: glowOf("homeDark"), o: lit * unlock * dark },
        { colors: glowOf("settings"), o: power * Math.min(1, open) },
      ]}
    >
      <HeroScreen
        power={power}
        unlock={unlock}
        dark={dark}
        open={open}
        ax={live?.ax ?? 0}
        touch={live?.touch}
        flash={live?.flash ?? 0}
        glare={ease(t, cue.screenOn + 0.9, 1.6, curve.inOut) * 2 - 0.4}
      />
    </Device>
  );
}

/** Everything in the room, in one appearance. */
function Room({ t, theme }: { t: number; theme: Theme }) {
  const lightsUp = ease(t, 0.9, 3.2, curve.fluid);
  const camera =
    mix(1.07, 1, ease(t, 0, 6.5, curve.fluid)) *
    (1 + 0.022 * window_(t, cue.wall + 0.6, cue.wallOut + 0.9, 3.4, 1.1)) *
    (1 + 0.03 * ease(t, cue.mark, 6.5, curve.inOut));
  return (
    <div data-theme={theme} className="stage-bg absolute inset-0 isolate overflow-hidden">
      <div className="absolute inset-0 bg-black" style={{ opacity: 1 - lightsUp }} />
      <div
        className="absolute inset-0"
        style={{ transform: `scale(${camera})`, transformOrigin: "50% 48%" }}
      >
        <FirstLight t={t} />
        <GhostWindow t={t} />
        <Wall t={t} />
        <Hero t={t} />
        <Name t={t} />
        <NoWindow t={t} />
        <Commands t={t} />
        <Pocket t={t} />
        <Finale t={t} />
      </div>
      <StageUI t={t} />
    </div>
  );
}

const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.6 -0.3"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>',
)}")`;

/** The whole film at time t (seconds). */
export function Film({ t }: { t: number }) {
  const { base, active } = themeLayers(t);
  const out = ease(t, cue.fade, cue.end - cue.fade, curve.inOut);
  return (
    <div className="film">
      <Room t={t} theme={base} />
      {active.map((a, i) => (
        <div
          key={i}
          className="absolute inset-0"
          style={{ clipPath: `circle(${a.r}px at ${a.origin.x}px ${a.origin.y}px)` }}
        >
          <Room t={t} theme={a.theme} />
        </div>
      ))}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: GRAIN, opacity: 0.045, mixBlendMode: "overlay" }}
      />
      {out > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: out }} />}
    </div>
  );
}

export const DURATION = cue.end;
