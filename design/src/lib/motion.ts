import type { Transition } from "motion/react";

/**
 * Motion tokens. Everything a person can touch moves on a spring; springs are
 * interruptible and start from the on-screen value, so any transition can be
 * grabbed and reversed mid-flight.
 *
 * Names follow Apple's damping/response model: `bounce: 0` is critically
 * damped (damping 1.0). Bounce is reserved for motion that a gesture threw.
 */
export const spring = {
  /** Default UI: menus, tabs, toggles, selection thumbs. */
  ui: { type: "spring", duration: 0.35, bounce: 0 },
  /** Small, fast feedback: press states, knobs, chips. */
  snappy: { type: "spring", duration: 0.22, bounce: 0 },
  /** Large surfaces: sidebars, drawers, the device re-fitting the stage. */
  surface: { type: "spring", duration: 0.5, bounce: 0 },
  /** Only after a flick or drag release — carries a little overshoot. */
  momentum: { type: "spring", duration: 0.45, bounce: 0.18 },
  /** Rotation reads physical: Apple ships damping 0.8 / response 0.4. */
  rotate: { type: "spring", duration: 0.6, bounce: 0.12 },
} satisfies Record<string, Transition>;

/** Opacity-only fades: quick in, quicker out. */
export const fade = {
  in: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
  out: { duration: 0.14, ease: [0.4, 0, 1, 1] },
} satisfies Record<string, Transition>;

/**
 * "Materialize": glass surfaces arrive as a material — blur and scale resolve
 * together with opacity — instead of a flat fade.
 */
export const materialize = {
  initial: { opacity: 0, scale: 0.97, filter: "blur(6px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.98, filter: "blur(4px)" },
};

/** Apple's momentum projection (Designing Fluid Interfaces). */
export function project(velocity: number, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
