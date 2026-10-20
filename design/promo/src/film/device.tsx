import { useId, type ReactNode } from "react";
import { screens, sizeOf, type Screen } from "./assets";
import { artwork, RealDevice, type Kind } from "./real-device";

/** Each kind is drawn once at this scale, then transformed: crisp at any size. */
const BASE: Record<Kind, number> = { iphone: 0.32, air: 0.31, ipad: 0.26, watch: 0.6 };
/** The Duo's renders are taken at 2×; this maps them onto the others' scale. */
const DUO_PX = 0.9;

export type Body = { kind: Kind } | { duo: Screen };

export function size(body: Body, s: number) {
  if ("kind" in body) return { w: artwork(body.kind).w * s, h: artwork(body.kind).h * s };
  const n = sizeOf(body.duo);
  return { w: n.w * DUO_PX * s, h: n.h * DUO_PX * s };
}

export interface Pose {
  x: number;
  y: number;
  /** Scale against the artwork's pixels. */
  s: number;
  opacity?: number;
  blur?: number;
  /** Velocity in px per frame; smears the object along its motion. */
  vx?: number;
  vy?: number;
  /** Degrees, for a physical settle: tilt toward the camera, turn, roll. */
  tiltX?: number;
  tiltY?: number;
  roll?: number;
}

/**
 * A device in the room, placed by its centre. It carries its own screen light
 * (the stage's signature: the screen lights the room around it) and a contact
 * shadow, so it reads as an object sitting on the floor rather than a picture.
 */
export function Device({
  body,
  pose,
  glow,
  shadow = 1,
  children,
}: {
  body: Body;
  pose: Pose;
  glow?: { colors: string[]; o: number }[];
  shadow?: number;
  children?: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const { x, y, s, opacity = 1, blur = 0, vx = 0, vy = 0, tiltX = 0, tiltY = 0, roll = 0 } = pose;
  if (opacity <= 0.001) return null;
  const { w, h } = size(body, s);
  const smear = { x: Math.min(40, Math.abs(vx) * 0.45), y: Math.min(40, Math.abs(vy) * 0.45) };
  const moving = smear.x > 0.4 || smear.y > 0.4;
  const filters = [blur > 0.05 ? `blur(${blur}px)` : "", moving ? `url(#mb-${id})` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className="absolute top-0 left-0"
      style={{ transform: `translate(${x}px, ${y}px)`, opacity }}
    >
      {moving && (
        <svg width="0" height="0" className="absolute">
          <filter id={`mb-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={`${smear.x} ${smear.y}`} />
          </filter>
        </svg>
      )}
      <div
        aria-hidden
        className="absolute rounded-[50%] bg-black/25 dark:bg-black/70"
        style={{
          left: -w * 0.36,
          top: h / 2 - 12,
          width: w * 0.72,
          height: 22,
          filter: "blur(14px)",
          opacity: shadow,
        }}
      />
      {glow?.map((g, i) =>
        g.o > 0.001 ? (
          <div
            key={i}
            aria-hidden
            className="absolute"
            style={{
              left: -w * 0.82,
              top: -h * 0.66,
              width: w * 1.64,
              height: h * 1.32,
              filter: `blur(${Math.max(48, w * 0.22)}px)`,
              mixBlendMode: "var(--glow-blend)" as never,
              opacity: `calc(var(--glow-strength) * ${g.o})`,
              background: [
                `radial-gradient(40% 32% at 32% 26%, ${g.colors[0]} 0%, transparent 100%)`,
                `radial-gradient(40% 34% at 70% 30%, ${g.colors[1]} 0%, transparent 100%)`,
                `radial-gradient(44% 34% at 66% 76%, ${g.colors[2]} 0%, transparent 100%)`,
                `radial-gradient(40% 30% at 30% 72%, ${g.colors[3]} 0%, transparent 100%)`,
              ].join(","),
            }}
          />
        ) : null,
      )}
      <div
        style={{
          perspective: 1600,
          position: "absolute",
          left: -w / 2,
          top: -h / 2,
          width: w,
          height: h,
        }}
      >
        <div
          style={{
            transform: `rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotate(${roll}deg)`,
            filter: filters || undefined,
            width: w,
            height: h,
          }}
        >
          {"kind" in body ? (
            <div
              style={{
                filter: "var(--device-shadow)",
                transform: `scale(${s / BASE[body.kind]})`,
                transformOrigin: "0 0",
              }}
            >
              <RealDevice kind={body.kind} scale={BASE[body.kind]}>
                {children}
              </RealDevice>
            </div>
          ) : (
            <img
              src={screens[body.duo]}
              alt=""
              style={{ width: w, height: h, filter: "var(--device-shadow)" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
