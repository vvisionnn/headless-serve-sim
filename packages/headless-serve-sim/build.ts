#!/usr/bin/env bun
/**
 * Unified headless-serve-sim build.
 *
 * Produces, all minified and with no runtime deps on workspace packages:
 *   dist/headless-serve-sim.js      ESM bin (node target) referenced by package.json#bin
 *   dist/headless-serve-sim         Compiled single-file executable (bun --compile)
 *   dist/middleware.js    Public subpath export "headless-serve-sim/middleware" (ESM)
 *   dist/middleware.cjs   Thin CJS wrapper for the same
 *
 * The bin and middleware bundles target `node` so the release build can also
 * provide a Node-compatible CLI and Connect middleware.
 * Runtime server and timing behavior is implemented with Node stdlib APIs.
 *
 * The preview HTML (bundled client.tsx + React + headless-serve-sim-client, base64
 * encoded) is injected into every artifact that could need to serve the UI
 * via the __PREVIEW_HTML_B64__ build-time define.
 */
import { resolve } from "path";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "fs";
import { spawnSync } from "child_process";
import tailwindPlugin from "bun-plugin-tailwind";
import { THEME_BOOT_SCRIPT } from "./src/client/lib/theme";

const root = import.meta.dir;
const nativeRoot = resolve(root, "../headless-serve-sim-binary");
const distDir = resolve(root, "dist");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const packagedHelper = resolve(distDir, "headless-serve-sim-bin");
copyFileSync(resolve(nativeRoot, "bin/headless-serve-sim-bin"), packagedHelper);
chmodSync(packagedHelper, 0o755);

const packagedNativeSources = resolve(distDir, "native-sources");
for (const component of [
  "SimAXSettings",
  "SimCameraHelper",
  "SimCameraInjector",
  "SimDeviceMotion",
]) {
  cpSync(resolve(nativeRoot, "Sources", component), resolve(packagedNativeSources, component), {
    recursive: true,
  });
}

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

// ─── 1. Bundle the browser client ─────────────────────────────────────────

async function buildTailwindCss(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [resolve(root, "src/client/global.css")],
    minify: true,
    plugins: [tailwindPlugin],
  });
  if (!result.success) {
    console.error("Tailwind build failed:");
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  const css = await result.outputs[0]!.text();
  console.log(`tailwind css      ${kb(css.length)}`);
  return css;
}

