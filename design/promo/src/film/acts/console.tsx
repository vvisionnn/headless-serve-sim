import { Accessibility, Globe, MousePointerClick, MousePointer2, Pause, ScrollText, Trash2, Type, X } from "lucide-react";
import { StatusDot } from "../../../../src/ui/badge";
import { IconButton } from "../../../../src/ui/button";
import { Segmented } from "../../../../src/ui/segmented";
import { clamp, curve, ease, mix, spring } from "../../lib/time";
import { axNodes } from "../assets";
import { cue } from "../cues";
import { CONSOLE_H, GAP, MAIN } from "../layout";

/**
 * What the device logs while Settings comes up, streamed one line at a time:
 * the same shape as the Stage's Logs view, timed to the film.
 */
const LOGS: { level: "default" | "info" | "debug" | "error"; process: string; sub: string; msg: string }[] = [
  { level: "default", process: "backboardd", sub: "com.apple.backboard:hid", msg: "Touch began at (344.7, 423.2) · digitizer 0" },
  { level: "default", process: "SpringBoard", sub: "com.apple.SpringBoard:Scene", msg: "Scene update for com.apple.Preferences: foreground, active" },
  { level: "info", process: "runningboardd", sub: "com.apple.runningboard:process", msg: "Acquired assertion for app<com.apple.Preferences> (UIScene:foreground)" },
  { level: "debug", process: "Preferences", sub: "com.apple.Preferences:root", msg: "Loaded 14 specifiers in 6.2 ms" },
  { level: "default", process: "Preferences", sub: "com.apple.UIKit:Layout", msg: "Root list commit 4.8 ms · 12 rows · 0 dropped frames" },
  { level: "info", process: "SpringBoard", sub: "com.apple.SpringBoard:StatusBar", msg: "Status bar override: 9:41 · Wi-Fi 3 · 100% charged" },
  { level: "debug", process: "Preferences", sub: "com.apple.accounts:AccountStore", msg: "No signed-in Apple Account; showing sign-in cell" },
  { level: "default", process: "backboardd", sub: "com.apple.backboard:hid", msg: "Touch ended at (344.7, 423.2) · digitizer 0" },
  { level: "info", process: "Preferences", sub: "com.apple.Spotlight:index", msg: "Optimizing Search and Siri: 38% complete" },
  { level: "debug", process: "Preferences", sub: "com.apple.UIKit:Accessibility", msg: "AX tree published · 21 elements" },
];
const LOG_AT = (i: number) => cue.console + 0.25 + i * 0.22;
const stamp = (t: number) => {
  const ms = Math.round((t - cue.console) * 1000) + 41_120;
  const s = Math.floor(ms / 1000);
  return `09:41:${String(s % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}${String((ms * 7) % 1000).padStart(3, "0")}`;
};

/** How far the console's accessibility pass has come (it drives the device's overlay too). */
export const consoleAx = (t: number) => ease(t, cue.axTab + 0.15, 0.9, curve.fluid) * (1 - ease(t, cue.stageOut - 0.25, 0.25));
/** Which element the tree has selected, as the pass walks it. */
export const consoleHot = (t: number) =>
  t < cue.axTab + 1.2 ? -1 : Math.min(axNodes.length - 1, Math.floor((t - cue.axTab - 1.2) / 0.16) + 2);

const ROLE_ICON: Record<string, typeof Type> = { StaticText: Type, Button: MousePointerClick, Heading: Type };

/** Act IV: the console drawer (⌘J), its live log, then the real accessibility tree. */
export function Console({ t }: { t: number }) {
  const inP = clamp(spring(t, cue.console, 0.55, 0.06));
  const outP = ease(t, cue.stageOut + 0.02, 0.3, curve.in);
  if (t < cue.console || outP >= 1) return null;
  const tab = t >= cue.axTab ? "accessibility" : "logs";
  const tabFade = Math.exp(-Math.max(0, t - cue.axTab) * 10) * (t >= cue.axTab ? 1 : 0);
  return (
    <div
      className="glass absolute z-30 flex flex-col overflow-hidden rounded-[22px]"
      style={{
        left: MAIN.left,
        width: MAIN.right - MAIN.left,
        height: CONSOLE_H,
        bottom: GAP,
        transform: `translateY(${(1 - inP) * (CONSOLE_H + 30) + outP * (CONSOLE_H + 40)}px)`,
        opacity: mix(0.4, 1, clamp(inP)) * (1 - outP),
      }}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b-[0.5px] border-separator px-2.5">
        <Segmented
          size="sm"
          intrinsic
          aria-label="Console view"
          value={tab}
          onChange={() => {}}
          items={[
            { value: "logs", label: "Logs", icon: <ScrollText /> },
            { value: "input", label: "Input", icon: <MousePointer2 /> },
            { value: "accessibility", label: "Accessibility", icon: <Accessibility /> },
            { value: "web", label: "Web Inspector", icon: <Globe /> },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          {tab === "logs" ? (
            <>
              <span className="mr-1 flex items-center gap-1.5 text-caption font-medium text-label-2">
                <StatusDot tone="green" live /> Live
              </span>
              <IconButton size="md" label="Pause">
                <Pause />
              </IconButton>
              <IconButton size="md" label="Clear">
                <Trash2 />
              </IconButton>
            </>
          ) : (
            <span className="mr-1 flex items-center gap-1.5 text-caption font-medium text-label-2">
              <StatusDot tone="green" /> AX overlay on
            </span>
          )}
          <span aria-hidden className="mx-1 h-4 w-px bg-separator" />
          <IconButton size="md" label="Close console">
            <X />
          </IconButton>
        </div>
      </header>
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ filter: tabFade > 0.02 ? `blur(${tabFade * 6}px)` : undefined, opacity: 1 - tabFade * 0.6 }}
      >
        {tab === "logs" ? <Logs t={t} /> : <Tree t={t} />}
      </div>
    </div>
  );
}

