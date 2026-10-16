import { AnimatePresence, motion } from "motion/react";
import { Camera, Command, Disc, FileImage, Monitor, Moon, Sparkles, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "./lib/cn";
import { spring } from "./lib/motion";
import { useApp, type Scene, type ThemePref } from "./lib/store";
import type { DeviceKind } from "./lib/mock";
import { Segmented } from "./ui/segmented";
import { Select } from "./ui/select";

/**
 * Design-review harness — NOT part of the product. Lets a reviewer flip theme,
 * device and scene, and fire the moments worth judging. Toggle with "\".
 */
export function Harness() {
  const app = useApp();
  const [open, setOpenState] = useState(() => localStorage.getItem("serve-sim-design-harness") !== "closed");
  const setOpen = (v: boolean) => {
    localStorage.setItem("serve-sim-design-harness", v ? "open" : "closed");
    setOpenState(v);
  };
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "\\" && !(e.target as HTMLElement).closest("input,textarea")) setHidden((h) => !h);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);

  const setTheme = (theme: ThemePref, e?: { clientX: number; clientY: number }) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return app.set({ theme });
    const x = e?.clientX ?? innerWidth / 2;
    const y = e?.clientY ?? innerHeight / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const t = doc.startViewTransition(() => flushSync(() => app.set({ theme })));
    void t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 650, easing: "cubic-bezier(0.32, 0.72, 0, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  };

  const drop = () => {
    app.set({ dropping: true, scene: app.scene === "wall" ? "workspace" : app.scene });
    setTimeout(() => {
      app.set({ dropping: false });
      const id = app.toast({ title: "Adding beach.heic to Photos", detail: "4.2 MB", progress: 0 });
      let p = 0;
      const t = setInterval(() => {
        p += 0.18;
        if (p >= 1) {
          clearInterval(t);
          app.updateToast(id, { title: "Added beach.heic to Photos", progress: undefined, tone: "success", detail: "Photos · Recents" });
          setTimeout(() => app.dismissToast(id), 3000);
        } else app.updateToast(id, { progress: p });
      }, 260);
    }, 1500);
  };

  if (hidden) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[95]" onPointerDown={(e) => e.stopPropagation()}>
      <AnimatePresence mode="popLayout" initial={false}>
        {open ? (
          <motion.div
            key="panel"
            className="glass-pop flex w-[300px] flex-col gap-3 rounded-[20px] p-3.5"
            style={{ transformOrigin: "0% 100%" }}
            initial={{ opacity: 0, scale: 0.9, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.9, filter: "blur(6px)" }}
            transition={spring.ui}
          >
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-[7px] bg-ink text-on-ink">
                <Sparkles className="size-3.5" strokeWidth={2.2} />
              </span>
              <div className="flex flex-1 flex-col">
                <span className="text-headline text-label">Design preview</span>
                <span className="text-caption text-label-3">Mock data · press \ to hide</span>
              </div>
              <button type="button" aria-label="Collapse" onClick={() => setOpen(false)} className="flex size-6 items-center justify-center rounded-full text-label-3 hover:bg-fill-2">
                <X className="size-3.5" strokeWidth={2.5} />
              </button>
            </div>
            <Field label="Theme">
              <div onClickCapture={(e) => ((window as unknown as { __lastClick: MouseEvent }).__lastClick = e.nativeEvent)}>
                <Segmented<ThemePref>
                  size="sm"
                  aria-label="Theme"
                  items={[
                    { value: "auto", label: "Auto", icon: <Monitor /> },
                    { value: "light", label: "Light", icon: <Sun /> },
                    { value: "dark", label: "Dark", icon: <Moon /> },
                  ]}
                  value={app.theme}
                  onChange={(v) => setTheme(v, (window as unknown as { __lastClick?: MouseEvent }).__lastClick)}
                />
              </div>
            </Field>
            <Field label="Device">
              <Segmented<DeviceKind>
                size="sm"
                aria-label="Device"
                items={[
                  { value: "iphone", label: "iPhone" },
                  { value: "ipad", label: "iPad" },
                  { value: "watch", label: "Watch" },
                ]}
                value={app.device}
                onChange={(v) => app.set({ device: v, orientation: 0, scene: app.scene === "wall" || app.scene === "empty" ? "workspace" : app.scene })}
              />
            </Field>
            <Field label="Scene">
              <Select<Scene>
                label="Scene"
                className="w-full"
                value={app.scene}
                onChange={(v) => app.set({ scene: v })}
                options={[
                  { value: "workspace", label: "Workspace", hint: "One simulator, panels around it" },
                  { value: "wall", label: "Wall", hint: "Every running simulator" },
                  { value: "empty", label: "Nothing streaming", hint: "First launch / boot state" },
                  { value: "disconnected", label: "Disconnected", hint: "Stream lost, waiting to resume" },
                  { value: "phone", label: "Phone page", hint: "What the QR link opens" },
                ]}
              />
            </Field>
            <Field label="Moments">
              <div className="grid grid-cols-2 gap-1.5">
                <Moment icon={<Camera />} label="Screenshot" onClick={app.screenshot} />
                <Moment icon={<Disc />} label={app.recording ? "Stop recording" : "Record"} onClick={app.toggleRecording} active={app.recording} />
                <Moment icon={<FileImage />} label="Drop a file" onClick={drop} />
                <Moment icon={<Command />} label="Command ⌘K" onClick={() => app.set({ paletteOpen: true })} />
              </div>
            </Field>
          </motion.div>
        ) : (
          <motion.button
            key="pill"
            type="button"
            onClick={() => setOpen(true)}
            className="glass-pop flex h-9 items-center gap-2 rounded-full pr-3.5 pl-2 text-footnote font-semibold text-label"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={spring.ui}
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-ink text-on-ink">
              <Sparkles className="size-3.5" strokeWidth={2.2} />
            </span>
            Design preview
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-0.5 text-caption font-semibold text-label-3">{label}</span>
      {children}
    </div>
  );
}

function Moment({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      transition={spring.snappy}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-footnote font-medium transition-colors [&_svg]:size-[14px] [&_svg]:stroke-[1.9]",
        active ? "bg-red text-white" : "bg-fill-3 text-label hover:bg-fill-2",
      )}
    >
      {icon}
      {label}
    </motion.button>
  );
}
