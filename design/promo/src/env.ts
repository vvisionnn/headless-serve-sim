/**
 * The film is a pure function of time. The Stage components it borrows keep
 * clocks of their own (fps jitter, record timers, log streams), so freeze
 * them before anything else loads: a wall clock that follows the playhead, a
 * seeded random, intervals the film runs itself, and every Motion animation
 * resolves on the frame it starts.
 */
import { MotionGlobalConfig } from "motion/react";

export const EPOCH = Date.UTC(2026, 9, 17, 16, 41, 0);
let now = EPOCH;
Date.now = () => now;

let seed = 0x9e3779b9;
/** Re-seeds Math.random, so a frame's randomness doesn't depend on what ran before it. */
export const reseed = (n: number) => void (seed = (0x9e3779b9 ^ Math.imul(n, 0x85ebca6b)) | 0);
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
};

/*
 * Intervals don't run on their own. Each frame sets the clock to the playhead
 * and calls them once, so a timer the Stage keeps (the recording clock) reads
 * the film's time. Only timers that derive what they show from Date.now()
 * stay true this way; anything that accumulates is drawn by the film instead.
 */
const intervals = new Map<number, { fn: () => void; every: number; last: number }>();
let nextInterval = 1;
window.setInterval = ((fn: () => void, every = 0) => {
  const id = nextInterval++;
  intervals.set(id, { fn, every, last: -Infinity });
  return id;
}) as unknown as typeof window.setInterval;
window.clearInterval = ((id: number) => void intervals.delete(id)) as typeof window.clearInterval;

/** Sets every clock to `t` seconds into the film. */
export function setClock(t: number) {
  now = EPOCH + Math.round(t * 1000);
}
/** Runs every interval that is due at the current clock (or behind it, after a seek back). */
export function tickIntervals() {
  for (const i of [...intervals.values()]) {
    if (now - i.last < i.every && now >= i.last) continue;
    i.last = now;
    i.fn();
  }
}

MotionGlobalConfig.skipAnimations = true;

// The borrowed Stage store restores its layout from here. Its theme lands on
// <html>; keep that light so `dark:` styles only apply inside a dark room.
localStorage.setItem(
  "serve-sim-design",
  JSON.stringify({
    theme: "light",
    device: "iphone",
    scene: "workspace",
    navigatorOpen: true,
    inspectorOpen: true,
    consoleOpen: false,
    inspectorTab: "device",
    consoleTab: "logs",
  }),
);
