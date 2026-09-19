import type { CSSProperties, ReactNode } from "react";

// Shared Activity / Inspector rail. The clip width is the only layout change;
// the body is always painted at the expanded width and revealed (panel-slide +
// card-resize) so expand never reflows the tools mid-animation.
export function RailCard({
  open,
  collapsedWidth,
  expandedWidth,
  height,
  label,
  from,
  header,
  children,
}: {
  open: boolean;
  collapsedWidth: number;
  expandedWidth: number;
  height: number;
  label: string;
  from: "left" | "right";
  header: ReactNode;
  children: ReactNode;
}) {
  const edge: CSSProperties = from === "right" ? { right: 0 } : { left: 0 };
  return (
    <aside
      className="ds-rail t-resize relative shrink-0 overflow-hidden rounded-panel bg-panel shadow-panel font-system"
      data-open={open ? "true" : "false"}
      aria-label={label}
      style={{
        width: open ? expandedWidth : collapsedWidth,
        height,
      }}
    >
      <div
        className="absolute top-0 flex flex-col"
        style={{ width: expandedWidth, height, ...edge }}
      >
        {header}
        <div
          className={`ds-rail-body ds-rail-from-${from} flex flex-1 min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-inset [&>*]:shrink-0`}
          aria-hidden={!open}
        >
          {children}
        </div>
      </div>
    </aside>
  );
}
