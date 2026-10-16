import {
  Camera,
  CloudSun,
  Compass,
  Folder,
  Heart,
  Mail,
  Map as MapIcon,
  MessageCircle,
  Mountain,
  Music,
  Phone,
  Settings,
  StickyNote,
  Clock,
  Flower2,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

export interface AppDef {
  id: string;
  name: string;
  bg: string;
  fg?: string;
  Icon?: LucideIcon;
  custom?: "calendar";
}

export const apps: Record<string, AppDef> = {
  trails: { id: "trails", name: "Trails", bg: "linear-gradient(160deg,#3fd0a0 0%,#139a7c 55%,#0b6e62 100%)", Icon: Mountain },
  safari: { id: "safari", name: "Safari", bg: "linear-gradient(180deg,#ffffff,#e9eef5)", fg: "#1a7cf5", Icon: Compass },
  maps: { id: "maps", name: "Maps", bg: "linear-gradient(160deg,#9fe39b,#56c26a 60%,#f2c34a)", fg: "#ffffff", Icon: MapIcon },
  photos: { id: "photos", name: "Photos", bg: "linear-gradient(180deg,#ffffff,#eef0f3)", fg: "#f5a623", Icon: Flower2 },
  camera: { id: "camera", name: "Camera", bg: "linear-gradient(180deg,#d9dbe0,#9ea2aa)", fg: "#1c1c1e", Icon: Camera },
  weather: { id: "weather", name: "Weather", bg: "linear-gradient(180deg,#4aa3ff,#1c6fe0)", Icon: CloudSun },
  calendar: { id: "calendar", name: "Calendar", bg: "#ffffff", custom: "calendar" },
  notes: { id: "notes", name: "Notes", bg: "linear-gradient(180deg,#fff8d6,#ffe27a 40%,#ffffff 41%)", fg: "#c9a227", Icon: StickyNote },
  files: { id: "files", name: "Files", bg: "linear-gradient(180deg,#ffffff,#eaf2ff)", fg: "#1a7cf5", Icon: Folder },
  clock: { id: "clock", name: "Clock", bg: "linear-gradient(180deg,#2c2c2e,#000)", Icon: Clock },
  health: { id: "health", name: "Health", bg: "linear-gradient(180deg,#ffffff,#f3f3f5)", fg: "#ff2d55", Icon: Heart },
  settings: { id: "settings", name: "Settings", bg: "linear-gradient(180deg,#b5b8bf,#7d818a)", Icon: Settings },
  phone: { id: "phone", name: "Phone", bg: "linear-gradient(180deg,#6ef08a,#24c24a)", Icon: Phone },
  messages: { id: "messages", name: "Messages", bg: "linear-gradient(180deg,#6ef08a,#24c24a)", Icon: MessageCircle },
  mail: { id: "mail", name: "Mail", bg: "linear-gradient(180deg,#5ab8ff,#1a7cf5)", Icon: Mail },
  music: { id: "music", name: "Music", bg: "linear-gradient(180deg,#ff6f86,#fa2d48)", Icon: Music },
};

/** An app icon: continuous-corner squircle with a glass rim, iOS 26 style. */
export function AppIcon({ app, size, style }: { app: AppDef; size: number; style?: CSSProperties }) {
  const r = size * 0.2237;
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: app.bg,
        color: app.fg ?? "#fff",
        boxShadow: `inset 0 ${size * 0.012}px 0 rgba(255,255,255,0.55), inset 0 0 0 ${Math.max(0.5, size * 0.008)}px rgba(255,255,255,0.18), 0 ${size * 0.03}px ${size * 0.1}px rgba(0,0,0,0.18)`,
        ...style,
      }}
    >
      {app.custom === "calendar" ? (
        <div className="flex flex-col items-center leading-none" style={{ gap: size * 0.02 }}>
          <span style={{ fontSize: size * 0.16, fontWeight: 600, color: "#ff3b30", letterSpacing: "0.02em" }}>FRI</span>
          <span style={{ fontSize: size * 0.46, fontWeight: 300, color: "#1c1c1e", letterSpacing: "-0.03em" }}>17</span>
        </div>
      ) : (
        app.Icon && <app.Icon style={{ width: size * 0.54, height: size * 0.54 }} strokeWidth={1.9} />
      )}
      <div className="pointer-events-none absolute inset-0" style={{ borderRadius: r, background: "linear-gradient(180deg,rgba(255,255,255,0.22),transparent 45%)" }} />
    </div>
  );
}

