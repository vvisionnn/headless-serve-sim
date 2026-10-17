import { AnimatePresence, motion } from "motion/react";
import {
  AppWindow,
  ChevronRight,
  Image,
  LayoutList,
  MousePointerClick,
  PanelTop,
  Rows3,
  Search,
  SlidersHorizontal,
  TextCursorInput,
  ToggleRight,
  Type,
  type LucideIcon,
} from "lucide-react";
import { memo, useCallback, useContext, useMemo, useState } from "react";
import type { AxElement } from "../../ax-shared";
import { AxSelectionContext, useAxSnapshotContext } from "../hooks/use-ax-snapshot";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { useShell } from "../shell/shell-context";
import { InfoRow, Row } from "../ui/group";
import { Switch } from "../ui/switch";
import { axElementKey, isAxeUnavailable } from "../utils/ax";
import { buildAxTree, type AxTreeNode } from "./ax-tree";

const glyphs: Record<string, LucideIcon> = {
  Application: AppWindow,
  Window: AppWindow,
  NavigationBar: PanelTop,
  StaticText: Type,
  Button: MousePointerClick,
  Link: MousePointerClick,
  SearchField: Search,
  TextField: TextCursorInput,
  SecureTextField: TextCursorInput,
  TextView: TextCursorInput,
  CollectionView: LayoutList,
  Table: LayoutList,
  ScrollView: LayoutList,
  Cell: Rows3,
  Image: Image,
  Switch: ToggleRight,
  Slider: SlidersHorizontal,
  TabBar: PanelTop,
};

const INDENT = 16;
const PAD = 6;

interface NodeProps {
  node: AxTreeNode;
  depth: number;
  selectedKey: string | null;
  highlightedKey: string | null;
  collapsed: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onHighlight: (key: string | null) => void;
  onToggle: (key: string) => void;
}

