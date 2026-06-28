import { useState, type PointerEvent as ReactPointerEvent } from "react";

// Rendered as a fixed-positioned sibling of the panel, so the grabber can
// straddle the panel's left border without being clipped by overflow:hidden.
// The panel's own 1px border serves as the "line" — we just brighten it and
// add a centered pill on hover/drag.
export function ResizeHandle({
  panelWidth,
  visible,
  onPointerDown,
  ariaLabel,
}: {
  panelWidth: number;
  visible: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const hot = hover || active;
  // Panel sits at right:12 with the given width — its left border is at
  // right:(12 + panelWidth - 1). Centering the 16px hit target there:
  const handleRight = 12 + panelWidth - 9;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-hidden={!visible}
      onPointerDown={(e) => {
        setActive(true);
        onPointerDown(e);
      }}
      onPointerUp={() => setActive(false)}
      onPointerCancel={() => setActive(false)}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      className={`fixed top-3 bottom-3 w-4 z-36 cursor-col-resize touch-none transition-opacity duration-[240ms] ease-[cubic-bezier(0.4,0,0.6,1)] ${visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      style={{ right: handleRight }}
    >
      {/* Hairline that brightens the panel's existing border while the edge
          is hot — a single 1px divider rule. */}
      <div
        className={`absolute top-0 bottom-0 left-1/2 w-px bg-divider pointer-events-none transition-opacity duration-[240ms] ease-[cubic-bezier(0.4,0,0.6,1)] ${hot ? "opacity-100" : "opacity-0"}`}
        style={{ transform: "translateX(-0.5px)" }}
      />
      {/* Centered pill grabber, straddling the panel's left border. */}
      <div
        className={`absolute top-1/2 left-1/2 w-1 h-7 -translate-x-1/2 -translate-y-1/2 z-1 rounded-full pointer-events-none [transition:opacity_0.24s_cubic-bezier(0.4,0,0.6,1),background_0.3s_cubic-bezier(0.4,0,0.6,1)] ${hot ? "opacity-100" : "opacity-0"} ${active ? "bg-fg-2" : "bg-fg-3"}`}
      />
    </div>
  );
}
