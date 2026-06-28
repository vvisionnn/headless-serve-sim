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
      className="fixed top-0 right-0 bottom-0 z-35 min-w-0 overflow-hidden border-l border-divider bg-panel text-fg shadow-[0_0_40px_rgba(0,0,0,0.5)] [font-family:-apple-system,system-ui,sans-serif] [transition:transform_0.28s_cubic-bezier(0.4,0,0.6,1),opacity_0.2s_ease] flex flex-col"
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

export function PanelHeader({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return <header className="flex shrink-0 items-center justify-between gap-2.5 border-b border-divider px-2.5 py-1.5 pl-3" style={style}>{children}</header>;
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium text-fg-2">{children}</span>;
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
      className="flex shrink-0 cursor-pointer items-center justify-center bg-transparent p-2 min-h-[36px] min-w-[36px] text-fg-2 hover:bg-hover hover:text-fg [transition:background_0.15s,color_0.15s] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent)]"
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
