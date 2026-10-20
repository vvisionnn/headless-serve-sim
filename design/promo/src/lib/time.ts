/**
 * Time primitives. Every value on screen is computed from the playhead, so a
 * frame renders the same on every machine and every worker.
 *
 * Springs use the same model as Motion (and lib/motion.ts): a perceptual
 * duration and a bounce, where bounce 0 is critically damped. A film can take
 * its time, so durations here run longer than the UI's.
 */

export const FPS = 60;
export const W = 1440;
export const H = 810;

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** Spring progress (0 → 1, may overshoot) `t - at` seconds after release. */
export function spring(t: number, at: number, duration = 0.5, bounce = 0) {
  const e = t - at;
  if (e <= 0) return 0;
  const w = (2 * Math.PI) / duration;
  const z = 1 - bounce;
  if (z >= 1) return 1 - (1 + w * e) * Math.exp(-w * e);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * e) * (Math.cos(wd * e) + ((z * w) / wd) * Math.sin(wd * e));
}

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const a = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number) => 3 * p2 - 6 * p1;
  const c = (p1: number) => 3 * p1;
  const at = (s: number, p1: number, p2: number) => ((a(p1, p2) * s + b(p1, p2)) * s + c(p1)) * s;
  const slope = (s: number, p1: number, p2: number) =>
    3 * a(p1, p2) * s * s + 2 * b(p1, p2) * s + c(p1);
  return (x: number) => {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(s, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      s -= (at(s, x1, x2) - x) / d;
    }
    return at(clamp(s), y1, y2);
  };
}

/** The design's two curves (styles.css): fluid for surfaces, quint for fades. */
export const curve = {
  fluid: bezier(0.32, 0.72, 0, 1),
  quint: bezier(0.22, 1, 0.36, 1),
  inOut: bezier(0.65, 0, 0.35, 1),
  in: bezier(0.4, 0, 1, 1),
  /** A hinge under a thumb: it gives slowly, swings, and settles flat. */
  hinge: bezier(0.5, 0, 0.15, 1),
};

/** Eased progress over a fixed window. */
export function ease(
  t: number,
  at: number,
  duration: number,
  fn: (x: number) => number = curve.quint,
) {
  return fn(clamp((t - at) / duration));
}

/** 1 inside [from, to], easing in and out over `fade` seconds at each edge. */
export function window_(t: number, from: number, to: number, fadeIn = 0.4, fadeOut = 0.4) {
  return Math.min(ease(t, from, fadeIn), 1 - ease(t, to - fadeOut, fadeOut, curve.in));
}

/** Count of characters typed by `t` at a human-ish cadence. */
export function typed(text: string, t: number, at: number, cps = 38) {
  return text.slice(0, Math.max(0, Math.floor((t - at) * cps)));
}
