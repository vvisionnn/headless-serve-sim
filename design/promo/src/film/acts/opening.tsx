import { clamp, curve, ease, mix, spring } from "../../lib/time";
import { cue } from "../cues";
import { hero } from "../layout";
import { Words } from "../type";

/** Act I: before the device, one point of light in a dark room. */
export function FirstLight({ t }: { t: number }) {
  const p = ease(t, cue.glow, 1.6, curve.fluid);
  const gone = ease(t, cue.screenOn, 1.2);
  if (t < cue.glow || gone >= 1) return null;
  const r = mix(4, 180, p);
  return (
    <div
      aria-hidden
      className="absolute rounded-full"
      style={{
        left: 720 - r,
        top: 400 - r,
        width: r * 2,
        height: r * 2,
        background:
          "radial-gradient(closest-side, rgba(201,166,255,0.9), rgba(143,180,255,0.35) 45%, transparent)",
        filter: `blur(${mix(2, 40, p)}px)`,
        opacity: mix(0, 0.9, ease(t, cue.glow, 0.6)) * (1 - gone),
      }}
    />
  );
}

/** The name, set quietly under the device the first time it is lit. */
export function Name({ t }: { t: number }) {
  const h = hero(t);
  const out = cue.window - 0.25;
  return (
    <div className="absolute left-0 w-full text-center" style={{ top: h.y + 300 }}>
      <Words
        text="headless-serve-sim"
        t={t}
        at={cue.name}
        out={out}
        className="font-mono text-label-2"
        style={{ fontSize: 13, letterSpacing: "0.32em" }}
      />
    </div>
  );
}

/**
 * Act II: the Simulator.app window the tool does without. It materializes
 * around the device, then comes apart — traffic lights first, then the glass —
 * and leaves the device standing on its own.
 */
export function GhostWindow({ t }: { t: number }) {
  if (t < cue.window || t > cue.windowGone + 1.2) return null;
  const h = hero(t);
  const inP = clamp(spring(t, cue.window, 0.8));
  const outP = ease(t, cue.windowGone + 0.25, 0.75, curve.in);
  const w = 392;
  const hh = 676;
  return (
    <div
      className="glass absolute overflow-hidden rounded-[18px]"
      style={{
        left: h.x - w / 2,
        top: h.y - hh / 2 - 14,
        width: w,
        height: hh,
        opacity: inP * (1 - outP),
        transform: `scale(${mix(0.97, 1, inP) + outP * 0.07})`,
        filter: `blur(${mix(6, 0, inP) + outP * 14}px)`,
      }}
    >
      <div className="flex h-[30px] items-center gap-[7px] px-[12px]">
        {["#ff5f57", "#febc2e", "#28c840"].map((c, i) => {
          const pop = ease(t, cue.windowGone + i * 0.07, 0.3, curve.in);
          return (
            <span
              key={c}
              className="size-[11px] rounded-full"
              style={{ background: c, transform: `scale(${1 - pop})` }}
            />
          );
        })}
        <span
          className="flex-1 pr-[38px] text-center text-caption font-semibold text-label-2"
          style={{ opacity: 1 - ease(t, cue.windowGone, 0.3) }}
        >
          Simulator — iPhone 17 Pro
        </span>
      </div>
    </div>
  );
}

export function NoWindow({ t }: { t: number }) {
  return (
    <div className="display absolute" style={{ left: 742, top: 300, width: 640, fontSize: 60 }}>
      <Words
        text="No Simulator window."
        t={t}
        at={cue.noWindow}
        out={cue.noWindowOut}
        className="text-label"
      />
      <Words
        text="Just the device,"
        t={t}
        at={cue.noWindow + 0.55}
        out={cue.noWindowOut + 0.06}
        className="text-label-3"
      />
      <Words
        text="live in your browser."
        t={t}
        at={cue.noWindow + 0.8}
        out={cue.noWindowOut + 0.12}
        className="text-label-3"
      />
    </div>
  );
}
