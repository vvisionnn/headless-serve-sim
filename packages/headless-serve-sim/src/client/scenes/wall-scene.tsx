import { motion } from "motion/react";
import { Play, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DeviceBezel,
  loadFrameArtwork,
  preloadScreenMasks,
  useFrameArtwork,
} from "../components/device-bezel";
import { prefetchFrameSpec, useFrameSpecState } from "../hooks/use-frame-spec";
import {
  GRID_MAX_PAGE_SIZE,
  fetchGrid,
  gridPageUrl,
  useGridDevices,
} from "../hooks/use-grid-devices";
import { useMjpegStream } from "../hooks/use-mjpeg-stream";
import { spring } from "../lib/motion";
import { StatusDot } from "../ui/badge";
import { Button, IconButton } from "../ui/button";
import { Tip } from "../ui/tooltip";
import { fitDeviceBezel } from "../utils/bezel-geometry";
import { stillFitsScreen, wallTileReady, wallTileRevealCap } from "../utils/wall-tile-reveal";
import {
  rotationDegreesForOrientation,
  type SimulatorOrientation,
} from "headless-serve-sim-client/simulator";
import { deviceConfig, keepDeviceConfigsWarm, prefetchDeviceConfig } from "../utils/device-switch";
import { unturnedScreenBox } from "../utils/wall-tile-orientation";
import type { GridDevice } from "../utils/grid";

export interface WallSceneProps {
  currentUdid: string;
  /** Height reserved at the bottom (console drawer), in px. */
  insetBottom: number;
  /** Focus a live simulator (current one → back to the stage). */
  onFocus: (udid: string) => void;
  /**
   * The stage's latest frame, to hold on this window's own tile until its
   * stream paints — the stage already has it, the tile's stream is a new
   * connection.
   */
  currentStill?: () => HTMLCanvasElement | null;
  /** How the stage holds this window's device, so its tile is drawn the same way. */
  currentOrientation?: SimulatorOrientation;
}

type Kind = "phone" | "tablet" | "watch";

function kindOf(name: string): Kind {
  const n = name.toLowerCase();
  if (n.includes("ipad")) return "tablet";
  if (n.includes("watch")) return "watch";
  return "phone";
}

/**
 * A product lineup, not a grid of equal boxes: each device keeps a height
 * proportional to its family, so a watch reads as a watch beside a phone.
 */
export const LINEUP_SHARE: Record<Kind, number> = { phone: 1, tablet: 0.74, watch: 0.34 };

/** Body aspect (w/h) used until the real frame spec arrives, or when there is none. */
const FALLBACK_ASPECT: Record<Kind, number> = { phone: 0.49, tablet: 0.74, watch: 0.82 };

/** Body aspect (w/h) of the widest phone, the folded iPhone Duo. */
const WIDEST_PHONE_ASPECT = 0.73;

/**
 * Height of a phone in the lineup. Narrow columns would cap a wide phone by
 * width while a slim one grows to the full row, so every phone is held to the
 * height the widest one can reach — phones read as the same size.
 */
export function wallLineupHeight(cellW: number, cellH: number): number {
  return Math.min((cellH - 72) * 0.82, (cellW * 0.86) / WIDEST_PHONE_ASPECT);
}

/** The wall shows what is running: streaming first, then booted-but-idle. */
export function wallDevices(devices: GridDevice[]): GridDevice[] {
  return devices
    .filter((d) => d.helper || d.state === "Booted")
    .sort((a, b) => Number(!a.helper) - Number(!b.helper));
}

function isDuo(spec: { deviceTypeIdentifier?: string } | null): boolean {
  return spec?.deviceTypeIdentifier?.endsWith(".iPhone-Duo") ?? false;
}

/**
 * Fetch what the wall will draw — the device list, each running device's
 * frame spec, its composited bezel and screen masks — so opening it paints
 * whole tiles at once instead of waiting on the network and the compositor.
 */
