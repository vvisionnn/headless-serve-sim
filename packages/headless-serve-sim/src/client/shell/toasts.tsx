import { animate, AnimatePresence, motion, useMotionValue, type MotionValue } from "motion/react";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { cn } from "../lib/cn";
import { project, spring } from "../lib/motion";
import { TOAST_BOTTOM, toastBottom } from "../utils/toast-placement";

export interface ToastItem {
  id: string | number;
  title: string;
  detail?: string;
  tone?: "neutral" | "success" | "danger";
  progress?: number | "indeterminate";
}

const STACK_W = 320;

/**
 * How far up the stack sits to stay clear of the device dock. The dock moves
 * with the device (fits, turns, the console opening), so while any toast is
 * up it's measured each frame and the stack springs to follow. The first
 * toast lands in place: the empty stack jumps there before it paints.
 */
function useDockClearance(active: boolean, right: number): MotionValue<number> {
  const bottom = useMotionValue(TOAST_BOTTOM);
  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    let target: number | null = null;
    let anim: { stop: () => void } | null = null;
    const measure = () => {
      const dock = document.querySelector("[data-device-dock]")?.getBoundingClientRect() ?? null;
      const next = toastBottom({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        right,
        width: STACK_W,
        dock,
      });
      if (target === null) bottom.jump(next);
      else if (next !== target) {
        anim?.stop();
        anim = animate(bottom, next, spring.surface);
      }
      target = next;
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => {
      cancelAnimationFrame(frame);
      anim?.stop();
    };
  }, [active, right, bottom]);
  return bottom;
}

/**
 * Toasts (after ReactBits SwipeToast): a stack that fans out on hover. Flick
 * one right to dismiss — the release velocity is projected forward, so a short
 * fast throw goes as far as a long slow drag.
 */
export function Toasts({
  items,
  right,
  onDismiss,
}: {
  items: ToastItem[];
  /** Distance from the window's right edge — clears an open inspector. */
  right: number;
  onDismiss: (id: string | number) => void;
}) {
  const [hover, setHover] = useState(false);
  const list = [...items].reverse();
  const bottom = useDockClearance(items.length > 0, right);
  return (
    <motion.div
      className="fixed z-[60] w-[320px]"
      initial={false}
      animate={{ right }}
      transition={spring.surface}
      style={{ bottom }}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
    >
      <AnimatePresence>
        {list.map((t, i) => (
          <motion.div
            key={t.id}
            layout
            role={t.tone === "danger" ? "alert" : "status"}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.08, right: 1 }}
            onDragEnd={(_, info) => {
              if (info.offset.x + project(info.velocity.x) > 140) onDismiss(t.id);
            }}
            className={cn(
              "glass-pop absolute right-0 bottom-0 left-0 flex cursor-grab items-center gap-3 rounded-[16px] px-3.5 py-3 active:cursor-grabbing",
              t.tone === "danger" && "select-text",
            )}
            style={{ zIndex: 100 - i, transformOrigin: "50% 100%" }}
            initial={{ opacity: 0, y: 24, scale: 0.94, filter: "blur(6px)" }}
            animate={{
              opacity: i > 2 ? 0 : 1,
              y: hover ? -i * 70 : -i * 9,
              scale: hover ? 1 : 1 - i * 0.045,
              filter: "blur(0px)",
            }}
            exit={{ opacity: 0, x: 120, transition: spring.ui }}
            transition={spring.ui}
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full",
                t.tone === "danger"
                  ? "bg-red/12 text-red"
                  : t.tone === "success"
                    ? "bg-green/12 text-green"
                    : "bg-fill-2 text-label-2",
              )}
            >
              {t.tone === "danger" ? (
                <CircleAlert className="size-4" />
              ) : t.tone === "success" ? (
                <CircleCheck className="size-4" />
              ) : (
                <LoaderCircle className="size-4 animate-spin" />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-semibold text-label">{t.title}</span>
              {t.detail && (
                <span className="truncate font-mono text-caption text-label-3">{t.detail}</span>
              )}
              {t.progress != null && (
                <span className="relative mt-1.5 h-[3px] overflow-hidden rounded-full bg-fill">
                  {t.progress === "indeterminate" ? (
                    <span className="absolute inset-y-0 left-0 w-[40%] animate-[indeterminate_1.2s_var(--ease-fluid)_infinite] rounded-full bg-ink" />
                  ) : (
                    <motion.span
                      className="block h-full rounded-full bg-ink"
                      animate={{ width: `${t.progress * 100}%` }}
                      transition={spring.ui}
                    />
                  )}
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
