import { createContext, useContext } from "react";
import type { ThemePref } from "../lib/theme";

export type InspectorTab = "device" | "app" | "capture" | "activity";
export type ConsoleTab = "logs" | "input" | "accessibility" | "web";

export interface ShellToast {
  id: number;
  title: string;
  detail?: string;
  tone?: "neutral" | "success" | "danger";
  /** 0..1 shows a determinate bar; `"indeterminate"` a running one. */
  progress?: number | "indeterminate";
}

/** A screenshot or recording made this session, newest first. */
export interface Capture {
  id: number;
  kind: "screenshot" | "recording";
  createdAt: number;
  /** e.g. "1206 × 2622 · PNG" or "0:24 · 6.8 MB · MP4" */
  meta: string;
  /** Object URL of the file — used for the thumbnail and Download. */
  url: string;
  filename: string;
  blob: Blob;
}

/** What the dock, toolbar pill and Capture tab share about screen recording. */
export interface RecordingController {
  status: "idle" | "preparing" | "recording" | "finishing";
  /** Epoch ms when frames started being written; null unless recording. */
  startedAt: number | null;
  /** False when the browser or stream can't record right now. */
  available: boolean;
  start: () => void;
  stop: () => void;
}

/**
 * Everything the shell's floating pieces (toolbar, dock, palette, panels)
 * need to read or trigger. client.tsx owns the state; components consume it
 * here instead of threading a dozen props through every layer.
 */
export interface Shell {
  theme: {
    pref: ThemePref;
    resolved: "light" | "dark";
    setPref: (p: ThemePref, origin?: { x: number; y: number }) => void;
  };

  navigatorOpen: boolean;
  setNavigatorOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  inspectorOpen: boolean;
  setInspectorOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  inspectorTab: InspectorTab;
  setInspectorTab: (t: InspectorTab) => void;
  consoleOpen: boolean;
  setConsoleOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  consoleTab: ConsoleTab;
  setConsoleTab: (t: ConsoleTab) => void;
  wallOpen: boolean;
  setWallOpen: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;

  /** Current simulator; null when nothing is streaming. */
  device: {
    udid: string;
    name: string | null;
    runtime: string | null;
    type: "iphone" | "ipad" | "watch" | "vision";
  } | null;
  streaming: boolean;

  goHome: () => void;
  rotate: () => void;
  canRotate: boolean;
  toggleAppearance: () => void;
  screenshot: () => void;
  toggleSoftwareKeyboard: () => void;
  axOverlayEnabled: boolean;
  toggleAxOverlay: () => void;
  /** Present only when the foreground app is React Native. */
  reloadReactNative: (() => void) | null;
  recording: RecordingController;

  captures: Capture[];
  addCapture: (c: Omit<Capture, "id">) => void;

  toast: (t: Omit<ShellToast, "id">) => number;
  updateToast: (id: number, patch: Partial<ShellToast>) => void;
  dismissToast: (id: number) => void;
}

export const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell() outside <ShellContext>");
  return shell;
}

/** For components that also render outside the shell (tests, phone page). */
export function useOptionalShell(): Shell | null {
  return useContext(ShellContext);
}
