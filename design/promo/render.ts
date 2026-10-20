#!/usr/bin/env bun
/**
 * Renders the promo film to video, once per colour scheme. Every frame is
 * painted by seeking the film to an exact time in headless Chromium, so the
 * output is the same on every run and every machine (given the same fonts).
 *
 *   mise run promo                    # from the repo root: installs what it needs, then this
 *   bun run promo/render.ts           # needs ffmpeg and img2webp on PATH, and Playwright's headless Chromium
 *   bun run promo/render.ts dark      # one scheme only
 *
 * Writes promo/renders/, for each scheme (light, dark):
 *   headless-serve-sim-<scheme>.mp4   1920×1080, 60 fps, H.264 with its AAC score — the film
 *   readme-<scheme>.webp              960×540, 20 fps, animated — what the README shows
 *   poster-<scheme>.png               1920×1080 — the closing frame
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
const SCHEMES = ["light", "dark"].filter((s) => process.argv.length < 3 || process.argv.includes(s));

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
const page0 = await browser.newPage();
await page0.goto(`${server.url}dist/promo.html?render`);
const { total, fps, score } = await page0.evaluate(async () => {
  await window.__promo.ready;
  return { total: window.__promo.frames, fps: window.__promo.fps, score: await window.__promo.score() };
});
await page0.close();
// The score is synthesized in the page, from the same cues as the picture; both cuts share it.
const wav = join(frames, "score.wav");
writeFileSync(wav, Buffer.from(score, "base64"));

for (const scheme of SCHEMES) {
  const url = `${server.url}dist/promo.html?render&scheme=${scheme}`;
  const dir = join(frames, scheme);
  mkdirSync(dir);
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
        await page.screenshot({ path: join(dir, `${String(f).padStart(5, "0")}.png`) });
        if (++done % 120 === 0)
          process.stdout.write(`\r${scheme}: ${done}/${total} frames · ${((performance.now() - started) / 1000).toFixed(0)} s`);
      }
      await page.close();
    }),
  );
  console.log(`\r${scheme}: ${total}/${total} frames in ${((performance.now() - started) / 1000).toFixed(0)} s, encoding…`);

  ffmpeg([
    ...["-framerate", String(fps), "-i", join(dir, "%05d.png"), "-i", wav],
    ...["-c:a", "aac", "-b:a", "256k", "-shortest"],
    ...["-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p"],
    ...["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart"],
    join(out, `headless-serve-sim-${scheme}.mp4`),
  ]);
  // The README's animation. libwebp's encoder treats nearly-equal blocks as
  // unchanged between frames, which leaves blocky trails in slow gradients, so
  // every frame is a key frame (opaque, no blending).
  const small = join(dir, "readme");
  mkdirSync(small);
  ffmpeg(["-framerate", String(fps), "-i", join(dir, "%05d.png"), "-vf", "fps=20,scale=960:540:flags=lanczos,format=rgb24", join(small, "%05d.png")]);
  const stills = readdirSync(small).sort().map((f) => join(small, f));
  run("img2webp", ["-loop", "0", "-kmin", "0", "-kmax", "1", "-lossy", "-q", "62", "-m", "4", "-d", "50", ...stills, "-o", join(out, `readme-${scheme}.webp`)]);
  ffmpeg(["-i", join(dir, `${String(Math.round(total - fps * 5)).padStart(5, "0")}.png`), join(out, `poster-${scheme}.png`)]);
  rmSync(dir, { recursive: true, force: true });
}

await browser.close();
await server.stop();
rmSync(frames, { recursive: true, force: true });
for (const scheme of SCHEMES)
  for (const f of [`headless-serve-sim-${scheme}.mp4`, `readme-${scheme}.webp`, `poster-${scheme}.png`]) {
    const size = Bun.file(join(out, f)).size / 1024 / 1024;
    console.log(`  ${join(out, f)} · ${size.toFixed(1)} MB`);
  }