export function StatusBar({ tint, width, time = "9:41", compact }: { tint: string; width: number; time?: string; compact?: boolean }) {
  return (
    <div className="pointer-events-none absolute top-0 left-0 z-40 flex items-center justify-between" style={{ width, height: compact ? 32 : 54, padding: compact ? "0 22px" : "0 34px 0 44px", color: tint }}>
      <span style={{ fontSize: compact ? 13 : 17, fontWeight: 600, letterSpacing: "-0.02em", fontFamily: "var(--font-display)" }}>{time}</span>
      <span className="flex items-center" style={{ gap: 6 }}>
        <svg width="18" height="12" viewBox="0 0 18 12" fill={tint}>
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill={tint}>
          <path d="M8 2.3c2.3 0 4.4.9 6 2.4l1.1-1.2A10.2 10.2 0 0 0 8 .6C5.3.6 2.8 1.7.9 3.5L2 4.7a8.6 8.6 0 0 1 6-2.4Z" />
          <path d="M8 5.6c1.4 0 2.6.5 3.6 1.4l1.1-1.2A6.8 6.8 0 0 0 8 3.9c-1.8 0-3.5.7-4.7 1.9l1.1 1.2c1-.9 2.2-1.4 3.6-1.4Z" />
          <path d="M8 8.9c.5 0 1 .2 1.3.5L8 10.8 6.7 9.4c.3-.3.8-.5 1.3-.5Z" />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke={tint} strokeOpacity="0.4" />
          <rect x="2" y="2" width="20" height="9" rx="2.5" fill={tint} />
          <path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill={tint} fillOpacity="0.45" />
        </svg>
      </span>
    </div>
  );
}

export function HomeIndicator({ tint, width }: { tint: string; width: number }) {
  return <div className="pointer-events-none absolute bottom-[8px] left-1/2 z-40 h-[5px] -translate-x-1/2 rounded-full" style={{ width, background: tint }} />;
}

/** Wallpaper: layered light, after the iOS 26 default. Dark mode dims it. */
export function Wallpaper({ dark }: { dark: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: dark ? "#05060d" : "#c7d3ff" }}>
      <div
        className="absolute inset-[-20%] transition-opacity duration-700"
        style={{
          background: [
            "radial-gradient(60% 45% at 20% 18%, #8fb4ff 0%, transparent 70%)",
            "radial-gradient(55% 40% at 85% 30%, #c9a6ff 0%, transparent 72%)",
            "radial-gradient(70% 50% at 70% 85%, #ffb08a 0%, transparent 70%)",
            "radial-gradient(60% 50% at 15% 80%, #5d7cff 0%, transparent 70%)",
            "linear-gradient(180deg, #a9bcff, #e8c2ff 60%, #ffc9a8)",
          ].join(","),
          opacity: dark ? 0.42 : 1,
        }}
      />
      <div className="absolute inset-0" style={{ background: dark ? "linear-gradient(180deg,rgba(0,0,0,0.35),rgba(0,0,0,0.55))" : "transparent" }} />
    </div>
  );
}

/** Glow palette for the stage — what the screen is "lighting the room" with. */
export const wallpaperGlow = ["#8fb4ff", "#c9a6ff", "#ffb08a", "#5d7cff"];
export const trailsGlow = { light: ["#e9f6f1", "#b9e8d6", "#f4f4f6", "#c8efe2"], dark: ["#0d3b30", "#13a37f", "#1c1c1e", "#0f5e4c"] };
