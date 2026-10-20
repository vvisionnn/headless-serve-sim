import type { CSSProperties } from "react";
import { clamp, curve, ease, mix, spring } from "../lib/time";

/**
 * Words arrive as a material does: each one resolves out of a blur while it
 * rises a few points, one after another, with a breath of overshoot. They
 * leave together, lifting away.
 */
export function Words({
  text,
  t,
  at,
  out = Infinity,
  stagger = 0.07,
  className,
  style,
}: {
  text: string;
  t: number;
  at: number;
  out?: number;
  stagger?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const leave = ease(t, out, 0.55, curve.in);
  if (t < at || leave >= 1) return null;
  return (
    <span className={className} style={{ ...style, display: "block" }}>
      {text.split(" ").map((word, i) => {
        const p = spring(t, at + i * stagger, 1.0, 0.12);
        const seen = clamp(p);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              whiteSpace: "pre",
              opacity: seen * (1 - leave),
              transform: `translateY(${mix(0.42, 0, p) - leave * 0.22}em)`,
              filter: `blur(${mix(14, 0, seen) + leave * 8}px)`,
            }}
          >
            {i ? ` ${word}` : word}
          </span>
        );
      })}
    </span>
  );
}

/** Text that types itself on the given key times, with a caret that holds still while typing. */
export function Typed({
  text,
  t,
  times,
  caret = true,
  className,
}: {
  text: string;
  t: number;
  times: number[];
  caret?: boolean;
  className?: string;
}) {
  if (t < times[0]! - 0.3) return null;
  const n = times.filter((k) => k <= t).length;
  const done = n >= text.length;
  const blink = done ? Math.floor((t - times.at(-1)!) * 1.9) % 2 === 0 : true;
  return (
    <span className={className}>
      {text.slice(0, n)}
      {caret && (
        <span
          className="ml-[1px] inline-block h-[1.05em] w-[0.55em] translate-y-[0.18em] bg-current"
          style={{ opacity: blink ? 0.85 : 0 }}
        />
      )}
    </span>
  );
}
