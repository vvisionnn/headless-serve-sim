// Exports the installed Simulator.app device-frame specs (real DeviceKit artwork)
// so the static design preview composites devices exactly like the shipped UI.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadInstalledDeviceFrameSpecAsync } from "../../packages/headless-serve-sim/src/device-frame-profile";

const ids = {
  iphone: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
  ipad: "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB",
  watch: "com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-3-49mm",
};
const out: Record<string, unknown> = {};
for (const [key, id] of Object.entries(ids)) {
  const spec = await loadInstalledDeviceFrameSpecAsync(id);
  if (!spec) throw new Error(`no spec for ${id}`);
  out[key] = spec;
  console.log(key, spec.modelName, spec.nativeScreen, spec.insetsPx, spec.screenRadiiPx, spec.artwork?.width, spec.artwork?.height, !!spec.artwork?.composite, !!spec.artwork?.slices, spec.artwork?.controls.length);
}
const target = join(import.meta.dir, "..", "assets", "device-frames.js");
writeFileSync(target, `window.DEVICE_FRAMES = ${JSON.stringify(out)};\n`);
console.log("wrote", target);
