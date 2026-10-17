import { Tooltip as T } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { Shortcut } from "./kbd";

/** Tooltip with an optional shortcut, after a short intent delay. */
export function Tip({
  label,
  keys,
  side = "bottom",
  children,
}: {
  label: ReactNode;
  keys?: string[];
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  return (
    <T.Root>
      <T.Trigger render={children} delay={450} />
      <T.Portal>
        <T.Positioner side={side} sideOffset={8} className="z-[90]">
          <T.Popup className="glass-pop menu-pop flex origin-[var(--transform-origin)] items-center gap-2 rounded-[8px] px-2 py-1 text-footnote font-medium text-label">
            {label}
            {keys && <Shortcut keys={keys} />}
          </T.Popup>
        </T.Positioner>
      </T.Portal>
    </T.Root>
  );
}

export const TipProvider = T.Provider;
