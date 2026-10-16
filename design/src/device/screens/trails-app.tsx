import { Bookmark, ChevronRight, Compass, Mountain, Search, User } from "lucide-react";
import { trails } from "../../lib/mock";
import { HomeIndicator, StatusBar } from "./parts";
import { TrailMap } from "./trail-map";

const levels = ["Easy", "Moderate", "Hard", "Moderate", "Hard"];

/** The foreground app in the mock: a React Native trail guide. */
export function TrailsApp({ dark, width }: { dark: boolean; width: number }) {
  const bg = dark ? "#000000" : "#f2f2f7";
  const card = dark ? "#1c1c1e" : "#ffffff";
  const label = dark ? "#ffffff" : "#000000";
  const label2 = dark ? "rgba(235,235,245,0.6)" : "rgba(60,60,67,0.6)";
  const fill = dark ? "rgba(118,118,128,0.24)" : "rgba(118,118,128,0.12)";
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: bg, color: label, fontFamily: "var(--font-sans)" }}>
      <StatusBar tint={label} width={width} />
      <div className="absolute flex items-end justify-between" style={{ left: 20, right: 16, top: 60, height: 80 }}>
        <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.025em", fontFamily: "var(--font-display)", lineHeight: "41px" }}>Trails</span>
        <span className="mb-1.5 flex size-[36px] items-center justify-center rounded-full" style={{ background: fill }}>
          <User size={19} strokeWidth={2} color={label2} />
        </span>
      </div>
      <div className="absolute flex items-center gap-1.5 rounded-[10px] px-2" style={{ left: 16, right: 16, top: 156, height: 36, background: fill, color: label2 }}>
        <Search size={16} strokeWidth={2.2} />
        <span style={{ fontSize: 17, letterSpacing: "-0.02em" }}>Search trails</span>
      </div>
      <div className="absolute flex flex-col" style={{ left: 16, right: 16, top: 212, gap: 12 }}>
        {trails.slice(0, 4).map((t, i) => (
          <div key={t.id} className="overflow-hidden" style={{ background: card, borderRadius: 22, height: 168, boxShadow: dark ? "none" : "0 1px 2px rgba(0,0,0,0.04)" }}>
            <TrailMap id={t.id} dark={dark} width={370} height={98} animate />
            <div className="flex items-center justify-between" style={{ padding: "10px 14px 0 16px" }}>
              <div className="flex flex-col" style={{ gap: 2 }}>
                <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>{t.name}</span>
                <span style={{ fontSize: 13, color: label2 }}>
                  {t.km.toFixed(1)} km · ↑ {t.gain} m · {levels[i]}
                </span>
              </div>
              <ChevronRight size={18} color={label2} strokeWidth={2.2} />
            </div>
          </div>
        ))}
      </div>
      {/* Scroll edge effect: content softens under the floating tab bar. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: 150, background: `linear-gradient(to bottom, transparent, ${bg} 62%)` }} />
      {/* Floating Liquid Glass tab bar */}
      <div className="absolute flex items-center" style={{ left: 22, right: 22, bottom: 26, height: 62, gap: 10 }}>
        <div
          className="flex flex-1 items-center justify-around rounded-full"
          style={{
            height: 62,
            background: dark ? "rgba(40,40,44,0.62)" : "rgba(255,255,255,0.62)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            boxShadow: dark ? "inset 0 0.5px 0 rgba(255,255,255,0.15), 0 8px 24px rgba(0,0,0,0.5)" : "inset 0 0.5px 0 #fff, 0 0 0 0.5px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.12)",
            padding: "0 6px",
          }}
        >
          {[
            { n: "Explore", I: Compass, on: true },
            { n: "Saved", I: Bookmark },
            { n: "Climbs", I: Mountain },
          ].map(({ n, I, on }) => (
            <span key={n} className="flex flex-col items-center justify-center rounded-full" style={{ gap: 2, width: 96, height: 52, color: on ? "#13a37f" : label, background: on ? (dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)") : "transparent" }}>
              <I size={22} strokeWidth={2} />
              <span style={{ fontSize: 10, fontWeight: 600 }}>{n}</span>
            </span>
          ))}
        </div>
      </div>
      <HomeIndicator tint={label} width={140} />
    </div>
  );
}
