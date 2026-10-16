import { AnimatePresence, motion } from "motion/react";
import { Bookmark, Compass, Mountain, Search } from "lucide-react";
import { trails } from "../../lib/mock";
import { spring } from "../../lib/motion";
import { AppIcon, apps, HomeIndicator, StatusBar, Wallpaper } from "./parts";
import { TrailMap } from "./trail-map";

const grid = ["calendar", "photos", "camera", "maps", "weather", "clock", "notes", "files", "trails", "health", "settings", "music", "mail", "safari"];
const dock = ["messages", "safari", "mail", "music", "trails", "files"];

export function IPadScreen({ dark, appOpen, onOpenApp, width, height }: { dark: boolean; appOpen: boolean; onOpenApp: (v: boolean) => void; width: number; height: number }) {
  const icon = 80;
  return (
    <div className="absolute inset-0 overflow-hidden bg-black" style={{ fontFamily: "var(--font-sans)" }}>
      <motion.div className="absolute inset-0" animate={appOpen ? { scale: 0.94, opacity: 0.5, filter: "blur(8px)" } : { scale: 1, opacity: 1, filter: "blur(0px)" }} transition={spring.surface}>
        <Wallpaper dark={dark} />
        <StatusBar tint="#fff" width={width} compact />
        <div className="absolute flex gap-8" style={{ left: 70, top: 80 }}>
          <div className="flex flex-col justify-between rounded-[28px] p-5 text-white" style={{ width: 340, height: 160, background: "linear-gradient(160deg,rgba(74,163,255,0.85),rgba(28,111,224,0.85))", backdropFilter: "blur(20px)" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Cupertino</div>
              <div style={{ fontSize: 44, fontWeight: 300, letterSpacing: "-0.03em", lineHeight: 1.1 }}>21°</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.9 }}>Mostly Sunny · H:24° L:13°</div>
          </div>
          <div className="flex flex-col rounded-[28px] p-5" style={{ width: 160, height: 160, background: dark ? "rgba(28,28,30,0.85)" : "rgba(255,255,255,0.85)", color: dark ? "#fff" : "#000" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#ff3b30" }}>FRIDAY</span>
            <span style={{ fontSize: 44, fontWeight: 300, lineHeight: 1 }}>17</span>
            <span className="mt-auto" style={{ fontSize: 12, fontWeight: 600 }}>Trail run · 7:00</span>
          </div>
        </div>
        <div className="absolute grid" style={{ left: 70, right: 70, top: 300, gridTemplateColumns: `repeat(7, ${icon}px)`, justifyContent: "space-between", rowGap: 40 }}>
          {grid.map((id) => (
            <button key={id} type="button" onClick={() => id === "trails" && onOpenApp(true)} className="flex flex-col items-center gap-2 outline-none">
              <motion.div whileTap={{ scale: 0.88 }} transition={spring.snappy}>
                <AppIcon app={apps[id]!} size={icon} />
              </motion.div>
              <span className="text-white" style={{ fontSize: 13, fontWeight: 500, textShadow: "0 1px 4px rgba(0,0,0,0.25)" }}>
                {apps[id]!.name}
              </span>
            </button>
          ))}
        </div>
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-5 rounded-[36px] px-5" style={{ bottom: 22, height: 110, background: "rgba(255,255,255,0.22)", backdropFilter: "blur(24px) saturate(160%)", boxShadow: "inset 0 0.5px 0 rgba(255,255,255,0.5)" }}>
          {dock.map((id, i) => (
            <AppIcon key={`${id}${i}`} app={apps[id]!} size={icon} />
          ))}
        </div>
        <HomeIndicator tint="#fff" width={320} />
      </motion.div>
      <AnimatePresence>
        {appOpen && (
          <motion.div
            key="app"
            className="absolute inset-0 flex"
            style={{ background: dark ? "#000" : "#f2f2f7", color: dark ? "#fff" : "#000", transformOrigin: "60% 80%" }}
            initial={{ scale: 0.1, opacity: 0, borderRadius: 80 }}
            animate={{ scale: 1, opacity: 1, borderRadius: 0 }}
            exit={{ scale: 0.1, opacity: 0, borderRadius: 80 }}
            transition={{ ...spring.surface, opacity: { duration: 0.18 } }}
          >
            <StatusBar tint={dark ? "#fff" : "#000"} width={width} compact />
            <div className="flex h-full flex-col gap-3 px-5 pt-16" style={{ width: 360, background: dark ? "#1c1c1e" : "#fff" }}>
              <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.025em" }}>Trails</span>
              <div className="flex items-center gap-2 rounded-[10px] px-2.5" style={{ height: 36, background: dark ? "rgba(118,118,128,0.24)" : "rgba(118,118,128,0.12)", color: "rgba(127,127,135,1)" }}>
                <Search size={16} /> <span style={{ fontSize: 17 }}>Search</span>
              </div>
              {trails.map((t, i) => (
                <div key={t.id} className="flex items-center gap-3 rounded-[14px] px-3 py-2.5" style={{ background: i === 1 ? "#13a37f" : "transparent", color: i === 1 ? "#fff" : undefined }}>
                  <Mountain size={20} />
                  <div className="flex flex-col">
                    <span style={{ fontSize: 17, fontWeight: 600 }}>{t.name}</span>
                    <span style={{ fontSize: 13, opacity: 0.7 }}>{t.km} km · {t.place}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="relative flex-1 overflow-hidden">
              <div className="absolute inset-0">
                <TrailMap id="golden-gate" dark={dark} width={width - 360} height={height} animate />
              </div>
              <div className="absolute right-6 bottom-8 left-6 flex items-center justify-between rounded-[28px] px-6 py-5" style={{ background: dark ? "rgba(40,40,44,0.7)" : "rgba(255,255,255,0.75)", backdropFilter: "blur(20px)" }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>Golden Gate Crossing</div>
                  <div style={{ fontSize: 15, opacity: 0.6 }}>5.3 km · ↑ 68 m · Moderate</div>
                </div>
                <div className="flex gap-2">
                  <span className="flex size-11 items-center justify-center rounded-full" style={{ background: "rgba(127,127,135,0.16)" }}>
                    <Bookmark size={20} />
                  </span>
                  <span className="flex h-11 items-center gap-2 rounded-full px-5 text-white" style={{ background: "#13a37f", fontSize: 17, fontWeight: 600 }}>
                    <Compass size={18} /> Start
                  </span>
                </div>
              </div>
            </div>
            <HomeIndicator tint={dark ? "#fff" : "#000"} width={320} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
