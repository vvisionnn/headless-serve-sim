import { motion, AnimatePresence } from "motion/react";
import { AppWindow, ChevronRight, Hand, LayoutList, MousePointerClick, PanelTop, Rows3, Search, Type, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn";
import { axTree, type AxNode } from "../lib/mock";
import { spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { InfoRow, Row } from "../ui/group";
import { Switch } from "../ui/switch";

const glyphs: Record<string, LucideIcon> = {
  Application: AppWindow,
  NavigationBar: PanelTop,
  StaticText: Type,
  Button: MousePointerClick,
  SearchField: Search,
  CollectionView: LayoutList,
  Cell: Rows3,
  TabBar: Hand,
};

function find(n: AxNode, id: string): AxNode | undefined {
  if (n.id === id) return n;
  for (const c of n.children ?? []) {
    const hit = find(c, id);
    if (hit) return hit;
  }
}

const traits: Record<string, string> = {
  Button: "button",
  StaticText: "staticText, header",
  SearchField: "searchField",
  Cell: "button, allowsDirectInteraction",
  TabBar: "tabBar",
  NavigationBar: "header",
};

/** Tree node — ReUI Tree shape: indent guides, spring-turned chevron. */
function Node({ node, depth, selected, onSelect }: { node: AxNode; depth: number; selected: string; onSelect: (id: string) => void }) {
  const { set, axHover } = useApp();
  const [open, setOpen] = useState(true);
  const Icon = glyphs[node.role] ?? Rows3;
  const kids = node.children ?? [];
  const isSel = selected === node.id;
  return (
    <div className="relative">
      <div
        role="treeitem"
        aria-expanded={kids.length ? open : undefined}
        aria-selected={isSel}
        onClick={() => onSelect(node.id)}
        onPointerEnter={() => set({ axHover: node.id })}
        onPointerLeave={() => set({ axHover: null })}
        className={cn(
          "flex h-7 cursor-default items-center gap-1.5 rounded-[7px] pr-2 text-footnote transition-colors",
          isSel ? "bg-ink text-on-ink" : axHover === node.id ? "bg-fill-2" : "hover:bg-fill-3",
        )}
        style={{ paddingLeft: 6 + depth * 16 }}
      >
        <button
          type="button"
          aria-label={open ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          className={cn("flex size-4 shrink-0 items-center justify-center", !kids.length && "invisible")}
        >
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={spring.ui} className="flex">
            <ChevronRight className={cn("size-3", isSel ? "text-on-ink/70" : "text-label-3")} strokeWidth={2.5} />
          </motion.span>
        </button>
        <Icon className={cn("size-[13px] shrink-0", isSel ? "text-on-ink" : "text-label-2")} strokeWidth={2} />
        <span className="min-w-0 truncate font-medium">{node.label ?? <span className={isSel ? "text-on-ink/60" : "text-label-3"}>Unlabeled</span>}</span>
        <span className={cn("ml-auto shrink-0 font-mono text-caption", isSel ? "text-on-ink/60" : "text-label-3")}>{node.role}</span>
      </div>
      <AnimatePresence initial={false}>
        {open && kids.length > 0 && (
          <motion.div
            role="group"
            className="relative overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: spring.ui, opacity: { duration: 0.18 } }}
          >
            <span aria-hidden className="absolute top-0 bottom-1 w-px bg-separator" style={{ left: 6 + depth * 16 + 7.5 }} />
            {kids.map((c) => (
              <Node key={c.id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AccessibilityView() {
  const { axOverlay, set } = useApp();
  const [selected, setSelected] = useState("c2");
  const node = find(axTree, selected) ?? axTree;
  const [x, y, w, h] = node.frame;
  return (
    <div className="flex h-full min-h-0">
      <div role="tree" aria-label="Accessibility hierarchy" className="thin-scrollbar scroll-fade min-w-0 flex-1 overflow-y-auto px-1.5 py-2">
        <Node node={axTree} depth={0} selected={selected} onSelect={setSelected} />
      </div>
      <aside className="thin-scrollbar flex w-[260px] shrink-0 flex-col gap-3 overflow-y-auto [&>*]:shrink-0 border-l-[0.5px] border-separator p-3">
        <div className="group-box">
          <InfoRow label="Label" value={node.label ?? "—"} mono={false} />
          <InfoRow label="Role" value={node.role} />
          <InfoRow label="Frame" value={`${x}, ${y} · ${w}×${h}`} />
          <InfoRow label="Traits" value={traits[node.role] ?? "none"} />
          <InfoRow label="Identifier" value={`trails.${node.id}`} />
        </div>
        <div className="group-box">
          <Row label="Show overlay" detail="Outline elements on the device">
            <Switch checked={axOverlay} onChange={(v) => set({ axOverlay: v, appOpen: true })} label="Show overlay" />
          </Row>
        </div>
      </aside>
    </div>
  );
}
