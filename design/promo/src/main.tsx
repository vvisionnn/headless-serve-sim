import { reseed, setClock, tickIntervals } from "./env";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../../src/lib/store";
import { loadScreens } from "./film/assets";
import { DURATION, Film } from "./film/film";
import { loadBodies } from "./film/real-device";
import { FPS, H, W } from "./lib/time";
import { renderScore, toWav } from "./score/score";

/*
 * Two modes. `?render` is for the capture script: no chrome, and a
 * `window.__promo.seek(frame)` that paints exactly that frame. Without it, the
 * page is a player for previewing the film, with its score, while editing it
 * (`?t=12.5` opens at a time). `?scheme=light` plays the light-scheme cut.
 */
const params = new URLSearchParams(location.search);
const rendering = params.has("render");
const FRAMES = Math.round(DURATION * FPS);

let frame = Math.round(Number(params.get("t") ?? 0) * FPS);
const listeners = new Set<() => void>();
const setFrame = (f: number) => {
  frame = Math.max(0, Math.min(FRAMES - 1, f));
  setClock(frame / FPS);
  reseed(Math.round(frame));
  listeners.forEach((l) => l());
};
setClock(frame / FPS);
const useFrame = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => frame,
  );

const loading = Promise.all([loadBodies(), loadScreens(), document.fonts.ready]);
let markMounted: () => void;
const ready = new Promise<void>((r) => (markMounted = r));

function Root() {
  const f = useFrame();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => void loading.then(() => setLoaded(true)), []);
  useEffect(() => {
    if (loaded) markMounted();
  }, [loaded]);
  // The Stage's own timers read the playhead once the frame is on screen.
  useLayoutEffect(() => tickIntervals(), [f, loaded]);
  if (!loaded) return null;
  return <AppProvider>{rendering ? <Film t={f / FPS} /> : <Player f={f} />}</AppProvider>;
}

let score: Promise<AudioBuffer> | undefined;
const getScore = () => (score ??= renderScore());

function Player({ f }: { f: number }) {
  const [playing, setPlaying] = useState(false);
  const [fit, setFit] = useState(1);
  const audio = useRef<{ ctx: AudioContext; src?: AudioBufferSourceNode }>(undefined);
  useEffect(() => {
    const on = () => setFit(Math.min(innerWidth / W, (innerHeight - 56) / H));
    on();
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let cancelled = false;
    void getScore().then((buffer) => {
      if (cancelled) return;
      const ctx = (audio.current ??= { ctx: new AudioContext() }).ctx;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const startFrame = frame;
      const startAt = ctx.currentTime + 0.05;
      src.start(startAt, startFrame / FPS);
      audio.current!.src = src;
      const tick = () => {
        const next = startFrame + Math.max(0, ctx.currentTime - startAt) * FPS;
        if (next >= FRAMES - 1) {
          setFrame(0);
          setPlaying(false);
          return;
        }
        setFrame(next);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      audio.current?.src?.stop();
    };
  }, [playing]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === " ") setPlaying((p) => !p);
      else if (e.key === "ArrowRight") setFrame(Math.round(frame) + (e.shiftKey ? FPS : 1));
      else if (e.key === "ArrowLeft") setFrame(Math.round(frame) - (e.shiftKey ? FPS : 1));
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);
  return (
    <div className="fixed inset-0 flex flex-col items-center bg-black">
      <div style={{ width: W * fit, height: H * fit }}>
        <div style={{ width: W, height: H, transform: `scale(${fit})`, transformOrigin: "0 0" }}>
          <Film t={f / FPS} />
        </div>
      </div>
      <div
        data-theme="dark"
        className="flex h-14 w-full max-w-[960px] items-center gap-3 px-4 text-label-2"
      >
        <button
          type="button"
          className="w-14 text-body font-medium text-label"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <input
          aria-label="Playhead"
          type="range"
          min={0}
          max={FRAMES - 1}
          value={Math.round(f)}
          onChange={(e) => {
            setPlaying(false);
            setFrame(Number(e.target.value));
          }}
          className="flex-1 accent-[var(--ink)]"
        />
        <span className="w-28 text-right font-mono text-footnote tabular">
          {(f / FPS).toFixed(2)}s · {Math.round(f)}
        </span>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    __promo: {
      fps: number;
      frames: number;
      ready: Promise<void>;
      seek: (f: number) => Promise<void>;
      /** The score as a base64 16-bit WAV. */
      score: () => Promise<string>;
    };
  }
}

window.__promo = {
  fps: FPS,
  frames: FRAMES,
  ready,
  async seek(f) {
    flushSync(() => setFrame(f));
    // A timer that started on this frame registers after it commits; run it too.
    flushSync(() => tickIntervals());
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
  async score() {
    const bytes = new Uint8Array(toWav(await getScore()));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
};

createRoot(document.getElementById("root")!).render(<Root />);
