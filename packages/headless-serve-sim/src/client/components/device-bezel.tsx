import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type {
  DeviceFrameArtworkControl,
  DeviceFrameSpec,
} from "headless-serve-sim-client/simulator";
import {
  controlHoverOffset,
  deviceFrameControlRectAt,
  prepareDeviceFrameArtwork,
  restingControlOffset,
} from "../device-frame-artwork";
import { hardwareButtonAction, type HardwareButtonPress } from "../utils/hardware-buttons";
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

const SHADOW = "drop-shadow(0 2px 6px rgba(0,0,0,0.10)) drop-shadow(0 14px 40px rgba(0,0,0,0.18))";

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
    // Composite the body WITHOUT its controls: they are drawn separately below
    // so each one can move under the pointer and be pressed.
    void prepareDeviceFrameArtwork(spec, undefined, false).then((prepared) => {
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
  onPressButton,
  ...dropProps
}: {
  spec: DeviceFrameSpec;
  geometry: BezelGeometry;
  children: ReactNode;
  screenRef?: (node: HTMLDivElement | null) => void;
  /** Press a physical control on the bezel. */
  onPressButton?: (press: HardwareButtonPress) => void;
} & Record<string, unknown>) {
  const artwork = useFrameArtwork(spec);
  const { screen, screenRadii, rotation } = geometry;
  const sideways = Math.abs(rotation) === 90;
  const bodyWidth = sideways ? geometry.artworkHeight : geometry.artworkWidth;
  const bodyHeight = sideways ? geometry.artworkWidth : geometry.artworkHeight;
  const bodyLeft = (geometry.width - bodyWidth) / 2;
  const bodyTop = (geometry.height - bodyHeight) / 2;

  return (
    <div className="relative shrink-0" style={{ width: geometry.width, height: geometry.height }}>
      {/* The device body and its controls share one rotated layer, so turning
          the device keeps every button on the edge it physically lives on. The
          drop shadow lives HERE rather than on the wrapper: the wrapper also
          contains the live screen, and a filter forces its whole subtree to be
          re-rasterized — every decoded frame would pay for the shadow. */}
      {spec.artwork ? (
        <div
          className="pointer-events-none absolute"
          style={{
            width: geometry.artworkWidth,
            height: geometry.artworkHeight,
            left: bodyLeft + (bodyWidth - geometry.artworkWidth) / 2,
            top: bodyTop + (bodyHeight - geometry.artworkHeight) / 2,
            transform: rotation ? `rotate(${rotation}deg)` : undefined,
            transformOrigin: "center",
            filter: SHADOW,
          }}
        >
          <BezelControls
            spec={spec}
            scale={geometry.scale}
            onTop={false}
            onPressButton={onPressButton}
          />
          {/* The composited body. The controls above and below it stand on their
              own, so a slow or failed composite costs the device its skin — not
              its buttons. */}
          {artwork && (
            <img
              src={artwork}
              alt=""
              aria-hidden
              draggable={false}
              className="pointer-events-none absolute inset-0 size-full select-none"
            />
          )}
          <BezelControls spec={spec} scale={geometry.scale} onTop onPressButton={onPressButton} />
        </div>
      ) : (
        // Profiles that ship no artwork at all: a plain dark shell at the
        // profile's own outer radius.
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[#09090b]"
          style={{ borderRadius: geometry.outerRadius, filter: SHADOW }}
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

/**
 * The physical controls on the device body.
 *
 * DeviceKit gives every control two positions — `normalOffsetPx` at rest and
 * `rolloverOffsetPx` pushed out from the body — which is exactly the hover
 * behaviour Simulator.app shows. Each control is its own image so it can slide
 * between the two under the pointer and be pressed; they are excluded from the
 * composited body above so nothing is drawn twice.
 *
 * Controls that are not presses (the digital crown rotates; the Action button
 * has no usage of its own) are drawn but stay inert — `hardwareButtonAction`
 * decides, so a new device body needs no table here.
 */
function BezelControls({
  spec,
  scale,
  onTop,
  onPressButton,
}: {
  spec: DeviceFrameSpec;
  scale: number;
  /** Render the layer that sits above the body, or the one beneath it. */
  onTop: boolean;
  onPressButton?: (press: HardwareButtonPress) => void;
}) {
  const artwork = spec.artwork;
  if (!artwork) return null;
  return (
    <>
      {artwork.controls
        .filter((control) => control.onTop === onTop)
        .map((control) => (
          <BezelControl
            key={`${control.name}-${control.anchor}-${control.normalOffsetPx.y}`}
            control={control}
            artwork={artwork}
            scale={scale}
            onPressButton={onPressButton}
          />
        ))}
    </>
  );
}

function BezelControl({
  control,
  artwork,
  scale,
  onPressButton,
}: {
  control: DeviceFrameArtworkControl;
  artwork: NonNullable<DeviceFrameSpec["artwork"]>;
  scale: number;
  onPressButton?: (press: HardwareButtonPress) => void;
}) {
  const [hover, setHover] = useState(false);
  const [held, setHeld] = useState(false);
  const action = hardwareButtonAction(control.name);
  const pressable = action !== null && onPressButton !== undefined;

  const rest = deviceFrameControlRectAt(control, artwork, restingControlOffset(control));
  const out = deviceFrameControlRectAt(control, artwork, controlHoverOffset(control));
  // Layout stays at the resting rect so it tracks `scale` in lockstep with the
  // body, which has no transition of its own. The hover throw rides on a
  // transform instead — and in PERCENT, which resolves against the button's own
  // box, so a resize rescales the travel for free and never animates it.
  const travel = {
    x: ((out.x - rest.x) / rest.width) * 100,
    y: ((out.y - rest.y) / rest.height) * 100,
  };
  const extended = hover || held;

  const press = () => {
    if (!action || !onPressButton) return;
    onPressButton(
      action.button
        ? { button: action.button }
        : { usagePage: action.usagePage, usage: action.usage },
    );
  };

  return (
    <img
      src={control.image.pngDataUrl}
      alt=""
      draggable={false}
      aria-hidden={!pressable}
      role={pressable ? "button" : undefined}
      aria-label={pressable ? action.label : undefined}
      tabIndex={pressable ? 0 : -1}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setHeld(false);
      }}
      onPointerDown={() => pressable && setHeld(true)}
      onPointerUp={() => {
        if (!pressable) return;
        setHeld(false);
        press();
      }}
      onKeyDown={(e) => {
        // `repeat` guard: a held Enter would otherwise send one HID press per
        // key-repeat tick. A real <button> fires click once.
        if (!pressable || e.repeat || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        press();
      }}
      className={`absolute select-none outline-none ${
        pressable ? "pointer-events-auto cursor-pointer" : "pointer-events-none"
      } [transition:transform_0.16s_cubic-bezier(0.4,0,0.6,1)] focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]`}
      style={{
        left: rest.x * scale,
        top: rest.y * scale,
        width: rest.width * scale,
        height: rest.height * scale,
        transform: extended ? `translate(${travel.x}%, ${travel.y}%)` : undefined,
      }}
    />
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
