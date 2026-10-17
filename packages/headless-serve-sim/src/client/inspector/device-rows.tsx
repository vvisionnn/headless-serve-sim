import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { ValueChip } from "../ui/field";
import { Slider } from "../ui/slider";

// Small layout pieces the Device tab's tools share, so every tool lays out a
// slider row, a field or a caption the same way.

/** A row whose control is a full-width slider, live value on the label line. */
export function SliderRow({
  label,
  value,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="row flex flex-col gap-2 px-3 pt-2.5 pb-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body font-medium text-label">{label}</span>
        <ValueChip>{value}</ValueChip>
      </div>
      {children}
    </div>
  );
}

/** A label and its control on one line, inside a disclosure. */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <span className="min-w-0 truncate text-body font-medium text-label">{label}</span>
      {children}
    </div>
  );
}

export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("m-0 text-caption break-words text-label-3", className)}>{children}</p>;
}

/** An error line with an optional recovery action. Red is a status mark. */
export function ErrorNote({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 px-2.5">
      <span className="min-w-0 text-footnote break-words text-red">{message}</span>
      {action}
    </div>
  );
}

/**
 * The design Slider, plus what a live setting needs: a disabled state while the
 * real value loads, and a commit when the gesture ends (pointer up, key up,
 * blur) so a drag sends one request instead of one per frame.
 */
export function LiveSlider({
  disabled,
  onCommit,
  ...props
}: ComponentProps<typeof Slider> & { disabled?: boolean; onCommit?: () => void }) {
  return (
    <div
      inert={disabled}
      aria-disabled={disabled || undefined}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
      onBlur={onCommit}
      className={cn("transition-opacity duration-200", disabled && "opacity-40")}
    >
      <Slider {...props} />
    </div>
  );
}

/**
 * Holds a control inert while its value is unknown. The Select primitive has
 * no disabled state, and dimming it would dim its chevron, so callers grey
 * the trigger text instead.
 */
export function Hold({ when, children }: { when: boolean; children: ReactNode }) {
  return (
    <div inert={when} aria-disabled={when || undefined} className="flex min-w-0">
      {children}
    </div>
  );
}
