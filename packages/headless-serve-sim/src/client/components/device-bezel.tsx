import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { prepareDeviceFrameArtwork } from "../device-frame-artwork";
import type { BezelGeometry } from "../utils/bezel-geometry";

// The device as it looks in Simulator.app — because it IS what Simulator.app
// draws. The installed device profile ships nine-slice frame artwork (corners,
// edges and the side-button nubs as separate PNGs); `prepareDeviceFrameArtwork`
// composites them exactly as the recorder does. Nothing here approximates a
// corner: the continuous-curvature shape is baked into Apple's own artwork, and
// the screen is clipped to the profile's per-corner `screenRadiiPx`.
//
// Stacking matches the recorder (`paintRecordingFrameAtScale`): the artwork is
// painted FIRST and the screen composited over it. The artwork is a whole
// device, not a mask with a hole punched in it — putting it on top would let
// its nine-slice edges cover the live screen.

const dataUrls = new Map<string, string>();

function artworkKey(spec: DeviceFrameSpec): string {
  return `${spec.deviceTypeIdentifier}:${spec.chromeIdentifier}:${spec.artwork?.width}x${spec.artwork?.height}`;
}

/** Composite the device's frame artwork once, then reuse the PNG. */
function useFrameArtwork(spec: DeviceFrameSpec | null): string | null {
  const key = spec?.artwork ? artworkKey(spec) : null;
  const [url, setUrl] = useState<string | null>(() => (key ? (dataUrls.get(key) ?? null) : null));

  useEffect(() => {
    if (!spec?.artwork || !key) {
      setUrl(null);
      return;
    }
    const cached = dataUrls.get(key);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    void prepareDeviceFrameArtwork(spec).then((prepared) => {
      if (cancelled || !prepared) return;
      const canvas = prepared.source as HTMLCanvasElement;
      if (typeof canvas.toDataURL !== "function") return;
      const next = canvas.toDataURL("image/png");
      dataUrls.set(key, next);
      setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [spec, key]);

  return url;
}

export function DeviceBezel({
  spec,
  geometry,
  children,
  screenRef,
  ...dropProps
}: {
  spec: DeviceFrameSpec;
  geometry: BezelGeometry;
  children: ReactNode;
  screenRef?: (node: HTMLDivElement | null) => void;
} & Record<string, unknown>) {
  const artwork = useFrameArtwork(spec);
  const { screen, screenRadii, rotation } = geometry;
  const sideways = Math.abs(rotation) === 90;

  return (
    <div
      className="relative shrink-0"
      style={{
        width: geometry.width,
        height: geometry.height,
        filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.10)) drop-shadow(0 14px 40px rgba(0,0,0,0.18))",
      }}
    >
      {/* The device body, painted under the screen. */}
      {artwork ? (
        <img
          src={artwork}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute select-none"
          style={{
            width: geometry.artworkWidth,
            height: geometry.artworkHeight,
            left:
              (geometry.width - (sideways ? geometry.artworkHeight : geometry.artworkWidth)) / 2,
            top:
              (geometry.height - (sideways ? geometry.artworkWidth : geometry.artworkHeight)) / 2,
            transform: rotation ? `rotate(${rotation}deg)` : undefined,
            transformOrigin: "center",
          }}
        />
      ) : (
        // Until the artwork is composited (and for profiles that ship none),
        // a plain dark shell at the profile's own outer radius.
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[#09090b]"
          style={{ borderRadius: geometry.outerRadius }}
        />
      )}

      {/* The screen, composited over the body and clipped to the profile's own
          corner radii so the stream stops exactly where the glass does. */}
      <div
        ref={screenRef}
        className="absolute overflow-hidden bg-black"
        style={{
          left: screen.x,
          top: screen.y,
          width: screen.width,
          height: screen.height,
          borderRadius: `${screenRadii.topLeft}px ${screenRadii.topRight}px ${screenRadii.bottomRight}px ${screenRadii.bottomLeft}px`,
        }}
        {...dropProps}
      >
        {children}
      </div>
    </div>
  );
}

/** A bare rounded screen for profiles with no frame geometry at all (vision). */
export function BareScreen({
  width,
  height,
  children,
  screenRef,
  ...dropProps
}: {
  width: number;
  height: number;
  children: ReactNode;
  screenRef?: (node: HTMLDivElement | null) => void;
} & Record<string, unknown>) {
  return (
    <div
      ref={screenRef}
      className="relative shrink-0 overflow-hidden rounded-panel bg-black shadow-device"
      style={{ width, height } as CSSProperties}
      {...dropProps}
    >
      {children}
    </div>
  );
}
