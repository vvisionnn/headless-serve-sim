#!/usr/bin/env bun
/**
 * Builds the design preview into ONE self-contained file: serve-sim-design.html.
 * JS, CSS and the real Simulator.app device artwork are all inlined, so the
 * file opens straight from disk with no server.
 *
 *   bun run build.ts           # build once
 *   bun run build.ts --watch   # rebuild on change
 */
import { readFileSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

const root = import.meta.dir;
const out = join(root, "serve-sim-design.html");

async function build() {
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
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>serve-sim — Design Preview</title>
<script>try{var p=JSON.parse(localStorage.getItem("serve-sim-design")||"{}").theme||"auto";document.documentElement.dataset.theme=p==="auto"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p}catch(e){}</script>
<style>${style}</style>
</head>
<body>
<div id="root"></div>
<script>${frames}</script>
<script type="module">${script}</script>
</body>
</html>
`;
  writeFileSync(out, html);
  console.log(`built ${out} · ${(html.length / 1024).toFixed(0)} KB · ${Math.round(performance.now() - started)} ms`);
}

await build();
if (process.argv.includes("--watch")) {
  let timer: Timer | undefined;
  watch(join(root, "src"), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e) => console.error(e.message)), 80);
  });
  console.log("watching src/ …");
}
