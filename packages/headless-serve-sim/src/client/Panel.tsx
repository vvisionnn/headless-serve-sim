import type { CSSProperties, ReactNode } from "react";
import { SquareIconButton } from "./components/design-system";

// The wide overlay surfaces (connection stats, logs, simulators, devtools).
// Each floats over the canvas as its own card, inset from the viewport edge so
// the dotted ground stays visible behind it.
export function Panel({
  open,
  width,
  children,
  style,
}: {
  open: boolean;
  width: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <aside
      className="fixed top-6 right-6 bottom-6 z-35 min-w-0 overflow-hidden rounded-panel bg-panel text-fg shadow-overlay font-system [transition:transform_0.3s_cubic-bezier(0.4,0,0.6,1),opacity_0.24s_cubic-bezier(0.4,0,0.6,1)] flex flex-col"
      style={{
        width,
        transform: open ? "translateX(0)" : "translateX(calc(100% + 24px))",
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
        ...style,
      }}
      aria-hidden={!open}
    >
      {children}
    </aside>
  );
}

export function PanelHeader({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-2.5 px-5 py-4" style={style}>
      {children}
    </header>
  );
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return <span className="truncate text-eyebrow uppercase text-fg">{children}</span>;
}

export function PanelCloseButton({
  onClick,
  ariaLabel = "Close panel",
  title,
  iconSize = 15,
}: {
  onClick: () => void;
  ariaLabel?: string;
  title?: string;
  iconSize?: number;
}) {
  return (
    <SquareIconButton onClick={onClick} label={ariaLabel} title={title}>
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </SquareIconButton>
  );
}
