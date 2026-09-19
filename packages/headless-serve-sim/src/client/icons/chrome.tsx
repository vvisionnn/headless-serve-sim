// Disclosure marker for a collapsible section. It leads the title (hence
// `order-first`) and follows the platform convention: pointing right when the
// section is closed, down when it's open.
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`t-acc-chevron lem-chevron order-first shrink-0 text-fg-3 ${open ? "is-open" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function ArrowGlyph({ dir }: { dir: "up" | "down" }) {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="mr-[3px]">
      {dir === "up" ? <polygon points="12,4 20,18 4,18" /> : <polygon points="4,6 20,6 12,20" />}
    </svg>
  );
}
