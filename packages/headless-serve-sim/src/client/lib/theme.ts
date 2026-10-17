import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

export type ThemePref = "auto" | "light" | "dark";

const KEY = "headless-serve-sim:theme";

export function readThemePref(storage: Pick<Storage, "getItem"> | null): ThemePref {
  const v = storage?.getItem(KEY);
  return v === "light" || v === "dark" ? v : "auto";
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  return pref === "auto" ? (systemDark ? "dark" : "light") : pref;
}

/**
 * Inline, render-blocking script for the page <head>: applies the stored
 * theme before first paint so a dark-mode reload never flashes light.
 */
export const THEME_BOOT_SCRIPT = `try{var p=localStorage.getItem(${JSON.stringify(KEY)});var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}`;

/** Theme preference (Auto / Light / Dark), persisted and applied to <html>. */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(() =>
    readThemePref(globalThis.localStorage ?? null),
  );
  const [systemDark, setSystemDark] = useState(
    () => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const resolved = resolveTheme(pref, systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPref = useCallback(
    (next: ThemePref, origin?: { x: number; y: number }) => {
      try {
        localStorage.setItem(KEY, next);
      } catch {}
      const nextResolved = resolveTheme(next, systemDark);
      const doc = document as Document & {
        startViewTransition?: (update: () => void) => { ready: Promise<void> };
      };
      if (
        nextResolved === document.documentElement.dataset.theme ||
        !doc.startViewTransition ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setPrefState(next);
        return;
      }
      // The new theme sweeps outward from where it was chosen.
      const x = origin?.x ?? innerWidth / 2;
      const y = origin?.y ?? innerHeight / 2;
      const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      const transition = doc.startViewTransition(() =>
        flushSync(() => {
          setPrefState(next);
          document.documentElement.dataset.theme = nextResolved;
        }),
      );
      void transition.ready.then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          {
            duration: 650,
            easing: "cubic-bezier(0.32, 0.72, 0, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      });
    },
    [systemDark],
  );

  return { pref, resolved, setPref };
}
