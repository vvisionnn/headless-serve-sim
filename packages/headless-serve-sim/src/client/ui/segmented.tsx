import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";

export interface SegmentItem<T extends string> {
  value: T;
  label?: ReactNode;
  icon?: ReactNode;
  title?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  items: SegmentItem<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  /** Size segments to their labels instead of sharing the width equally. */
  intrinsic?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Segmented control (after ReactBits RubberSegment). The thumb is a physical
 * object: it squashes while held, and you can scrub it across the segments —
 * the selection follows the finger, then the thumb springs home on release.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  size = "md",
  intrinsic,
  className,
  ...aria
}: Props<T>) {
  const track = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const x = useMotionValue(0);
  const w = useMotionValue(0);
  const [pressed, setPressed] = useState(false);
  const [ready, setReady] = useState(false);
  const reduce = useReducedMotion();
  const index = Math.max(
    0,
    items.findIndex((i) => i.value === value),
  );

  useLayoutEffect(() => {
    const place = (instant: boolean) => {
      const el = refs.current[index];
      if (!el) return;
      if (instant || reduce) {
        x.jump(el.offsetLeft);
        w.jump(el.offsetWidth);
      } else {
        animate(x, el.offsetLeft, spring.ui);
        animate(w, el.offsetWidth, spring.ui);
      }
    };
    place(!ready);
    if (!ready) setReady(true);
    const ro = new ResizeObserver(() => place(true));
    if (track.current) ro.observe(track.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length]);

  const pick = (clientX: number) => {
    const hit = refs.current.findIndex((el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right;
    });
    const item = items[hit];
    if (item && !item.disabled && item.value !== value) onChange(item.value);
  };

  const h = size === "sm" ? "h-6" : "h-7";
  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={aria["aria-label"]}
      className={cn(
        "relative flex select-none rounded-[9px] bg-fill-2 p-[2px] touch-none",
        className,
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setPressed(true);
        pick(e.clientX);
      }}
      onPointerMove={(e) => pressed && pick(e.clientX)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
    >
      <motion.div
        aria-hidden
        className="absolute top-[2px] bottom-[2px] left-0 rounded-[7px] bg-control shadow-[0_0_0_0.5px_rgba(0,0,0,0.04),0_2px_6px_-1px_rgba(0,0,0,0.14),0_1px_1px_rgba(0,0,0,0.04)] dark:bg-[#636366] dark:shadow-[inset_0_0.5px_0_rgba(255,255,255,0.12),0_2px_6px_rgba(0,0,0,0.3)]"
        style={{ x, width: w, opacity: ready ? 1 : 0 }}
        animate={{ scaleY: pressed ? 0.9 : 1, scaleX: pressed ? 0.96 : 1 }}
        transition={spring.snappy}
      />
      {items.map((item, i) => {
        const selected = i === index;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            title={item.title}
            disabled={item.disabled}
            onKeyDown={(e) => {
              const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!dir) return;
              e.preventDefault();
              const next = items[(i + dir + items.length) % items.length];
              if (next && !next.disabled) {
                onChange(next.value);
                refs.current[(i + dir + items.length) % items.length]?.focus();
              }
            }}
            className={cn(
              "relative z-[1] flex items-center justify-center gap-1.5 rounded-[7px] px-2.5 text-body transition-[color,font-weight] duration-200 disabled:opacity-35 [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:stroke-[1.75]",
              h,
              intrinsic ? "flex-none" : "min-w-0 flex-1",
              size === "sm" && "text-footnote",
              selected ? "font-semibold text-label" : "font-medium text-label-2 hover:text-label",
            )}
          >
            {item.icon}
            {item.label != null && <span className="truncate">{item.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
