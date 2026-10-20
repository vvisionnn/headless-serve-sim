import { StatusDot } from "../../../../src/ui/badge";
import { clamp, curve, ease, FPS, mix, spring } from "../../lib/time";
import { duoGlow, glowOf, type Screen } from "../assets";
import { commands, cue, keyTimes, land } from "../cues";
import { Device, type Pose } from "../device";
import { duoAngle, FLOOR, wall, WALL_BOUNCE, WALL_DUR } from "../layout";
import { StillScreen } from "../screens";
import { Typed, Words } from "../type";

const SCREEN: Record<string, Screen> = { ipad: "ipad", air: "air", watch: "watch" };

/** A thrown device: up from below the floor, turning as it comes, landing with give. */
function thrown(t: number, d: ReturnType<typeof wall>[number], i: number): Pose {
  const y = (tt: number) => mix(380, 0, spring(tt, d.at, WALL_DUR, WALL_BOUNCE));
  // They leave on the beat, one after another, dropping back the way they came.
  const out = ease(t, cue.wallOut + i * 0.08, 0.45, curve.in);
  const side = d.place.x < 720 ? -1 : 1;
  const turn = spring(t, d.at, 0.9, 0.22);
  return {
    x: d.place.x + side * mix(60, 0, turn),
    y: d.place.y + y(t) + out * 520,
    s: d.s,
    opacity: ease(t, d.at, 0.15) * (1 - ease(t, cue.wallOut + i * 0.08 + 0.3, 0.15)),
    blur: mix(8, 0, clamp(spring(t, d.at, 0.5))),
    roll: side * mix(14, 0, turn) + out * side * -10,
    tiltX: mix(30, 0, turn),
    tiltY: side * mix(-26, 0, turn),
    vy: (y(t) - y(t - 1 / FPS)) * 0.7 + out * 30,
  };
}

/**
 * Act V: every simulator family, thrown up onto one floor on the beat. Each
 * lands with a little give and lights the floor with its own screen. A command
 * types itself above the closed iPhone Duo, and the real hinge opens it.
 */
export function Wall({ t }: { t: number }) {
  if (t < cue.stageOut || t > cue.wallOut + 1.2) return null;
  const angle = duoAngle(t);
  return (
    <>
      <div className="display absolute left-0 w-full text-center" style={{ top: 92, fontSize: 56 }}>
        <Words
          text="Every simulator, side by side."
          t={t}
          at={cue.wallLine}
          out={cue.wallOut - 0.2}
          className="text-label"
        />
      </div>
      {wall().map((d, i) => {
        const pose = thrown(t, d, i);
        const label =
          clamp(spring(t, d.at + 0.35, 0.6)) * (1 - ease(t, cue.wallOut - 0.15, 0.25, curve.in));
        const colors = d.id === "duo" ? duoGlow() : glowOf(SCREEN[d.id] ?? "homeDark");
        return (
          <div key={d.id}>
            {d.id === "duo" ? (
              <Device
                body={{ duo: angle }}
                pose={pose}
                glow={[{ colors, o: 0.35 + 0.55 * (angle / 180) }]}
              />
            ) : (
              d.id !== "hero" && (
                <Device body={d.body} pose={pose} glow={[{ colors, o: 0.85 }]}>
                  <StillScreen src={SCREEN[d.id]!} />
                </Device>
              )
            )}
            <Landing t={t} at={d.at} x={d.place.x} w={d.w} colors={colors} />
            {label > 0.002 && (
              <div
                className="absolute flex flex-col items-center gap-[3px] text-center"
                style={{
                  left: d.place.x - 110,
                  width: 220,
                  top: FLOOR + 22 + mix(8, 0, label),
                  opacity: label,
                  filter: `blur(${mix(4, 0, label)}px)`,
                }}
              >
                <span className="flex items-center gap-1.5 text-headline text-label">
                  <StatusDot tone="green" /> {d.name}
                </span>
                <span className="font-mono text-caption text-label-3">{d.runtime}</span>
              </div>
            )}
          </div>
        );
      })}
      <HingeCommand t={t} />
    </>
  );
}

/** Where a device lands, its screen's light splashes across the floor for a moment. */
function Landing({
  t,
  at,
  x,
  w,
  colors,
}: {
  t: number;
  at: number;
  x: number;
  w: number;
  colors: string[];
}) {
  const hit = at + WALL_DUR * 0.32;
  if (t < hit || t > hit + 1) return null;
  const p = ease(t, hit, 0.9, curve.quint);
  return (
    <div
      aria-hidden
      className="absolute rounded-[50%]"
      style={{
        left: x - (w * mix(1, 2.6, p)) / 2,
        top: FLOOR - 16 - 20 * p,
        width: w * mix(1, 2.6, p),
        height: 32 + 40 * p,
        background: `radial-gradient(closest-side, ${colors[2]}, ${colors[3]} 50%, transparent)`,
        opacity: (1 - p) * 0.75,
        filter: "blur(12px)",
        mixBlendMode: "var(--glow-blend)" as never,
      }}
    />
  );
}

/** The command that opens the Duo, typed in a capsule over it. */
function HingeCommand({ t }: { t: number }) {
  const c = commands.hinge;
  const duo = wall().find((d) => d.id === "duo")!;
  const inP = clamp(spring(t, c.at - 0.3, 0.45, 0.1));
  const outP = ease(t, land(c) + 1.1, 0.3, curve.in);
  if (t < c.at - 0.3 || outP >= 1) return null;
  const times = keyTimes(c.text, c.at);
  const ran = clamp(spring(t, land(c) - 0.05, 0.3));
  return (
    <div
      className="absolute top-0 left-0"
      style={{
        transform: `translate(${duo.place.x}px, ${duo.place.y - duo.height / 2 - 56 + mix(10, 0, inP) - outP * 10}px)`,
        opacity: inP * (1 - outP),
        filter: `blur(${mix(8, 0, inP) + outP * 6}px)`,
      }}
    >
      <div
        className="glass-pop flex h-10 items-center gap-2 rounded-full px-4 font-mono text-footnote whitespace-pre"
        style={{ transform: `translateX(-50%) scale(${1 - 0.04 * Math.sin(Math.PI * ran)})` }}
      >
        <span className="text-label-3">$</span>
        <span className="text-label">
          <Typed text={c.text} t={t} times={times} caret={t < land(c)} />
        </span>
        <span
          className="ml-1 flex size-5 items-center justify-center rounded-full bg-green text-white"
          style={{ opacity: ran, transform: `scale(${mix(0.4, 1, ran)})` }}
        >
          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 6.2 5 8.6 9.6 3.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}
