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

export const AxTarget = memo(function AxTarget({
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
      className="absolute box-border min-w-px min-h-px p-0 border cursor-pointer pointer-events-auto"
      style={{
        left: `${(visibleFrame.x / screen.width) * 100}%`,
        top: `${(visibleFrame.y / screen.height) * 100}%`,
        width: `${(visibleFrame.width / screen.width) * 100}%`,
        height: `${(visibleFrame.height / screen.height) * 100}%`,
        borderColor: selected
          ? "var(--color-accent-solid)"
          : highlighted
          ? "var(--color-warning)"
          : "var(--color-success)",
        background: selected
          ? "color-mix(in srgb, var(--color-accent-solid) 24%, transparent)"
          : highlighted
          ? "color-mix(in srgb, var(--color-warning) 28%, transparent)"
          : "color-mix(in srgb, var(--color-success) 12%, transparent)",
      }}
    />
  );
}, (prev, next) =>
  prev.index === next.index &&
  prev.highlighted === next.highlighted &&
  prev.selected === next.selected &&
  prev.onHighlight === next.onHighlight &&
  prev.onSelect === next.onSelect &&
  prev.screen.width === next.screen.width &&
  prev.screen.height === next.screen.height &&
  axElementsEqual(prev.element, next.element));
