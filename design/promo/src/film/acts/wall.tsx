import { StatusDot } from "../../../../src/ui/badge";
import { clamp, curve, ease, mix, spring } from "../../lib/time";
import { glowOf, type Screen } from "../assets";
import { WALL_BOUNCE, WALL_DUR, wallThrowAt } from "../beats";
import { cue } from "../cues";
import { Device } from "../device";
import { duoScreen, FLOOR, wall } from "../layout";
import { StillScreen } from "../screens";
import { Words } from "../type";

const SCREEN: Record<string, Screen> = { ipad: "ipad", air: "air", watch: "watch" };

/**
 * Act IV: every simulator family, thrown up onto one floor. Each lands with a
 * little give, rolls level, and lights the floor with its own screen. The
 * Duo arrives closed and opens like a book. They leave the way they came.
 */
export function Wall({ t }: { t: number }) {
  if (t < cue.wall - 0.05 || t > cue.wallOut + 1.2) return null;
  return (
    <>
      <div className="display absolute left-0 w-full text-center" style={{ top: 96, fontSize: 52 }}>
        <Words
          text="Every simulator, side by side."
          t={t}
          at={cue.wallLine}
          out={cue.wallOut - 0.2}
          className="text-label"
        />
      </div>
      {wall().map((d, i) => {
        const at = wallThrowAt(i);
        const p = spring(t, at, WALL_DUR, WALL_BOUNCE);
        const outP = clamp(spring(t, cue.wallOut + i * 0.04, 0.7));
        const label =
          clamp(spring(t, at + 0.55, 0.8)) * (1 - ease(t, cue.wallOut - 0.15, 0.35, curve.in));
        const side = i < 2 ? -1 : 1;
        const pose = {
          x: d.place.x,
          y: d.place.y + mix(300, 0, p) + outP * 70,
          s: d.s,
          opacity: ease(t, at, 0.35) * (1 - outP),
          blur: mix(10, 0, clamp(p)) + outP * 12,
          roll: mix(side * 7, 0, spring(t, at, 1.1, 0.25)),
          tiltX: mix(16, 0, p),
          vy: (mix(300, 0, p) - mix(300, 0, spring(t - 1 / 60, at, WALL_DUR, WALL_BOUNCE))) * 0.6,
        };
        return (
          <div key={d.id}>
            {d.id === "duo" ? (
              <Duo t={t} pose={pose} />
            ) : (
              d.id !== "hero" && (
                <Device
                  body={d.body}
                  pose={pose}
                  glow={[{ colors: glowOf(SCREEN[d.id]!), o: 0.85 }]}
                >
                  <StillScreen src={SCREEN[d.id]!} />
                </Device>
              )
            )}
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
    </>
  );
}

/** The Duo's two real poses, crossfading as it opens; it swells a touch as the hinge gives. */
function Duo({ t, pose }: { t: number; pose: Parameters<typeof Device>[0]["pose"] }) {
  const { from, to, p } = duoScreen(t);
  const swell = 1 + 0.035 * Math.sin(Math.PI * p);
  return (
    <>
      {p < 1 && (
        <Device
          body={{ duo: from }}
          pose={{ ...pose, s: pose.s * swell, opacity: (pose.opacity ?? 1) * (1 - p) }}
          glow={[{ colors: glowOf(from), o: 0.7 * (1 - p) }]}
        />
      )}
      {p > 0 && (
        <Device
          body={{ duo: to }}
          pose={{ ...pose, s: pose.s * swell, opacity: (pose.opacity ?? 1) * p }}
          glow={[{ colors: glowOf(to), o: 0.7 * p }]}
          shadow={p}
        />
      )}
    </>
  );
}
