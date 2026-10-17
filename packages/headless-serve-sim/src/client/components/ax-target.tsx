import { memo } from "react";
import type { AxElement } from "../../ax-shared";
import {
  axElementKey,
  axElementSummary,
  axElementsEqual,
  axFrameString,
  axNodeForElement,
  clampAxFrameForScreen,
} from "../utils/ax";

export interface AxTargetProps {
  element: AxElement;
  index: number;
  screen: { width: number; height: number };
  highlighted: boolean;
  selected: boolean;
  onHighlight: (key: string | null) => void;
  onSelect: (key: string | null) => void;
}

export const AxTarget = memo(
  function AxTarget({
    element,
    index,
    screen,
    highlighted,
    selected,
    onHighlight,
    onSelect,
  }: AxTargetProps) {
    const key = axElementKey(element);
    const axNode = axNodeForElement(element, index);
    const visibleFrame = clampAxFrameForScreen(element.frame, screen);
    if (!visibleFrame) return null;

    const summary = axElementSummary(axNode);
    return (
      <button
        type="button"
        data-ax-key={key}
        data-ax-id={axNode.id}
        data-ax-path={axNode.path}
        data-ax-label={axNode.label}
        data-ax-value={axNode.value}
        data-ax-role={axNode.role}
        data-ax-type={axNode.type}
        data-ax-enabled={String(axNode.enabled)}
        data-ax-frame={axFrameString(axNode.frame)}
        data-ax-selected={String(selected)}
        aria-label={element.label || summary}
        title={summary}
        onClick={() => onSelect(key)}
        onMouseEnter={() => onHighlight(key)}
        onMouseLeave={() => onHighlight(null)}
        className="pointer-events-auto absolute box-border min-h-px min-w-px cursor-pointer rounded-[6px] p-0 transition-[background-color,border-color] duration-150"
        style={{
          left: `${(visibleFrame.x / screen.width) * 100}%`,
          top: `${(visibleFrame.y / screen.height) * 100}%`,
          width: `${(visibleFrame.width / screen.width) * 100}%`,
          height: `${(visibleFrame.height / screen.height) * 100}%`,
          border: `${selected || highlighted ? 2 : 1.25}px solid ${selected || highlighted ? "var(--orange)" : "var(--blue)"}`,
          background:
            selected || highlighted
              ? "color-mix(in srgb, var(--orange) 18%, transparent)"
              : "color-mix(in srgb, var(--blue) 8%, transparent)",
        }}
      />
    );
  },
  (prev, next) =>
    prev.index === next.index &&
    prev.highlighted === next.highlighted &&
    prev.selected === next.selected &&
    prev.onHighlight === next.onHighlight &&
    prev.onSelect === next.onSelect &&
    prev.screen.width === next.screen.width &&
    prev.screen.height === next.screen.height &&
    axElementsEqual(prev.element, next.element),
);