/** Tree node — ReUI Tree shape: indent guides, spring-turned chevron. */
const Node = memo(function Node({
  node,
  depth,
  selectedKey,
  highlightedKey,
  collapsed,
  onSelect,
  onHighlight,
  onToggle,
}: NodeProps) {
  const { element, children } = node;
  const key = axElementKey(element);
  const open = !collapsed.has(key);
  const Icon = glyphs[element.type] ?? Rows3;
  const isSel = selectedKey === key;
  const role = element.role || element.type || "element";
  return (
    <div className="relative">
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={children.length ? open : undefined}
        aria-selected={isSel}
        data-ax-key={key}
        onClick={() => onSelect(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(key);
          } else if (children.length && e.key === (open ? "ArrowLeft" : "ArrowRight")) {
            e.preventDefault();
            onToggle(key);
          }
        }}
        onPointerEnter={() => onHighlight(key)}
        onPointerLeave={() => onHighlight(null)}
        onFocus={() => onHighlight(key)}
        onBlur={() => onHighlight(null)}
        className={cn(
          "flex h-7 cursor-default items-center gap-1.5 rounded-[7px] pr-2 text-footnote transition-colors outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--focus)]",
          isSel ? "bg-ink text-on-ink" : highlightedKey === key ? "bg-fill-2" : "hover:bg-fill-3",
        )}
        style={{ paddingLeft: PAD + depth * INDENT }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(key);
          }}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center",
            !children.length && "invisible",
          )}
        >
          <motion.span
            initial={false}
            animate={{ rotate: open ? 90 : 0 }}
            transition={spring.ui}
            className="flex"
          >
            <ChevronRight
              className={cn("size-3", isSel ? "text-on-ink/70" : "text-label-3")}
              strokeWidth={2.5}
            />
          </motion.span>
        </button>
        <Icon
          className={cn("size-[13px] shrink-0", isSel ? "text-on-ink" : "text-label-2")}
          strokeWidth={2}
        />
        <span className="min-w-0 truncate font-medium">
          {element.label || (
            <span className={isSel ? "text-on-ink/60" : "text-label-3"}>Unlabeled</span>
          )}
        </span>
        <span
          className={cn(
            "ml-auto shrink-0 pl-2 font-mono text-caption",
            isSel ? "text-on-ink/60" : "text-label-3",
          )}
        >
          {role}
        </span>
      </div>
      <AnimatePresence initial={false}>
        {open && children.length > 0 && (
          <motion.div
            role="group"
            className="relative overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: spring.ui, opacity: { duration: 0.18 } }}
          >
            <span
              aria-hidden
              className="absolute top-0 bottom-1 w-px bg-separator"
              style={{ left: PAD + depth * INDENT + 7.5 }}
            />
            {children.map((child) => (
              <Node
                key={axElementKey(child.element)}
                node={child}
                depth={depth + 1}
                selectedKey={selectedKey}
                highlightedKey={highlightedKey}
                collapsed={collapsed}
                onSelect={onSelect}
                onHighlight={onHighlight}
                onToggle={onToggle}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

function findElement(elements: readonly AxElement[], key: string | null): AxElement | null {
  if (!key) return null;
  return elements.find((element) => axElementKey(element) === key) ?? null;
}

function Empty({ children }: { children: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-footnote text-label-3">
      {children}
    </div>
  );
}

export function AccessibilityView() {
  const shell = useShell();
  const { snapshot } = useAxSnapshotContext();
  const selection = useContext(AxSelectionContext);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const elements = useMemo(() => snapshot?.elements ?? [], [snapshot]);
  const tree = useMemo(() => buildAxTree(elements), [elements]);
  const selected = findElement(elements, selection?.selectedKey ?? null);

  const toggle = useCallback(
    (key: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  const setSelectedKey = selection?.setSelectedKey;
  const setHighlightedKey = selection?.setHighlightedKey;
  const onSelect = useCallback((key: string) => setSelectedKey?.(key), [setSelectedKey]);
  const onHighlight = useCallback(
    (key: string | null) => setHighlightedKey?.(key),
    [setHighlightedKey],
  );

  let body;
  if (isAxeUnavailable(snapshot)) body = <Empty>AX unavailable on this simulator.</Empty>;
  else if (elements.length === 0)
    body = <Empty>{snapshot?.errors?.[0] ?? "Waiting for accessibility data…"}</Empty>;
  else
    body = (
      <div
        role="tree"
        aria-label="Accessibility hierarchy"
        className="thin-scrollbar scroll-fade h-full overflow-y-auto px-1.5 py-2"
      >
        {tree.map((node) => (
          <Node
            key={axElementKey(node.element)}
            node={node}
            depth={0}
            selectedKey={selection?.selectedKey ?? null}
            highlightedKey={selection?.highlightedKey ?? null}
            collapsed={collapsed}
            onSelect={onSelect}
            onHighlight={onHighlight}
            onToggle={toggle}
          />
        ))}
      </div>
    );

  const f = selected?.frame;
  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1">{body}</div>
      <aside className="thin-scrollbar flex w-[260px] shrink-0 flex-col gap-3 overflow-y-auto border-l-[0.5px] border-separator p-3 [&>*]:shrink-0">
        {selected && f ? (
          <div className="group-box">
            <InfoRow label="Label" value={selected.label || "—"} mono={false} />
            {selected.value && <InfoRow label="Value" value={selected.value} mono={false} />}
            <InfoRow label="Role" value={selected.role || "—"} />
            <InfoRow label="Type" value={selected.type || "—"} />
            <InfoRow
              label="Frame"
              value={`${Math.round(f.x)}, ${Math.round(f.y)} · ${Math.round(f.width)}×${Math.round(f.height)}`}
            />
            <InfoRow label="Enabled" value={selected.enabled ? "Yes" : "No"} mono={false} />
            <InfoRow label="Identifier" value={selected.id} />
          </div>
        ) : (
          <div className="group-box px-3 py-3 text-footnote text-label-3">
            Select an element to see its details.
          </div>
        )}
        <div className="group-box">
          <Row label="Show overlay" detail="Outline elements on the device">
            <Switch
              checked={shell.axOverlayEnabled}
              onChange={() => shell.toggleAxOverlay()}
              label="Show overlay"
            />
          </Row>
        </div>
      </aside>
    </div>
  );
}
