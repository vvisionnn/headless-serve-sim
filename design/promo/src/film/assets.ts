/**
 * Real pixels, captured from simulators by scripts/capture.ts: Apple's
 * default wallpaper, the 9:41 status bar, and the iPhone Duo's fold as the
 * Stage's own renderer draws it, every five degrees. Each screen's light is sampled from the image itself,
 * the way the shipped Stage samples the stream.
 */
import ax from "../../assets/phone-settings-ax.json";
import fold from "../../assets/duo-fold/fold.json";

const at = (file: string) => new URL(`../assets/${file}`, location.href).href;

export const screens = {
  lock: at("phone-lock.jpg"),
  homeLight: at("phone-home-light.jpg"),
  homeDark: at("phone-home-dark.jpg"),
  settings: at("phone-settings-dark.jpg"),
  air: at("air-home-dark.jpg"),
  ipad: at("ipad-home-light.jpg"),
  watch: at("watch-apps.jpg"),
};
export type Screen = keyof typeof screens;

const glows = new Map<Screen, string[]>();
const sizes = new Map<Screen, { w: number; h: number }>();

/** Four colours a screen lights the room with (top-left, top-right, bottom-right, bottom-left). */
export const glowOf = (s: Screen) => glows.get(s) ?? ["#888", "#888", "#888", "#888"];
export const sizeOf = (s: Screen) => sizes.get(s) ?? { w: 1, h: 1 };

/**
 * The iPhone Duo's hinge, from closed (0°) to flat open (180°): each frame is
 * where the Stage drew the device in its stream, so laying them out at their
 * crops keeps the hinge where the renderer put it.
 */
export const FOLD = fold.frames.map((f) => ({
  angle: f.angle,
  src: at(`duo-fold/${String(f.angle).padStart(3, "0")}.webp`),
  x: f.crop[0]!,
  y: f.crop[1]!,
  w: f.crop[2]!,
  h: f.crop[3]!,
}));
export const FOLD_STEP = fold.step;
let foldGlow = ["#888", "#888", "#888", "#888"];
/** The light of the Duo's open inner display. */
export const duoGlow = () => foldGlow;

function sample(img: HTMLImageElement) {
  const c = document.createElement("canvas");
  c.width = c.height = 2;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, 2, 2);
  const d = g.getImageData(0, 0, 2, 2).data;
  const px = (i: number) => `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`;
  return [px(0), px(4), px(12), px(8)];
}

/** Decode every image and sample its light before the first frame paints. */
export async function loadScreens() {
  await Promise.all([
    ...(Object.keys(screens) as Screen[]).map(async (key) => {
      const img = new Image();
      img.src = screens[key];
      await img.decode();
      sizes.set(key, { w: img.naturalWidth, h: img.naturalHeight });
      glows.set(key, sample(img));
    }),
    ...FOLD.map(async (f) => {
      const img = new Image();
      img.src = f.src;
      await img.decode();
      if (f.angle === 180) foldGlow = sample(img);
    }),
  ]);
}

interface AxNode {
  AXLabel?: string | null;
  type?: string;
  role_description?: string;
  frame?: { x: number; y: number; width: number; height: number };
  children?: AxNode[];
}

/** Every element the real Settings app reported over /ax, in tree order. */
export const axNodes = (() => {
  const out: { label: string; type: string; frame: [number, number, number, number] }[] = [];
  const walk = (n: AxNode) => {
    const f = n.frame;
    if (f && n.type !== "Application" && n.type !== "Group" && f.width < 400)
      out.push({
        label: n.AXLabel ?? "",
        type: n.type ?? "",
        frame: [f.x, f.y, f.width, f.height],
      });
    n.children?.forEach(walk);
  };
  (ax as AxNode[]).forEach(walk);
  return out;
})();

/** What `jq -r '.. | select(.type? == "Button") | .AXLabel'` prints for that tree. */
export const buttonLabels = axNodes
  .filter((n) => n.type === "Button" && n.label)
  .map((n) => n.label);