export async function prewarmWall(endpoint: string): Promise<void> {
  const answer = await fetchGrid(gridPageUrl(endpoint, GRID_MAX_PAGE_SIZE));
  for (const device of wallDevices(answer?.devices ?? [])) {
    void prefetchFrameSpec(device.device).then((spec) => {
      // A streaming Duo draws its own body from the stream.
      if (!spec || (isDuo(spec) && device.helper)) return;
      void loadFrameArtwork(spec);
      preloadScreenMasks(spec);
    });
  }
}

// Once the page has settled, warm the wall in idle time.
if (typeof window !== "undefined") {
  const endpoint = window.__SIM_PREVIEW__?.gridApiEndpoint;
  const idle = (run: () => void) =>
    typeof requestIdleCallback === "function"
      ? requestIdleCallback(run, { timeout: 2000 })
      : setTimeout(run, 200);
  const warm = () => idle(() => void prewarmWall(endpoint!));
  if (endpoint && window.__SIM_PREVIEW__?.mode !== "phone") {
    if (document.readyState === "complete") warm();
    else window.addEventListener("load", warm, { once: true });
  }
}

/** Columns for `count` tiles in a box `width` wide. */
export function wallColumns(count: number, width: number): number {
  const max = width > 1100 ? 4 : width > 560 ? 2 : 1;
  return Math.max(1, Math.min(count, max));
}

/**
 * Wall: every running simulator side by side, each live. Click one and it
 * flies forward into the stage — the same object, not a new screen.
 */
