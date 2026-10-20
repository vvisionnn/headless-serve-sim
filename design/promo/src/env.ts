/**
 * The film is a pure function of time. The Stage components it borrows keep
 * clocks of their own (fps jitter, record timers, log streams), so freeze
 * them before anything else loads: one fixed wall clock, a seeded random,
 * no intervals, and every Motion animation resolves on the frame it starts.
 */
import { MotionGlobalConfig } from "motion/react";

const EPOCH = Date.UTC(2026, 9, 17, 16, 41, 0);
Date.now = () => EPOCH;

let seed = 0x9e3779b9;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
};

window.setInterval = (() => 0) as unknown as typeof window.setInterval;

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
