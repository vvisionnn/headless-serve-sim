/**
 * Real pixels, captured from simulators by scripts/capture.ts: Apple's
 * default wallpaper, the 9:41 status bar, and the iPhone Duo as the Stage's
 * own renderer draws it. Each screen's light is sampled from the image itself,
 * the way the shipped Stage samples the stream.
 */
import ax from "../../assets/phone-settings-ax.json";

const at = (file: string) => new URL(`../assets/${file}`, location.href).href;

export const screens = {
  lock: at("phone-lock.jpg"),
  homeLight: at("phone-home-light.jpg"),
  homeDark: at("phone-home-dark.jpg"),
  settings: at("phone-settings-dark.jpg"),
  air: at("air-home-dark.jpg"),
  ipad: at("ipad-home-light.jpg"),
  watch: at("watch-apps.jpg"),
  duoClosed: at("duo-closed.webp"),
  duoBook: at("duo-book.webp"),
  duoOpen: at("duo-open.webp"),
};
export type Screen = keyof typeof screens;

const glows = new Map<Screen, string[]>();
const sizes = new Map<Screen, { w: number; h: number }>();

/** Four colours a screen lights the room with (top-left, top-right, bottom-right, bottom-left). */
export const glowOf = (s: Screen) => glows.get(s) ?? ["#888", "#888", "#888", "#888"];
export const sizeOf = (s: Screen) => sizes.get(s) ?? { w: 1, h: 1 };

/** Decode every image and sample its light before the first frame paints. */
export async function loadScreens() {
  await Promise.all(
    (Object.keys(screens) as Screen[]).map(async (key) => {
      const img = new Image();
      img.src = screens[key];
      await img.decode();
      sizes.set(key, { w: img.naturalWidth, h: img.naturalHeight });
      const c = document.createElement("canvas");
      c.width = c.height = 2;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, 2, 2);
      const d = g.getImageData(0, 0, 2, 2).data;
      const px = (i: number) => `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`;
      glows.set(key, [px(0), px(4), px(12), px(8)]);
    }),
  );
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
