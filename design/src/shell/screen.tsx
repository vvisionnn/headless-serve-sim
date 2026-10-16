import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { screenPoints } from "../device/device-frame";
import { IOSScreen } from "../device/screens/ios-screen";
import { IPadScreen } from "../device/screens/ipad-screen";
import { WatchScreen } from "../device/screens/watch-screen";
import { useApp } from "../lib/store";
import { axTree, type AxNode, type DeviceKind } from "../lib/mock";

/** What the stream would show — mocked per device kind. */
export function ScreenContent({ kind, dark, appOpen, onOpenApp }: { kind: DeviceKind; dark: boolean; appOpen: boolean; onOpenApp: (v: boolean) => void }) {
  const { width, height } = screenPoints(kind);
  if (kind === "ipad") return <IPadScreen dark={dark} appOpen={appOpen} onOpenApp={onOpenApp} width={width} height={height} />;
  if (kind === "watch") return <WatchScreen appOpen={appOpen} onOpenApp={onOpenApp} />;
  return <IOSScreen dark={dark} appOpen={appOpen} onOpenApp={onOpenApp} width={width} height={height} />;
}

function flatten(n: AxNode, out: AxNode[] = []) {
  if (n.id !== "app") out.push(n);
  n.children?.forEach((c) => flatten(c, out));
  return out;
}
const axNodes = flatten(axTree);

/**
 * The live screen. Appearance changes sweep across as a circular reveal from
 * the bottom edge — where the Appearance control sits — rather than snapping.
 */
export function LiveScreen({ kind }: { kind: DeviceKind }) {
  const { simAppearance, appOpen, set, axOverlay, axHover } = useApp();
  const dark = simAppearance === "dark";
  const [prev, setPrev] = useState<boolean | null>(null);
  const last = useRef(dark);
  const [touches, setTouches] = useState<{ id: number; x: number; y: number }[]>([]);
  const { width, height } = screenPoints(kind);

  useEffect(() => {
    if (last.current === dark) return;
    setPrev(last.current);
    last.current = dark;
    const t = setTimeout(() => setPrev(null), 750);
    return () => clearTimeout(t);
  }, [dark]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const id = performance.now();
    setTouches((t) => [...t, { id, x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height }]);
    setTimeout(() => setTouches((t) => t.filter((p) => p.id !== id)), 600);
  };

  const content = (d: boolean) => <ScreenContent kind={kind} dark={d} appOpen={appOpen} onOpenApp={(v) => set({ appOpen: v })} />;

  return (
    <div className="absolute inset-0" onPointerDownCapture={onDown}>
      {prev === null ? (
        content(dark)
      ) : (
        <>
          {content(prev)}
          <motion.div
            className="absolute inset-0"
            initial={{ clipPath: `circle(0px at 50% 100%)` }}
            animate={{ clipPath: `circle(${Math.hypot(width, height)}px at 50% 100%)` }}
            transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
          >
            {content(dark)}
          </motion.div>
        </>
      )}

      <AnimatePresence>
        {axOverlay && appOpen && kind === "iphone" && (
          <motion.div className="pointer-events-none absolute inset-0 z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {axNodes.map((n, i) => {
              const hot = axHover === n.id;
              return (
                <motion.div
                  key={n.id}
                  className="absolute rounded-[6px]"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.018, duration: 0.25 }}
                  style={{
                    left: n.frame[0],
                    top: n.frame[1],
                    width: n.frame[2],
                    height: n.frame[3],
                    border: `${hot ? 2 : 1.25}px solid ${hot ? "#ff9f0a" : "#0a84ff"}`,
                    background: hot ? "rgba(255,159,10,0.18)" : "rgba(10,132,255,0.08)",
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Touch indicator — the same soft disc Simulator.app shows. */}
      {touches.map((t) => (
        <motion.span
          key={t.id}
          className="pointer-events-none absolute z-[70] rounded-full"
          style={{ left: t.x - 22, top: t.y - 22, width: 44, height: 44, background: "rgba(255,255,255,0.55)", boxShadow: "0 0 0 1px rgba(0,0,0,0.12), 0 2px 10px rgba(0,0,0,0.2)" }}
          initial={{ scale: 0.6, opacity: 0.9 }}
          animate={{ scale: 1.25, opacity: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </div>
  );
}
