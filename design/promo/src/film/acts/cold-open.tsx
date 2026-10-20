import { wallpaperGlow } from "../../../../src/device/screens/parts";
import { clamp, curve, ease, mix, spring } from "../../lib/time";
import { cue } from "../cues";

const WORDS = [
  { text: "Boot.", at: cue.word1 },
  { text: "Stream.", at: cue.word2 },
  { text: "Drive.", at: cue.word3 },
];

/**
 * Act I: three words on three beats, each one punched in and cut on the next,
 * the last one lit with the wallpaper's colours. Then a line of light draws
 * across the dark, gathers to a point, and the device comes out of it.
 */
export function ColdOpen({ t }: { t: number }) {
  if (t > cue.slam + 1.2) return null;
  return (
    <>
      {WORDS.map((w, i) => {
        const next = WORDS[i + 1]?.at ?? cue.flare;
        if (t < w.at || t > next + 0.2) return null;
        const p = spring(t, w.at, 0.42, 0.12);
        const cut = ease(t, next, 0.14, curve.in);
        const last = i === WORDS.length - 1;
        return (
          <div
            key={w.text}
            className="display absolute left-0 flex w-full justify-center"
            style={{ top: 405 - 118, fontSize: 212, letterSpacing: "-0.055em", lineHeight: 1 }}
          >
            <span
              className={last ? "" : "text-label"}
              style={{
                display: "inline-block",
                padding: "0 0.06em 0.12em",
                opacity: clamp(p * 3) * (1 - cut),
                transform: `scale(${mix(1.32, 1, p) + cut * 0.14}) translateY(${cut * -0.04}em)`,
                filter: `blur(${mix(22, 0, clamp(p)) + cut * 14}px)`,
                ...(last && {
                  backgroundImage: `linear-gradient(100deg, ${wallpaperGlow[0]}, ${wallpaperGlow[1]} 38%, ${wallpaperGlow[2]} 70%, ${wallpaperGlow[3]})`,
                  backgroundSize: "160% 100%",
                  backgroundPosition: `${mix(0, 60, ease(t, w.at, 2))}% 0`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }),
              }}
            >
              {w.text}
            </span>
          </div>
        );
      })}
      <Flare t={t} />
    </>
  );
}

/** An anamorphic line of light: drawn out from the centre, then pulled back to a point. */
function Flare({ t }: { t: number }) {
  if (t < cue.flare || t > cue.slam + 1.2) return null;
  const draw = ease(t, cue.flare, 0.7, curve.quint);
  const gather = ease(t, cue.slam - 0.55, 0.55, curve.in);
  const burst = ease(t, cue.slam, 0.9, curve.quint);
  const w = mix(0, 1500, draw) * (1 - gather) + 6;
  const o = Math.min(1, draw * 3) * (1 - burst);
  return (
    <>
      <div
        aria-hidden
        className="absolute"
        style={{
          left: 720 - w / 2,
          top: 405 - 1.5,
          width: w,
          height: 3,
          opacity: o,
          borderRadius: 3,
          background: `linear-gradient(90deg, transparent, ${wallpaperGlow[1]} 25%, #fff 50%, ${wallpaperGlow[2]} 75%, transparent)`,
          boxShadow: `0 0 18px 4px color-mix(in srgb, ${wallpaperGlow[1]} 70%, transparent), 0 0 60px 18px color-mix(in srgb, ${wallpaperGlow[0]} 35%, transparent)`,
        }}
      />
      {/* The point, and the light it throws when the device comes through it. */}
      <div
        aria-hidden
        className="absolute rounded-full"
        style={{
          left: 720 - 240,
          top: 405 - 240,
          width: 480,
          height: 480,
          opacity: (gather * 0.9 + 0.1 * draw) * (1 - burst),
          transform: `scale(${mix(0.08, 0.4, gather) + burst * 2.6})`,
          background: `radial-gradient(closest-side, #fff, ${wallpaperGlow[1]} 30%, transparent)`,
          filter: "blur(10px)",
        }}
      />
    </>
  );
}

/** The device lands: a ring runs out across the floor, and the room jolts once. */
export function Shockwave({ t }: { t: number }) {
  if (t < cue.slam || t > cue.slam + 1.4) return null;
  const p = ease(t, cue.slam + 0.08, 1.2, curve.quint);
  return (
    <div
      aria-hidden
      className="absolute rounded-[50%]"
      style={{
        left: 720 - 700 * p,
        top: 690 - 90 * p,
        width: 1400 * p,
        height: 180 * p,
        border: `${mix(10, 1, p)}px solid ${wallpaperGlow[1]}`,
        opacity: (1 - p) * 0.55,
        filter: `blur(${mix(2, 10, p)}px)`,
      }}
    />
  );
}

/** A short decaying jolt of the whole room, as a hit lands. */
export function shake(t: number, at: number, amp = 9) {
  const e = t - at;
  if (e < 0 || e > 0.6) return { x: 0, y: 0 };
  const k = amp * Math.exp(-e * 9);
  return { x: k * Math.sin(e * 71), y: k * Math.cos(e * 53) * 0.8 };
}
