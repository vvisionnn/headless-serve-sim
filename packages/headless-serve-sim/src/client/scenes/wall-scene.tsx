import { motion } from "motion/react";
import { Play, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DeviceBezel } from "../components/device-bezel";
import { useFrameSpec } from "../hooks/use-frame-spec";
import { useGridDevices } from "../hooks/use-grid-devices";
import { spring } from "../lib/motion";
import { StatusDot } from "../ui/badge";
import { Button, IconButton } from "../ui/button";
import { Tip } from "../ui/tooltip";
import { fitDeviceBezel } from "../utils/bezel-geometry";
import type { GridDevice } from "../utils/grid";

export interface WallSceneProps {
  currentUdid: string;
  /** Height reserved at the bottom (console drawer), in px. */
  insetBottom: number;
  /** Focus a live simulator (current one → back to the stage). */
  onFocus: (udid: string) => void;
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

/** The wall shows what is running: streaming first, then booted-but-idle. */
export function wallDevices(devices: GridDevice[]): GridDevice[] {
  return devices
    .filter((d) => d.helper || d.state === "Booted")
    .sort((a, b) => Number(!a.helper) - Number(!b.helper));
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
export function WallScene({ currentUdid, insetBottom, onFocus }: WallSceneProps) {
  const config = typeof window === "undefined" ? undefined : window.__SIM_PREVIEW__;
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1000, h: 700 });
  const [pending, setPending] = useState<Record<string, "start" | "stop">>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const busy = Object.keys(pending).length > 0;
  const grid = useGridDevices(config?.gridApiEndpoint, true, busy);
  const { loadAll, refresh } = grid;
  useEffect(() => loadAll(), [loadAll]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
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

function Tile({
  device,
  index,
  cellW,
  cellH,
  current,
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
  pending: "start" | "stop" | undefined;
  error: string | undefined;
  onFocus: () => void;
  onStart: () => void;
  onShutdown: () => void;
}) {
  const spec = useFrameSpec(device.device);
  const kind = kindOf(device.name);
  const nativeComposite = spec?.deviceTypeIdentifier?.endsWith(".iPhone-Duo") ?? false;
  const live = !!device.helper;
  const [hover, setHover] = useState(false);
  const availW = cellW * 0.86;
  const availH = (cellH - 72) * 0.82 * LINEUP_SHARE[kind];
  const geometry = spec
    ? fitDeviceBezel({
        spec,
        rotation: 0,
        availWidth: availW,
        availHeight: availH,
        maxScreenWidth: Number.POSITIVE_INFINITY,
        maxScale: 1,
      })
    : null;
  const aspect = FALLBACK_ASPECT[kind];
  const w = geometry?.width ?? Math.min(availW, availH * aspect);
  const h = geometry?.height ?? w / aspect;

  const screen = live ? (
    <img
      src={device.helper!.streamUrl}
      alt={device.name}
      draggable={false}
      className="pointer-events-none absolute inset-0 size-full object-cover select-none"
    />
  ) : (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0b0b0d] text-white">
      <span className="text-footnote font-semibold">Not streaming</span>
    </div>
  );

  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-4"
      initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ ...spring.surface, delay: 0.06 * index }}
    >
      <motion.button
        type="button"
        disabled={!live}
        onHoverStart={() => setHover(true)}
        onHoverEnd={() => setHover(false)}
        onClick={() => live && onFocus()}
        className="relative outline-none disabled:cursor-default"
        style={{ width: w, height: h }}
        animate={{ y: hover && live ? -6 : 0 }}
        transition={spring.ui}
        aria-label={`Focus ${device.name}`}
      >
        <motion.div
          layoutId={live ? `device-${device.device}` : undefined}
          className="absolute inset-0"
          transition={spring.surface}
        >
          {nativeComposite && live ? (
            // The Duo streams a native composite that already draws the
            // device; a second bezel around it would frame it twice.
            <div className="absolute inset-0 overflow-hidden rounded-[18px]">
              <img
                src={device.helper!.streamUrl}
                alt={device.name}
                draggable={false}
                className="pointer-events-none size-full object-contain select-none"
              />
            </div>
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