function Logs({ t }: { t: number }) {
  const shown = LOGS.map((l, i) => ({ ...l, at: LOG_AT(i) })).filter((l) => t >= l.at);
  const ROW = 34;
  const view = CONSOLE_H - 44 - 12;
  // The list follows its tail, springing up a row at a time.
  const grown = shown.reduce((a, l) => a + ROW * clamp(spring(t, l.at, 0.3)), 0);
  const scroll = Math.max(0, grown - view);
  return (
    <div className="scroll-fade absolute inset-0 overflow-hidden px-1.5 pt-1.5">
      {shown.map((l, i) => {
        const p = clamp(spring(t, l.at, 0.3));
        return (
          <div
            key={i}
            className={`absolute right-1.5 left-1.5 grid min-h-7 grid-cols-[118px_52px_150px_1fr] items-start gap-2 rounded-[7px] px-1.5 py-1 text-footnote ${l.level === "error" ? "bg-red/5" : ""}`}
            style={{ top: 6 + i * ROW - scroll + mix(8, 0, p), opacity: p }}
          >
            <span className="pt-px font-mono text-caption text-label-3 tabular">{stamp(l.at)}</span>
            <span className="pt-px">
              {l.level === "default" ? (
                <span className="text-label-3">—</span>
              ) : (
                <span className={`text-caption tracking-[0.02em] uppercase ${l.level === "info" ? "text-label-2" : "text-label-3"}`}>
                  {l.level}
                </span>
              )}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-label">{l.process}</span>
              <span className="truncate text-caption text-label-3">{l.sub}</span>
            </span>
            <span className="min-w-0 truncate font-mono text-[11.5px]/[17px] text-label">{l.msg}</span>
          </div>
        );
      })}
    </div>
  );
}

function Tree({ t }: { t: number }) {
  const hot = consoleHot(t);
  const ROW = 28;
  const view = CONSOLE_H - 44 - 16;
  const scroll = Math.max(0, Math.min(axNodes.length * ROW - view + 8, (Math.max(hot, 0) - 4) * ROW));
  const p = consoleAx(t);
  const sel = axNodes[Math.max(0, hot)]!;
  return (
    <div className="absolute inset-0 flex">
      <div className="scroll-fade relative min-w-0 flex-1 overflow-hidden px-1.5 py-2">
        <div style={{ transform: `translateY(${-scroll}px)` }}>
          <div className="flex h-7 items-center gap-1.5 pr-2 pl-1.5 text-footnote font-medium text-label">
            <Accessibility className="size-[13px] text-label-2" strokeWidth={2} /> Settings
            <span className="ml-auto font-mono text-caption text-label-3">Application</span>
          </div>
          {axNodes.map((n, i) => {
            const Icon = ROLE_ICON[n.type] ?? MousePointer2;
            const seen = clamp(p * 1.7 - i * 0.045) > 0;
            const on = i === hot;
            return (
              <div
                key={i}
                className={`flex h-7 items-center gap-1.5 rounded-[7px] pr-2 text-footnote ${on ? "bg-ink text-on-ink" : "text-label"}`}
                style={{ paddingLeft: 22, opacity: seen ? 1 : 0.35, height: ROW }}
              >
                <Icon className={`size-[13px] shrink-0 ${on ? "text-on-ink" : "text-label-2"}`} strokeWidth={2} />
                <span className="min-w-0 truncate font-medium">{n.label || "Unlabeled"}</span>
                <span className={`ml-auto shrink-0 font-mono text-caption ${on ? "text-on-ink/60" : "text-label-3"}`}>{n.type}</span>
              </div>
            );
          })}
        </div>
      </div>
      <aside className="flex w-[240px] shrink-0 flex-col gap-3 border-l-[0.5px] border-separator p-3">
        <div className="group-box">
          {[
            ["Label", sel.label || "—"],
            ["Role", sel.type],
            ["Frame", sel.frame.map((v) => Math.round(v)).join(", ")],
          ].map(([k, v]) => (
            <div key={k} className="row flex min-h-9 items-center gap-3 px-3 py-2">
              <span className="text-body text-label">{k}</span>
              <span className="ml-auto truncate font-mono text-footnote text-label-2">{v}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

export const CONSOLE_LOG_TIMES = LOGS.map((_, i) => LOG_AT(i));
