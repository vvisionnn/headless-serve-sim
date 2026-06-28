import { memo } from "react";
import type { AxElement } from "../../ax-shared";
import {
  useAxSelectionContext,
  useAxSnapshotContext,
} from "../hooks/use-ax-snapshot";
import {
  axElementKey,
  axElementsEqual,
  axNodeForElement,
  isAxeUnavailable,
} from "../utils/ax";

const SECTION = "bg-panel border border-divider";
const SECTION_TITLE = "text-[11px] font-semibold text-fg-3 uppercase tracking-[0.08em] m-0";
const EMPTY_BLOCK = "bg-panel-deep border border-divider p-2 text-fg-3 text-[12px] text-center";

export function AxTreeTool({
  overlayEnabled,
  onToggleOverlay,
}: {
  overlayEnabled: boolean;
  onToggleOverlay: () => void;
}) {
  const { snapshot } = useAxSnapshotContext();
  const { highlightedKey, setHighlightedKey } = useAxSelectionContext();
  const elements = snapshot?.elements ?? [];
  const axeUnavailable = isAxeUnavailable(snapshot);
  const error = snapshot?.errors?.[0] ?? null;
  return (
    <div className={`${SECTION} px-2 py-1.5`}>
      <div className="flex items-center justify-between gap-2">
        <span className={SECTION_TITLE}>AX Tree</span>
        <button
          type="button"
          onClick={onToggleOverlay}
          aria-pressed={overlayEnabled}
          className="border border-divider bg-transparent text-fg-2 cursor-pointer text-[10px] px-[7px] py-[3px] hover:bg-hover"
        >
          {overlayEnabled ? "Overlay on" : "Enable overlay"}
        </button>
      </div>
      {!overlayEnabled ? (
        null
      ) : axeUnavailable ? (
        <div className={EMPTY_BLOCK}>
          AX unavailable on this simulator.
        </div>
      ) : elements.length === 0 ? (
        <div className={EMPTY_BLOCK}>
          {error ?? "Waiting for accessibility data…"}
        </div>
      ) : (
        <div
          className="flex flex-col mt-1.5 max-h-[260px] overflow-y-auto [scrollbar-width:thin]"
          role="list"
        >
          {elements.map((element, index) => {
            const key = axElementKey(element);
            return (
              <AxTreeItem
                key={key}
                element={element}
                index={index}
                active={key === highlightedKey}
                onHighlight={setHighlightedKey}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

const AxTreeItem = memo(function AxTreeItem({
  element,
  index,
  active,
  onHighlight,
}: {
  element: AxElement;
  index: number;
  active: boolean;
  onHighlight: (key: string | null) => void;
}) {
  const key = axElementKey(element);
  const axNode = axNodeForElement(element, index);
  const size = `${Math.round(element.frame.width)}x${Math.round(element.frame.height)}`;
  const itemTitle = [
    axNode.label,
    axNode.role || axNode.type || "element",
    size,
  ].filter(Boolean).join(" · ");

  return (
    <div
      role="listitem"
      tabIndex={0}
      data-ax-key={key}
      title={itemTitle}
      onMouseEnter={() => onHighlight(key)}
      onMouseLeave={() => onHighlight(null)}
      onFocus={() => onHighlight(key)}
      onBlur={() => onHighlight(null)}
      className={`flex items-center justify-between gap-2 py-1 px-0.5 min-w-0 border-b border-divider hover:bg-hover ${active ? "bg-accent-tint" : ""}`}
    >
      <span className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-fg text-[12px] font-medium">{element.label || element.role || "Unlabeled"}</span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-fg-3 font-mono text-[10px]">{element.role || element.type || "element"}</span>
      </span>
      <code className="shrink-0 bg-surface-2 border border-divider text-fg-2 font-mono text-[10px] px-1.5 py-[3px]">{size}</code>
    </div>
  );
}, (prev, next) =>
  prev.index === next.index &&
  prev.active === next.active &&
  prev.onHighlight === next.onHighlight &&
  axElementsEqual(prev.element, next.element));
