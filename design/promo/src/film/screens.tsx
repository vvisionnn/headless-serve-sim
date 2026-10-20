import { axNodes, screens, type Screen } from "./assets";
import { clamp, mix } from "../lib/time";

/** iPhone 17 Pro: 1206 × 2622 pixels, 402 × 874 points. */
const PX = 3;
const W = 1206;
const H = 2622;

/** The Settings icon on the real Home Screen, in points. */
export const SETTINGS_ICON = { x: 312.7, y: 391.3, w: 64, h: 64 };
export const settingsCenter = { x: SETTINGS_ICON.x + 32, y: SETTINGS_ICON.y + 32 };

function Shot({ src, style }: { src: Screen; style?: React.CSSProperties }) {
  return <img src={screens[src]} alt="" className="absolute inset-0 size-full" style={style} />;
}

/**
 * The hero iPhone's real screen, composed the way iOS moves between them.
 * Every state is a progress the film hands in: `power` wakes the display,
 * `unlock` lifts the Lock Screen and lets the Home Screen settle in, `dark`
 * sweeps Dark Mode up from the bottom edge (where the dock's appearance
 * control sits), `open` grows Settings out of its icon, `ax` lays the real
 * accessibility frames over it, and `glare` runs light across the glass.
 */
export function HeroScreen({
  power = 1,
  unlock = 1,
  dark = 0,
  open = 0,
  ax = 0,
  touch,
  flash = 0,
  glare = -1,
}: {
  power?: number;
  unlock?: number;
  dark?: number;
  open?: number;
  ax?: number;
  touch?: { x: number; y: number; p: number };
  flash?: number;
  glare?: number;
}) {
  const icon = SETTINGS_ICON;
  const o = { x: settingsCenter.x * PX, y: settingsCenter.y * PX };
  const k = mix(icon.w / 402, 1, open);
  const home = clamp(unlock);
  const pressed = touch ? Math.sin(Math.PI * clamp(touch.p * 1.8)) : 0;
  return (
    <div className="absolute overflow-hidden bg-black" style={{ width: W, height: H }}>
      {/* Home Screen: settles in from slightly large as the Lock Screen lifts; recedes behind an opening app. */}
      {home > 0.001 && (
        <div
          className="absolute inset-0"
          style={{
            transformOrigin: `${o.x}px ${o.y}px`,
            transform: `scale(${mix(1.12, 1, home) * mix(1, 1.08, clamp(open))})`,
            filter: `blur(${mix(14, 0, home) + 10 * clamp(open)}px) brightness(${mix(1, 0.7, clamp(open))})`,
            opacity: home,
          }}
        >
          {dark < 1 && <Shot src="homeLight" />}
          {dark > 0 && (
            <div
              className="absolute inset-0"
              style={{
                clipPath:
                  dark >= 1 ? undefined : `circle(${Math.hypot(W, H) * dark}px at 50% 100%)`,
              }}
            >
              <Shot src="homeDark" />
            </div>
          )}
          {pressed > 0 && (
            <div
              className="absolute rounded-[44px] bg-black"
              style={{
                left: icon.x * PX,
                top: icon.y * PX,
                width: icon.w * PX,
                height: icon.h * PX,
                opacity: pressed * 0.35,
              }}
            />
          )}
        </div>
      )}

      {/* Lock Screen: lifts away on unlock. */}
      {unlock < 1 && (
        <div
          className="absolute inset-0"
          style={{ transform: `translateY(${-H * clamp(unlock) * 1.02}px)` }}
        >
          <Shot src="lock" />
        </div>
      )}

      {/* Settings, grown out of its own icon. */}
      {open > 0.001 && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            transformOrigin: `${o.x}px ${o.y}px`,
            transform: `translate(${(1 - clamp(open)) * 0}px, 0) scale(${k})`,
            borderRadius: mix((icon.w * PX * 0.2237) / k, 0, clamp(open)),
            opacity: clamp(open * 4),
          }}
        >
          <Shot src="settings" />
        </div>
      )}

      {/* The real accessibility frames, cascading in reading order. */}
      {ax > 0 &&
        axNodes.map((n, i) => {
          const p = clamp(ax * 1.7 - i * 0.045);
          if (p <= 0) return null;
          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: n.frame[0] * PX,
                top: n.frame[1] * PX,
                width: n.frame[2] * PX,
                height: n.frame[3] * PX,
                borderRadius: 18,
                border: "4px solid #0a84ff",
                background: "rgba(10,132,255,0.10)",
                opacity: p,
                transform: `scale(${mix(1.05, 1, p)})`,
              }}
            />
          );
        })}
      {ax > 0 && ax < 1 && (
        <div
          className="absolute inset-x-0 h-[6px]"
          style={{
            top: H * clamp(ax * 1.15) - 3,
            background: "linear-gradient(90deg, transparent, rgba(120,190,255,0.9), transparent)",
            boxShadow: "0 0 40px 12px rgba(10,132,255,0.45)",
          }}
        />
      )}

      {touch && touch.p > 0 && touch.p < 1 && (
        <span
          className="absolute rounded-full"
          style={{
            left: (touch.x - 22) * PX,
            top: (touch.y - 22) * PX,
            width: 44 * PX,
            height: 44 * PX,
            background: "rgba(255,255,255,0.55)",
            boxShadow: "0 0 0 3px rgba(0,0,0,0.12), 0 6px 30px rgba(0,0,0,0.2)",
            transform: `scale(${mix(0.6, 1.25, touch.p)})`,
            opacity: mix(0.9, 0, touch.p),
          }}
        />
      )}

      {flash > 0 && <div className="absolute inset-0 bg-white" style={{ opacity: flash }} />}
      {power < 1 && <div className="absolute inset-0 bg-black" style={{ opacity: 1 - power }} />}
      {glare > -1 && glare < 2 && (
        <div
          className="absolute inset-0"
          style={{
            mixBlendMode: "screen",
            background: `linear-gradient(115deg, transparent ${mix(-40, 110, glare) - 14}%, rgba(255,255,255,0.16) ${mix(-40, 110, glare)}%, transparent ${mix(-40, 110, glare) + 14}%)`,
          }}
        />
      )}
    </div>
  );
}

/** A still screen for the other devices on the wall. */
export function StillScreen({ src }: { src: Screen }) {
  return <Shot src={src} />;
}
