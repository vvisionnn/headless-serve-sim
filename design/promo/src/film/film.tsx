import { clamp, curve, ease, H, spring, W } from "../lib/time";
import { ColdOpen, shake, Shockwave } from "./acts/cold-open";
import { Commands, commandScreen } from "./acts/commands";
import { consoleAx, consoleHot } from "./acts/console";
import { Finale, Pocket } from "./acts/finale";
import { GhostWindow, NoWindow } from "./acts/opening";
import { StageUI, SWEEP_ORIGIN } from "./acts/stage-ui";
import { Wall } from "./acts/wall";
import { glowOf } from "./assets";
import { wallLandings } from "./beats";
import { cue } from "./cues";
import { Device } from "./device";
import { hero, withVelocity } from "./layout";
import { other, scheme, type Theme } from "./scheme";
import { HeroScreen, settingsCenter } from "./screens";

/** The room changes appearance the way the Stage does: a sweep out from a point. */
const SWEEPS: { at: number; theme: Theme; origin: { x: number; y: number } }[] = [
  { at: cue.sweep, theme: other, origin: SWEEP_ORIGIN },
  { at: cue.back, theme: scheme, origin: { x: 394, y: 414 } },
];

function themeLayers(t: number) {
  let base: Theme = scheme;
  const active: { theme: Theme; r: number; origin: { x: number; y: number } }[] = [];
  for (const s of SWEEPS) {
    const p = ease(t, s.at, 0.9, curve.fluid);
    if (p >= 1) {
      base = s.theme;
      active.length = 0;
    } else if (p > 0) {
      active.push({ theme: s.theme, r: p * Math.hypot(W, H) * 1.05, origin: s.origin });
    }
  }
  return { base, active };
}

/** What the hero's screen shows at t, act by act. */
function heroScreen(t: number) {
  const cmd = t >= cue.terminal - 0.5 ? commandScreen(t) : null;
  const stageOpen =
    clamp(spring(t, cue.tapSettings + 0.06, 0.6, 0.06)) - clamp(spring(t, cue.stageOut - 0.1, 0.45));
  const tapP = (t - cue.tapSettings + 0.05) / 0.5;
  return {
    power: ease(t, cue.slam + 0.04, 0.45, curve.fluid),
    unlock: ease(t, cue.unlock, 0.5, curve.fluid),
    dark: ease(t, cue.appearance + 0.05, 0.6, curve.fluid),
    open: cmd?.open ?? stageOpen,
    ax: cmd?.ax ?? consoleAx(t),
    hot: cmd ? -1 : consoleHot(t),
    touch: cmd?.touch ?? (tapP > 0 && tapP < 1 ? { ...settingsCenter, p: tapP } : undefined),
    flash: cmd?.flash ?? (t >= cue.screenshot ? 0.85 * (1 - ease(t, cue.screenshot, 0.4)) : 0),
    glare: ease(t, cue.slam + 0.25, 1.1, curve.inOut) * 2 - 0.4,
  };
}

function Hero({ t }: { t: number }) {
  const pose = withVelocity(t, hero);
  const s = heroScreen(t);
  const lit = s.power * (1 - Math.min(1, s.open));
  return (
    <Device
      body={{ kind: "iphone" }}
      pose={pose}
      glow={[
        { colors: glowOf("lock"), o: lit * (1 - s.unlock) },
        { colors: glowOf("homeLight"), o: lit * s.unlock * (1 - s.dark) },
        { colors: glowOf("homeDark"), o: lit * s.unlock * s.dark },
        { colors: glowOf("settings"), o: s.power * Math.min(1, s.open) },
      ]}
    >
      <HeroScreen {...s} />
    </Device>
  );
}

/** Every hit that jolts the room: the slam, the wall's landings, the wordmark. */
function jolt(t: number) {
  const hits = [
    { at: cue.slam + 0.1, amp: 11 },
    ...wallLandings().map((l, i) => ({ at: l.t - 0.05, amp: i === 0 ? 4 : 2.5 })),
    { at: cue.mark, amp: 7 },
  ];
  return hits.reduce(
    (a, h) => {
      const s = shake(t, h.at, h.amp);
      return { x: a.x + s.x, y: a.y + s.y };
    },
    { x: 0, y: 0 },
  );
}

/** Everything in the room, in one appearance. */
function Room({ t, theme }: { t: number; theme: Theme }) {
  const j = jolt(t);
  const camera =
    (1 + 0.04 * ease(t, cue.slam, 5, curve.fluid) * (1 - ease(t, cue.stage, 0.6))) *
    (1 + 0.025 * ease(t, cue.wallLine, 8, curve.inOut) * (1 - ease(t, cue.wallOut, 0.5))) *
    (1 + 0.03 * ease(t, cue.mark, 7, curve.inOut));
  return (
    <div data-theme={theme} className="stage-bg absolute inset-0 isolate overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${j.x}px, ${j.y}px) scale(${camera})`,
          transformOrigin: "50% 48%",
        }}
      >
        <ColdOpen t={t} />
        <Shockwave t={t} />
        <GhostWindow t={t} />
        <Wall t={t} />
        <Hero t={t} />
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
    <div className="film" data-scheme={scheme}>
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
      {out > 0 && <div data-theme={scheme} className="stage-bg absolute inset-0" style={{ opacity: out }} />}
    </div>
  );
}

export const DURATION = cue.end;