async function bundleBrowserClient(entry: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [resolve(root, entry)],
    minify: true,
    target: "browser",
    format: "esm",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) {
    console.error(`Build failed for ${entry}:`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  return (await result.outputs[0]!.text()).replace(/<\/script>/gi, "<\\/script>");
}

const tailwindCss = await buildTailwindCss();
const clientJs = await bundleBrowserClient("src/client/client.tsx");
console.log(`client bundle     ${kb(clientJs.length)}`);
const nativeRecorderJs = await bundleBrowserClient("src/client/native-stream-recorder.ts");
console.log(`native recorder   ${kb(nativeRecorderJs.length)}`);

// ─── 2. Inline client into preview HTML, base64-encode for the define ────

// Committed ICO copy of Simulator.app's AppIcon, inlined as a data URI so the
// preview tab shows the same icon as the native app.
const faviconBytes = readFileSync(resolve(root, "src/client/simulator-icon.ico"));
const faviconTag = `<link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,${faviconBytes.toString("base64")}">`;
console.log(`favicon           ${kb(faviconBytes.length)}`);

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Simulator Preview</title>
${faviconTag}
<script>${THEME_BOOT_SCRIPT}</script>
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}</style>
<style>${tailwindCss}</style>
</head><body>
<div id="root"></div>
<!--__SIM_PREVIEW_CONFIG__-->
<script type="module">${clientJs}</script>
</body></html>`;

const htmlB64 = Buffer.from(html).toString("base64");
console.log(`preview html      ${kb(html.length)}  (base64 ${kb(htmlB64.length)})`);

const PREVIEW_DEFINE = {
  __PREVIEW_HTML_B64__: JSON.stringify(htmlB64),
  __NATIVE_RECORDER_JS_B64__: JSON.stringify(Buffer.from(nativeRecorderJs).toString("base64")),
};

// ─── 3. Middleware ESM (headless-serve-sim/middleware) ─────────────────────────────

// `ws` stays external in the node-target bundles: under Node it resolves to
// the installed package (a real dependency), and under Bun the module
// specifier is substituted with Bun's native implementation — inlining the
// Node implementation would break WebSocket upgrades on Bun.
const mwResult = await Bun.build({
  entrypoints: [resolve(root, "src/middleware.ts")],
  target: "node",
  format: "esm",
  minify: true,
  outdir: distDir,
  external: [
    "fs",
    "path",
    "os",
    "child_process",
    "url",
    "net",
    "tls",
    "crypto",
    "stream",
    "events",
    "http",
    "https",
    "zlib",
    "buffer",
    "module",
    "ws",
  ],
  define: PREVIEW_DEFINE,
});
if (!mwResult.success) {
  console.error("Middleware build failed:");
  for (const log of mwResult.logs) console.error(log);
  process.exit(1);
}
const mwSize = (await mwResult.outputs[0]!.text()).length;
console.log(`dist/middleware.js ${kb(mwSize)}`);

writeFileSync(
  resolve(distDir, "middleware.cjs"),
  `"use strict";\nmodule.exports = require("./middleware.js");\n`,
);
console.log("dist/middleware.cjs (wrapper)");

// ─── 4. Bin JS bundle ────────────────────────────────────────────────────

const binJsResult = await Bun.build({
  entrypoints: [resolve(root, "src/index.ts")],
  target: "node",
  format: "esm",
  minify: true,
  outdir: distDir,
  naming: "headless-serve-sim.js",
  external: [
    "fs",
    "path",
    "os",
    "child_process",
    "url",
    "net",
    "tls",
    "crypto",
    "stream",
    "events",
    "http",
    "https",
    "zlib",
    "buffer",
    "module",
    "ws",
  ],
  define: PREVIEW_DEFINE,
});
if (!binJsResult.success) {
  console.error("Bin JS build failed:");
  for (const log of binJsResult.logs) console.error(log);
  process.exit(1);
}

const binJsSize = (await binJsResult.outputs[0]!.text()).length;
console.log(`dist/headless-serve-sim.js   ${kb(binJsSize)}`);

// ─── 5. Compiled single-file executable ──────────────────────────────────
// Compile the source entry in-process: this preserves its native file import
// and keeps the preview define out of the OS argument-size limit.
const compile = await Bun.build({
  entrypoints: [resolve(root, "src/index.ts")],
  target: "bun",
  minify: true,
  external: ["ws"],
  define: PREVIEW_DEFINE,
  compile: { outfile: resolve(distDir, "headless-serve-sim") },
});
if (!compile.success) {
  for (const log of compile.logs) console.error(log);
  process.exit(1);
}
console.log("dist/headless-serve-sim      (compiled binary)");

// ─── 6. SimCameraInjector dylib + SimCameraHelper host CLI ───────────────
// Both ship in dist/simcam/ so they tarball alongside the JS bin. The CLI's
// `camera` verb resolves them via locateCameraDylib / locateCameraHelper.

const camBuild = spawnSync(
  "bash",
  [resolve(packagedNativeSources, "SimCameraInjector/build.sh"), resolve(distDir, "simcam")],
  { stdio: "inherit" },
);
if (camBuild.status !== 0) {
  console.error("SimCameraInjector dylib build failed.");
  process.exit(camBuild.status ?? 1);
}
console.log("dist/simcam/libSimCameraInjector.dylib");

const helperBuild = spawnSync(
  "bash",
  [resolve(packagedNativeSources, "SimCameraHelper/build.sh"), resolve(distDir, "simcam")],
  { stdio: "inherit" },
);
if (helperBuild.status !== 0) {
  console.error("SimCameraHelper build failed.");
  process.exit(helperBuild.status ?? 1);
}
console.log("dist/simcam/headless-serve-sim-camera-helper");

// ─── 7. sim-ax-settings in-sim CLI (simulator-wide UI settings) ──────────
// Ships in dist/simax/ alongside the JS bin; ui-settings.ts resolves it via
// locateAxSettingsTool (and lazy-builds from the native package if absent).

const axSettingsBuild = spawnSync(
  "bash",
  [resolve(packagedNativeSources, "SimAXSettings/build.sh"), resolve(distDir, "simax")],
  { stdio: "inherit" },
);
if (axSettingsBuild.status !== 0) {
  console.error("SimAXSettings build failed.");
  process.exit(axSettingsBuild.status ?? 1);
}
console.log("dist/simax/headless-serve-sim-ax-settings");

for (const [component, directory] of [["SimDeviceMotion", "simmotion"]]) {
  const result = spawnSync(
    "bash",
    [resolve(packagedNativeSources, component!, "build.sh"), resolve(distDir, directory!)],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("Done.");
