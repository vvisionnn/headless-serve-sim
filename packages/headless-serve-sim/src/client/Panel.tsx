import type { CSSProperties, ReactNode } from "react";

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
      className="fixed top-0 right-0 bottom-0 z-35 min-w-0 overflow-hidden border-l border-divider bg-panel text-fg shadow-[-8px_0_24px_rgba(0,0,0,0.12)] font-system [transition:transform_0.3s_cubic-bezier(0.4,0,0.6,1),opacity_0.24s_cubic-bezier(0.4,0,0.6,1)] flex flex-col"
      style={{
        width,
        transform: open ? "translateX(0)" : "translateX(100%)",
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
    <header
      className="flex shrink-0 items-center justify-between gap-2.5 border-b border-divider px-4 py-3"
      style={style}
    >
      {children}
    </header>
  );
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-fg">
      {children}
    </span>
  );
}

export function PanelCloseButton({
  onClick,
  ariaLabel = "Close panel",
  title,
  iconSize = 16,
}: {
  onClick: () => void;
  ariaLabel?: string;
  title?: string;
  iconSize?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-fg-2 hover:bg-hover hover:text-fg [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
      aria-label={ariaLabel}
      title={title}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
