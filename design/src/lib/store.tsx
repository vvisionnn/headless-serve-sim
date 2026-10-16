import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DeviceKind } from "./mock";

export type ThemePref = "auto" | "light" | "dark";
export type Scene = "workspace" | "wall" | "empty" | "disconnected" | "phone";
export type InspectorTab = "device" | "app" | "capture" | "activity";
export type ConsoleTab = "logs" | "input" | "accessibility" | "web";
export type Orientation = 0 | 90 | 180 | 270;

export interface Toast {
  id: number;
  title: string;
  detail?: string;
  tone?: "neutral" | "success" | "danger";
  progress?: number;
}

export interface Capture {
  id: number;
  kind: "screenshot" | "recording";
  at: string;
  meta: string;
}

interface State {
  theme: ThemePref;
  resolvedTheme: "light" | "dark";
  device: DeviceKind;
  scene: Scene;
  navigatorOpen: boolean;
  inspectorOpen: boolean;
  consoleOpen: boolean;
  inspectorTab: InspectorTab;
  consoleTab: ConsoleTab;
  simAppearance: "light" | "dark";
  orientation: Orientation;
  axOverlay: boolean;
  recording: boolean;
  recordStartedAt: number | null;
  paletteOpen: boolean;
  phoneLinkOpen: boolean;
  dropping: boolean;
  appOpen: boolean;
  toasts: Toast[];
  captures: Capture[];
  /** Bumps on every screenshot so the stage can play the shutter. */
  shutter: number;
  axHover: string | null;
}

type Actions = {
  set: (patch: Partial<State> | ((s: State) => Partial<State>)) => void;
  toast: (t: Omit<Toast, "id">) => number;
  dismissToast: (id: number) => void;
  updateToast: (id: number, patch: Partial<Toast>) => void;
  screenshot: () => void;
  toggleRecording: () => void;
};

const Ctx = createContext<(State & Actions) | null>(null);

function systemDark() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem("serve-sim-design") ?? "{}") as Partial<State>;
  } catch {
    return {};
  }
})();

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => ({
    theme: saved.theme ?? "auto",
    resolvedTheme: systemDark() ? "dark" : "light",
    device: saved.device ?? "iphone",
    scene: saved.scene ?? "workspace",
    navigatorOpen: saved.navigatorOpen ?? true,
    inspectorOpen: saved.inspectorOpen ?? true,
    consoleOpen: saved.consoleOpen ?? false,
    inspectorTab: saved.inspectorTab ?? "device",
    consoleTab: saved.consoleTab ?? "logs",
    simAppearance: "light",
    orientation: 0,
    axOverlay: false,
    recording: false,
    recordStartedAt: null,
    paletteOpen: false,
    phoneLinkOpen: false,
    dropping: false,
    appOpen: true,
    toasts: [],
    captures: [
      { id: 1, kind: "screenshot", at: "10:38", meta: "1206 × 2622 · PNG" },
      { id: 2, kind: "recording", at: "10:31", meta: "0:24 · 6.8 MB · MP4" },
    ],
    shutter: 0,
    axHover: null,
  }));
  const nextId = useRef(100);

  const set = useCallback<Actions["set"]>((patch) => {
    setState((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }));
  }, []);

  // Persist the layout bits so a reload keeps the reviewer's place.
  useEffect(() => {
    const { theme, device, scene, navigatorOpen, inspectorOpen, consoleOpen, inspectorTab, consoleTab } = state;
    localStorage.setItem(
      "serve-sim-design",
      JSON.stringify({ theme, device, scene, navigatorOpen, inspectorOpen, consoleOpen, inspectorTab, consoleTab }),
    );
  }, [state]);

  // Resolve auto → light/dark, following the OS live.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => set({ resolvedTheme: mq.matches ? "dark" : "light" });
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [set]);

  const effective = state.theme === "auto" ? state.resolvedTheme : state.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = effective;
  }, [effective]);

  const dismissToast = useCallback((id: number) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), [set]);

  const updateToast = useCallback((id: number, patch: Partial<Toast>) => set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) })), [set]);

  const toast = useCallback<Actions["toast"]>(
    (t) => {
      const id = nextId.current++;
      set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
      if (t.progress == null) setTimeout(() => dismissToast(id), 4200);
      return id;
    },
    [set, dismissToast],
  );

  const screenshot = useCallback(() => {
    const id = nextId.current++;
    const now = new Date();
    const at = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
    set((s) => ({
      shutter: s.shutter + 1,
      captures: [{ id, kind: "screenshot" as const, at, meta: "1206 × 2622 · PNG" }, ...s.captures].slice(0, 6),
    }));
  }, [set]);

  const toggleRecording = useCallback(() => {
    set((s) => {
      if (!s.recording) return { recording: true, recordStartedAt: Date.now() };
      const secs = Math.round((Date.now() - (s.recordStartedAt ?? Date.now())) / 1000);
      const id = nextId.current++;
      return {
        recording: false,
        recordStartedAt: null,
        captures: [
          { id, kind: "recording" as const, at: "now", meta: `0:${String(secs).padStart(2, "0")} · ${(secs * 0.28).toFixed(1)} MB · MP4` },
          ...s.captures,
        ].slice(0, 6),
      };
    });
  }, [set]);

  const value = useMemo(
    () => ({ ...state, resolvedTheme: effective, set, toast, dismissToast, updateToast, screenshot, toggleRecording }),
    [state, effective, set, toast, dismissToast, updateToast, screenshot, toggleRecording],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
