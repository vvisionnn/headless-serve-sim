import { type ReactNode } from "react";
import { Chevron } from "../icons";

// Shared collapsible section for the inspector tools. Built on native
// <details>/<summary> so the open/close height transition is CSS-only (see
// `details.lem-section` in global.css) rather than a JS height animation.
//
// Canonical section anatomy (shared by every inspector tool):
//   • block   — flat on the card's white body; the inspector draws the rule
//               that separates one section from the next
//   • header  — a leading disclosure chevron, then a wide-tracked UPPERCASE
//               title, then any right-aligned status; uppercase is the
//               unambiguous "this is a section, not data" signal
//   • body    — no rule under the title; content values are the darkest text
//               rank (text-fg), captions the lightest (text-fg-3)
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
      className={`lem-section border-t border-divider bg-panel overflow-hidden ${className}`}
      {...dataProps}
    >
      <summary
        className={`lem-toggle flex items-center gap-2.5 cursor-pointer select-none px-5 min-h-[56px] text-body font-semibold text-fg [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent-solid)] ${summaryClassName}`}
      >
        <Chevron open={open} />
        <span className="mr-auto min-w-0 truncate">{summary}</span>
      </summary>
      <div className={`flex flex-col gap-3 px-5 pb-4 pt-1 ${bodyClassName}`}>{children}</div>
    </details>
  );
}
