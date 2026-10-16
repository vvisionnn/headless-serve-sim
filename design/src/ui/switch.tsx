import { motion } from "motion/react";
import { useState } from "react";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";

/**
 * Capsule switch (after ReactBits SquishSwitch). The knob stretches toward its
 * travel the moment it is pressed — feedback on pointer-down — then springs
 * across on release. On is ink, never a hue.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const W = 38;
  const H = 22;
  const K = 18;
  const stretch = pressed ? 6 : 0;
  const left = checked ? W - K - 2 - stretch : 2;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative shrink-0 rounded-full transition-colors duration-300 ease-[var(--ease-fluid)] disabled:opacity-40",
        checked ? "bg-ink" : "bg-fill",
      )}
      style={{ width: W, height: H }}
    >
      <motion.span
        aria-hidden
        className={cn(
          "absolute top-[2px] rounded-full shadow-[0_0_0_0.5px_rgba(0,0,0,0.04),0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)] transition-colors duration-300",
          checked ? "bg-on-ink" : "bg-white",
        )}
        initial={false}
        animate={{ left, width: K + stretch }}
        transition={spring.ui}
        style={{ height: K }}
      />
    </button>
  );
}
