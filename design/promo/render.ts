#!/usr/bin/env bun
/**
 * Renders the promo film to video. Every frame is painted by seeking the film
 * to an exact time in headless Chromium, so the output is the same on every
 * run and every machine (given the same fonts).
 *
 *   mise run promo                    # from the repo root: installs what it needs, then this
 *   bun run promo/render.ts           # needs ffmpeg and img2webp on PATH, and Playwright's headless Chromium
 *
 * Writes promo/renders/:
 *   headless-serve-sim.mp4   1920×1080, 60 fps, H.264 with its AAC score — the film
 *   readme.webp              960×540, 24 fps, animated — what the README shows
 *   poster.png               1920×1080 — the closing frame
 */
import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { build, serve } from "./build";

const root = import.meta.dir;
const frames = join(root, ".frames");
const out = join(root, "renders");
const SCALE = 4 / 3; // 1440×810 CSS px → 1920×1080

function run(bin: string, args: string[]) {
  const r = spawnSync(bin, args, { stdio: ["ignore", "ignore", "inherit"] });
  if (r.error) throw new Error(`${bin} not found on PATH. Run \`mise run promo\` from the repo root, which provides it.`);
  if (r.status !== 0) throw new Error(`${bin} exited with ${r.status}`);
}
const ffmpeg = (args: string[]) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

await build();
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const server = serve();
const url = `${server.url}dist/promo.html?render`;
const probe = await browser.newPage();
await probe.goto(url);
const { total, fps, score } = await probe.evaluate(async () => {
  await window.__promo.ready;
  return { total: window.__promo.frames, fps: window.__promo.fps, score: await window.__promo.score() };
});
await probe.close();
// The score is synthesized in the page, from the same cues as the picture.
const wav = join(frames, "score.wav");
writeFileSync(wav, Buffer.from(score, "base64"));

// Contiguous chunks, so each worker mostly updates what is already on screen.
const workers = Math.max(1, Math.min(8, Math.floor(availableParallelism() / 2)));
const chunk = Math.ceil(total / workers);
let done = 0;
const started = performance.now();
await Promise.all(
  Array.from({ length: workers }, async (_, w) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: SCALE });
    await page.goto(url);
    await page.evaluate(() => window.__promo.ready);
    for (let f = w * chunk; f < Math.min(total, (w + 1) * chunk); f++) {
      await page.evaluate((n) => window.__promo.seek(n), f);
      await page.screenshot({ path: join(frames, `${String(f).padStart(5, "0")}.png`) });
      if (++done % 120 === 0) process.stdout.write(`\r${done}/${total} frames · ${((performance.now() - started) / 1000).toFixed(0)} s`);
    }
    await page.close();
  }),
);
await browser.close();
await server.stop();
console.log(`\r${total}/${total} frames in ${((performance.now() - started) / 1000).toFixed(0)} s, encoding…`);

const film = join(out, "headless-serve-sim.mp4");
ffmpeg([
  ...["-framerate", String(fps), "-i", join(frames, "%05d.png"), "-i", wav],
  ...["-c:a", "aac", "-b:a", "256k", "-shortest"],
  ...["-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p"],
  ...["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart", film],
]);
// The README's animation. libwebp's encoder treats nearly-equal blocks as
// unchanged between frames, which leaves blocky trails in slow gradients, so
// every frame is a key frame (opaque, no blending).
const small = join(frames, "readme");
mkdirSync(small);
ffmpeg(["-framerate", String(fps), "-i", join(frames, "%05d.png"), "-vf", "fps=24,scale=960:540:flags=lanczos,format=rgb24", join(small, "%05d.png")]);
const stills = readdirSync(small).sort().map((f) => join(small, f));
run("img2webp", ["-loop", "0", "-kmin", "0", "-kmax", "1", "-lossy", "-q", "70", "-m", "4", "-d", "41.667", ...stills, "-o", join(out, "readme.webp")]);
ffmpeg(["-i", join(frames, `${String(Math.round(total - fps * 2.4)).padStart(5, "0")}.png`), join(out, "poster.png")]);

rmSync(frames, { recursive: true, force: true });
for (const f of ["headless-serve-sim.mp4", "readme.webp", "poster.png"]) {
  const size = Bun.file(join(out, f)).size / 1024 / 1024;
  console.log(`  ${join(out, f)} · ${size.toFixed(1)} MB`);
}
