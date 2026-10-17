import { motion } from "motion/react";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";

/**
 * Odometer digits (after ReactBits Counter): each digit is a strip that rolls
 * to its next value, so a live metric changes without flicker or reflow.
 */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("inline-flex tabular leading-none", className)} aria-label={value}>
      {value.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <span
            key={`${value.length - i}`}
            aria-hidden
            className="relative inline-block h-[1em] overflow-hidden"
            style={{ width: "0.62em" }}
          >
            <motion.span
              className="absolute inset-x-0 top-0 flex flex-col items-center"
              initial={false}
              animate={{ y: `${-Number(ch)}em` }}
              transition={spring.ui}
            >
              {Array.from({ length: 10 }, (_, d) => (
                <span key={d} className="h-[1em] leading-none">
                  {d}
                </span>
              ))}
            </motion.span>
          </span>
        ) : (
          <span key={`${value.length - i}`} aria-hidden>
            {ch === " " ? "\u00a0" : ch}
          </span>
        ),
      )}
    </span>
  );
}
