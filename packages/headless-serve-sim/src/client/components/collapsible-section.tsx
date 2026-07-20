import { type ReactNode } from "react";
import { Chevron } from "../icons";

// Shared collapsible card for the tool sections. Built on native
// <details>/<summary> so the open/close height transition is CSS-only (see
// `details.lem-section` in global.css) rather than a JS height animation.
//
// Canonical section anatomy (shared by every inspector tool):
//   • card    — white on the inspector's recessed canvas, hairline border
//   • header  — an UPPERCASE eyebrow title (text-fg-2) + right-aligned status +
//               chevron; uppercase is the unambiguous "this is a section, not
//               data" signal (data is never uppercase)
//   • body    — separated from the header by a hairline; content values are the
//               darkest tier (text-fg), captions the lightest (text-fg-3)
//
// `open`/`onOpenChange` keep React in the loop: callers own the state and stay
// synced via the `toggle` event the browser fires on user clicks.
export function CollapsibleSection({
  open,
  onOpenChange,
  summary,
  children,
  summaryClassName = "",
  bodyClassName = "",
  className = "",
  ...dataProps
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: ReactNode;
  children: ReactNode;
  summaryClassName?: string;
  bodyClassName?: string;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange((e.currentTarget as HTMLDetailsElement).open)}
      className={`lem-section bg-panel border border-divider rounded-card overflow-hidden ${className}`}
      {...dataProps}
    >
      <summary
        className={`lem-toggle flex items-center justify-between gap-2.5 cursor-pointer select-none px-3.5 min-h-[44px] text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2 [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent-solid)] ${summaryClassName}`}
      >
        {summary}
        <Chevron open={open} />
      </summary>
      <div className={`flex flex-col gap-2 border-t border-divider px-3.5 py-3 ${bodyClassName}`}>
        {children}
      </div>
    </details>
  );
}