export function WallScene({
  currentUdid,
  insetBottom,
  onFocus,
  currentStill,
  currentOrientation,
}: WallSceneProps) {
  const config = typeof window === "undefined" ? undefined : window.__SIM_PREVIEW__;
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1000, h: 700 });
  const [pending, setPending] = useState<Record<string, "start" | "stop">>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const busy = Object.keys(pending).length > 0;
  const grid = useGridDevices(config?.gridApiEndpoint, true, busy, GRID_MAX_PAGE_SIZE);
  const { refresh } = grid;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure before the first paint, so tiles never lay out against the
    // default box and resize a frame later.
    const rect = el.getBoundingClientRect();
    setBox({ w: rect.width, h: rect.height });
    const ro = new ResizeObserver(([e]) =>
      setBox({ w: e!.contentRect.width, h: e!.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const post = useCallback(
    async (udid: string, action: "start" | "stop", endpoint: string | undefined) => {
      if (!endpoint) return;
      setPending((p) => ({ ...p, [udid]: action }));
      setErrors(({ [udid]: _, ...rest }) => rest);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ udid }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok)
          setErrors((e) => ({ ...e, [udid]: json.error ?? `HTTP ${res.status}` }));
      } catch (err) {
        setErrors((e) => ({ ...e, [udid]: err instanceof Error ? err.message : "Request failed" }));
      } finally {
        setPending(({ [udid]: _, ...rest }) => rest);
        refresh();
      }
    },
    [refresh],
  );

  const wall = wallDevices(grid.devices ?? []);
  const cols = wallColumns(wall.length, box.w - 48);
  const rows = Math.ceil(wall.length / cols);
  const cellW = (box.w - 48) / cols;
  // Below this a device is too small to read; scroll instead of shrinking.
  const cellH = Math.max(280, (box.h - insetBottom - 40) / Math.max(1, rows));

  return (
    <div ref={ref} className="absolute inset-0">
      {grid.devices && wall.length === 0 ? (
        <div
          className="absolute inset-x-6 top-2 flex flex-col items-center justify-center gap-1 text-center"
          style={{ bottom: insetBottom + 24 }}
        >
          <span className="text-title3 text-label">No simulators running</span>
          <span className="text-body text-label-2">
            Boot one from the navigator to see it here.
          </span>
        </div>
      ) : (
        <div
          className="thin-scrollbar absolute inset-x-6 top-2 overflow-y-auto"
          style={{ bottom: insetBottom + 24 }}
        >
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: cellH }}
          >
            {wall.map((d, i) => (
              <Tile
                key={d.device}
                device={d}
                index={i}
                cellW={cellW}
                cellH={cellH}
                current={d.device === currentUdid}
                still={d.device === currentUdid ? currentStill : undefined}
                orientation={d.device === currentUdid ? currentOrientation : undefined}
                pending={pending[d.device]}
                error={errors[d.device]}
                onFocus={() => onFocus(d.device)}
                onStart={() => void post(d.device, "start", config?.gridStartEndpoint)}
                onShutdown={() => void post(d.device, "stop", config?.gridShutdownEndpoint)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const TILE_HIDDEN = { opacity: 0, y: 24, filter: "blur(8px)" };
const TILE_SHOWN = { opacity: 1, y: 0, filter: "blur(0px)" };

/** True once `ready`, or after `capMs` — a slow stream never holds a tile back. */
function useReveal(ready: boolean, capMs: number): boolean {
  const [timedOut, setTimedOut] = useState(false);
  const [shown, setShown] = useState(ready);
  if (ready && !shown) setShown(true);
  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), capMs);
    return () => clearTimeout(id);
  }, [capMs]);
  return shown || timedOut;
}

function Tile({
  device,
  index,
  cellW,
  cellH,
  current,
  still: takeStill,
  orientation: heldAs,
  pending,
  error,
  onFocus,
  onStart,
  onShutdown,
}: {
  device: GridDevice;
  index: number;
  cellW: number;
  cellH: number;
  current: boolean;
  still?: () => HTMLCanvasElement | null;
  orientation?: SimulatorOrientation;
  pending: "start" | "stop" | undefined;
  error: string | undefined;
  onFocus: () => void;
  onStart: () => void;
  onShutdown: () => void;
}) {
  const { spec, loaded: specLoaded } = useFrameSpecState(device.device);
  const kind = kindOf(device.name);
  const nativeComposite = isDuo(spec);
  const live = !!device.helper;
  const needsArtwork = !!spec?.artwork && !(nativeComposite && live);
  const artwork = useFrameArtwork(needsArtwork ? spec : null);
  const [frameReady, setFrameReady] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // An MJPEG <img> fires no event per part; watch for its first picture.
  useEffect(() => {
    if (!live || nativeComposite || frameReady) return;
    let id = 0;
    const check = () => {
      if (imgRef.current?.naturalWidth) setFrameReady(true);
      else id = requestAnimationFrame(check);
    };
    check();
    return () => cancelAnimationFrame(id);
  }, [live, nativeComposite, frameReady]);
  // Taken as the tile mounts, while the stage still shows it.
  const [still] = useState(() => (live ? (takeStill?.() ?? null) : null));
  const [hover, setHover] = useState(false);
  // Fetch the device's config as the pointer arrives, so the click switches
  // on an answer already in hand; again while it rests here, so the answer
  // (and the server's simulator inventory) stays fresh.
  const warm = () => {
    if (live && !current) prefetchDeviceConfig(device.device).catch(() => {});
  };
  useEffect(() => {
    if (hover && live && !current) return keepDeviceConfigsWarm([device.device]);
  }, [hover, live, current, device.device]);
  // Drawn the way the device is held, so the flight into the stage starts
  // from the same shape it lands as. The stage knows its own device's; any
  // other's comes with its config (which a click switches on anyway).
  const [orientation, setOrientation] = useState<SimulatorOrientation | null | undefined>(
    heldAs ?? (live && !nativeComposite ? undefined : null),
  );
  useEffect(() => {
    if (heldAs) return setOrientation(heldAs);
    if (!live) return setOrientation(null);
    let alive = true;
    deviceConfig(device.device).then(
      (config) => alive && setOrientation(config.screenConfig?.orientation ?? null),
      () => alive && setOrientation(null),
    );
    return () => {
      alive = false;
    };
  }, [heldAs, live, device.device, device.helper?.port]);
  const rotation = nativeComposite ? 0 : rotationDegreesForOrientation(orientation ?? undefined);
  const sideways = Math.abs(rotation) === 90;
  const availW = cellW * 0.86;
  const availH = wallLineupHeight(cellW, cellH) * LINEUP_SHARE[kind];
  const geometry = spec
    ? fitDeviceBezel({
        spec,
        rotation,
        availWidth: availW,
        availHeight: availH,
        maxScreenWidth: Number.POSITIVE_INFINITY,
        maxScale: 1,
      })
    : null;
  const aspect = FALLBACK_ASPECT[kind];
  const turnedAspect = sideways ? 1 / aspect : aspect;
  const w = geometry?.width ?? Math.min(availW, availH * turnedAspect);
  const h = geometry?.height ?? w / turnedAspect;
  const glass = unturnedScreenBox(geometry?.screen ?? { width: w, height: h }, rotation);
  // A Duo's tile draws its own composite; any other holds the still on its
  // screen until the stream's first frame fades in over it.
  const seed = still && !nativeComposite && stillFitsScreen(still, glass) ? still : null;
  const holdStill = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || !seed) return;
      seed.style.cssText = "display:block;width:100%;height:100%;object-fit:cover";
      el.replaceChildren(seed);
    },
    [seed],
  );
  const revealed = useReveal(
    wallTileReady({
      specLoaded: specLoaded && orientation !== undefined,
      needsArtwork,
      artworkReady: artwork !== null,
      live,
      frameReady,
      stillReady: !!seed,
    }),
    wallTileRevealCap({ live, stillReady: !!seed }),
  );

  const screen = live ? (
    <div
      className="pointer-events-none absolute"
      style={{
        left: glass.left,
        top: glass.top,
        width: glass.width,
        height: glass.height,
        transform: glass.transform,
      }}
    >
      {seed && (
        <div ref={holdStill} data-wall-still className="pointer-events-none absolute inset-0" />
      )}
      <img
        ref={imgRef}
        src={device.helper!.streamUrl}
        alt={device.name}
        // The helper allows any origin; asking for CORS keeps the pixels
        // readable, so a switch can hold this frame while the stage connects.
        crossOrigin="anonymous"
        draggable={false}
        data-wall-screen
        // A tile shown before its first frame (the reveal cap) fades the
        // picture in rather than cutting from black.
        className={`pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-200 select-none ${
          frameReady || nativeComposite ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  ) : (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0b0b0d] text-white">
      <span className="text-footnote font-semibold">Not streaming</span>
    </div>
  );

  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-4"
      initial={TILE_HIDDEN}
      animate={revealed ? TILE_SHOWN : TILE_HIDDEN}
      transition={{ ...spring.surface, delay: 0.06 * index }}
    >
      <motion.button
        type="button"
        disabled={!live}
        onHoverStart={() => setHover(true)}
        onHoverEnd={() => setHover(false)}
        onPointerDown={warm}
        onClick={() => live && onFocus()}
        className="relative outline-none disabled:cursor-default"
        style={{ width: w, height: h }}
        animate={{ y: hover && live ? -6 : 0 }}
        transition={spring.ui}
        aria-label={`Focus ${device.name}`}
        data-wall-tile={device.device}
      >
        <motion.div
          layoutId={live ? `device-${device.device}` : undefined}
          className="absolute inset-0"
          transition={spring.surface}
        >
          {nativeComposite && live ? (
            // The Duo streams a native composite that already draws the
            // device; crop it to the device itself so it sits on the wall
            // like every other phone, with no second bezel and no backdrop.
            <DuoCompositeScreen
              streamUrl={device.helper!.streamUrl}
              label={device.name}
              onFirstFrame={() => setFrameReady(true)}
            />
          ) : spec && geometry ? (
            <DeviceBezel spec={spec} geometry={geometry}>
              {screen}
            </DeviceBezel>
          ) : (
            // No frame profile (yet): the screen alone, in a plain dark rim.
            <div
              className="absolute inset-0 overflow-hidden bg-black shadow-[0_0_0_3px_#1c1c1e,0_0_0_3.5px_#3a3a3c]"
              style={{
                borderRadius: kind === "watch" ? w * 0.28 : w * 0.12,
                filter: "var(--device-shadow)",
              }}
            >
              {screen}
            </div>
          )}
        </motion.div>
      </motion.button>
      <div className="group flex flex-col items-center gap-0.5">
        <span className="flex items-center gap-1.5 text-headline text-label">
          {device.name}
          {current && <span className="text-caption font-medium text-label-3">· This window</span>}
        </span>
        <span className="flex h-5 items-center gap-1.5 text-caption text-label-2">
          {pending === "stop" ? (
            <span className="shimmer-text font-medium">Shutting down…</span>
          ) : pending === "start" ? (
            <span className="shimmer-text font-medium">Starting stream…</span>
          ) : live ? (
            <>
              <StatusDot tone="green" live /> Live{" "}
              <span className="font-mono">:{device.helper!.port}</span>
            </>
          ) : (
            <>
              <StatusDot tone="neutral" /> Booted
              <Button
                size="sm"
                variant="plain"
                icon={<Play fill="currentColor" className="!size-2.5" />}
                className="ml-1 h-5 px-2"
                onClick={onStart}
              >
                Stream
              </Button>
            </>
          )}
          {!pending && (
            <Tip label="Shut down">
              <IconButton
                label={`Shut down ${device.name}`}
                size="sm"
                onClick={onShutdown}
                className="size-5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-[11px]"
              >
                <X />
              </IconButton>
            </Tip>
          )}
        </span>
        {error && (
          <span className="max-w-60 text-center text-caption break-words text-red">{error}</span>
        )}
      </div>
    </motion.div>
  );
}

/**
 * A Duo's composited stream, cropped to the device and clipped to its
 * silhouette — the same paint the stage does, without the 3D interaction.
 */
function DuoCompositeScreen({
  streamUrl,
  label,
  onFirstFrame,
}: {
  streamUrl: string;
  label: string;
  onFirstFrame: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { subscribeFrame } = useMjpegStream(streamUrl);
  const firstFrame = useRef(onFirstFrame);
  firstFrame.current = onFirstFrame;
  useEffect(() => {
    let busy = false;
    return subscribeFrame((blobUrl, _bytes, composition) => {
      const canvas = canvasRef.current;
      if (busy || !canvas || !composition) {
        URL.revokeObjectURL(blobUrl);
        return;
      }
      busy = true;
      const image = new Image();
      image.onload = () => {
        busy = false;
        URL.revokeObjectURL(blobUrl);
        const crop = duoTileCrop(composition.bounds, image.naturalWidth, image.naturalHeight);
        if (canvas.width !== crop.width || canvas.height !== crop.height) {
          canvas.width = crop.width;
          canvas.height = crop.height;
        }
        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save();
        // The mask is in unit coordinates of the whole frame.
        context.setTransform(image.naturalWidth, 0, 0, image.naturalHeight, -crop.x, -crop.y);
        context.clip(new Path2D(composition.mask), "evenodd");
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(
          image,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          0,
          0,
          crop.width,
          crop.height,
        );
        context.restore();
        firstFrame.current();
      };
      image.onerror = () => {
        busy = false;
        URL.revokeObjectURL(blobUrl);
      };
      image.src = blobUrl;
    });
  }, [subscribeFrame]);
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      data-wall-screen
      className="pointer-events-none absolute inset-0 size-full object-contain"
    />
  );
}

/** Pixel crop of the device's normalized bounds within a composited frame. */
export function duoTileCrop(bounds: number[], width: number, height: number) {
  const x = Math.max(0, Math.floor((bounds[0] ?? 0) * width));
  const y = Math.max(0, Math.floor((bounds[1] ?? 0) * height));
  const right = Math.min(width, Math.ceil(((bounds[0] ?? 0) + (bounds[2] ?? 1)) * width));
  const bottom = Math.min(height, Math.ceil(((bounds[1] ?? 0) + (bounds[3] ?? 1)) * height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}
