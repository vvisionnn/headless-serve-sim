import { AnimatePresence, motion } from "motion/react";
import { Search } from "lucide-react";
import { useRef, useState } from "react";
import { spring } from "../../lib/motion";
import { AppIcon, apps, HomeIndicator, StatusBar, Wallpaper } from "./parts";
import { TrailsApp } from "./trails-app";

const grid = ["calendar", "photos", "camera", "maps", "weather", "clock", "notes", "files", "trails", "health", "settings", "music"];
const dock = ["phone", "safari", "messages", "mail"];

/**
 * iPhone screen mock. Tapping Trails zooms the app out of its icon; Home sends
 * it back into the same icon — enter and exit share one path.
 */
export function IOSScreen({
  dark,
  appOpen,
  onOpenApp,
  width,
  height,
}: {
  dark: boolean;
  appOpen: boolean;
  onOpenApp: (open: boolean) => void;
  width: number;
  height: number;
}) {
  const iconRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [origin, setOrigin] = useState({ x: width / 2, y: height * 0.58 });
  const icon = 64;
  const colGap = (width - 4 * icon) / 5;

  const open = (id: string) => {
    if (id !== "trails") return;
    const el = iconRefs.current[id];
    if (el) setOrigin({ x: el.offsetLeft + icon / 2, y: el.offsetTop + icon / 2 });
    onOpenApp(true);
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-black" style={{ fontFamily: "var(--font-sans)" }}>
      <motion.div
        className="absolute inset-0"
        animate={appOpen ? { scale: 0.9, filter: "blur(6px)", opacity: 0.6 } : { scale: 1, filter: "blur(0px)", opacity: 1 }}
        transition={spring.surface}
        style={{ transformOrigin: `${origin.x}px ${origin.y}px` }}
      >
        <Wallpaper dark={dark} />
        <StatusBar tint="#fff" width={width} />
        <div className="absolute grid" style={{ left: colGap, right: colGap, top: 74, gridTemplateColumns: `repeat(4, ${icon}px)`, columnGap: colGap, rowGap: 26 }}>
          {grid.map((id) => {
            const app = apps[id]!;
            return (
              <button
                key={id}
                type="button"
                className="flex flex-col items-center gap-[6px] outline-none"
                onClick={() => open(id)}
              >
                <motion.div
                  ref={(el) => {
                    iconRefs.current[id] = el;
                  }}
                  whileTap={{ scale: 0.88, filter: "brightness(0.85)" }}
                  transition={spring.snappy}
                >
                  <AppIcon app={app} size={icon} />
                </motion.div>
                <span className="text-white" style={{ fontSize: 12, fontWeight: 500, letterSpacing: "-0.01em", textShadow: "0 1px 4px rgba(0,0,0,0.25)" }}>
                  {app.name}
                </span>
              </button>
            );
          })}
        </div>
        <div
          className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-3 text-white"
          style={{ bottom: 134, height: 30, background: "rgba(255,255,255,0.22)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", fontSize: 14, fontWeight: 600 }}
        >
          <Search size={13} strokeWidth={2.6} /> Search
        </div>
        <div
          className="absolute flex items-center justify-around"
          style={{
            left: 12,
            right: 12,
            bottom: 14,
            height: 96,
            borderRadius: 38,
            background: "rgba(255,255,255,0.2)",
            backdropFilter: "blur(24px) saturate(160%)",
            WebkitBackdropFilter: "blur(24px) saturate(160%)",
            boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.5)",
          }}
        >
          {dock.map((id) => (
            <AppIcon key={id} app={apps[id]!} size={icon} />
          ))}
        </div>
        <HomeIndicator tint="#fff" width={140} />
      </motion.div>

      <AnimatePresence>
        {appOpen && (
          <motion.div
            key="app"
            className="absolute inset-0 overflow-hidden"
            style={{ transformOrigin: `${origin.x}px ${origin.y}px` }}
            initial={{ scale: icon / width, opacity: 0, borderRadius: 60 }}
            animate={{ scale: 1, opacity: 1, borderRadius: 0 }}
            exit={{ scale: icon / width, opacity: 0, borderRadius: 60 }}
            transition={{ ...spring.surface, opacity: { duration: 0.18 } }}
          >
            <TrailsApp dark={dark} width={width} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
