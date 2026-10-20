#!/usr/bin/env bun
/**
 * Builds the promo film into one page, dist/promo.html, the same way
 * ../build.ts builds the design preview. It reads its captures from assets/
 * and samples their pixels, which a page opened from disk may not do, so it is
 * served over http: `--watch` serves it with a scrubber to preview the film,
 * and render.ts serves it to capture frame by frame.
 *
 *   bun run promo/build.ts           # build once
 *   bun run promo/build.ts --watch   # rebuild on change, and serve the preview
 */
import { mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

const root = import.meta.dir;
const design = join(root, "..");
const promoHtml = join(root, "dist/promo.html");

export async function build() {
  const started = performance.now();
  const js = await Bun.build({
    entrypoints: [join(root, "src/main.tsx")],
    minify: true,
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!js.success) {
    for (const log of js.logs) console.error(log);
    throw new Error("JS build failed");
  }
  const css = await Bun.build({ entrypoints: [join(root, "src/styles.css")], minify: true, plugins: [tailwind] });
  if (!css.success) {
    for (const log of css.logs) console.error(log);
    throw new Error("CSS build failed");
  }
  const script = (await js.outputs[0]!.text()).replaceAll("</script", "<\\/script");
  const style = await css.outputs[0]!.text();
  const frames = readFileSync(join(root, "assets/device-frames.js"), "utf8");
  const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>headless-serve-sim — Promo</title>
<style>${style}</style>
</head>
<body>
<div id="root"></div>
<script>${frames}</script>
<script type="module">${script}</script>
</body>
</html>
`;
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(promoHtml, html);
  console.log(`built ${promoHtml} · ${(html.length / 1024).toFixed(0)} KB · ${Math.round(performance.now() - started)} ms`);
}

/** Serves promo/ over http; the film lives at `${url}dist/promo.html`. */
export function serve(port = 0) {
  return Bun.serve({
    port,
    async fetch(req) {
      const path = join(root, decodeURIComponent(new URL(req.url).pathname));
      const file = Bun.file(path);
      return path.startsWith(root) && (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  await build();
  if (process.argv.includes("--watch")) {
    let timer: Timer | undefined;
    for (const dir of [join(root, "src"), join(design, "src")]) {
      watch(dir, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => build().catch((e) => console.error(e.message)), 80);
      });
    }
    console.log(`watching promo/src and src … preview at ${serve(4310).url}dist/promo.html`);
  }
}
