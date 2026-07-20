import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { groupTargetsByApp } from "../../devtools-targets";
import { useAppIcons } from "../hooks/use-app-icons";
import {
  postHighlightTarget,
  postReleaseHighlights,
  type WebKitDevtoolsTarget,
} from "../utils/devtools";

export function WebKitTargetPicker({
  udid,
  targets,
  selected,
  onSelectTarget,
  onRefresh,
}: {
  udid: string;
  targets: WebKitDevtoolsTarget[];
  selected: WebKitDevtoolsTarget | null;
  onSelectTarget: (id: string) => void;
  onRefresh: () => void;
}) {
  const groups = groupTargetsByApp(targets);
  const bundleIds = groups.map((g) => g.bundleId).filter((id): id is string => !!id);
  const icons = useAppIcons(udid, bundleIds);
  const [open, setOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Anchor the fixed, body-portaled menu to the trigger; keep it pinned on
  // resize/scroll while open. The menu is portaled out of the inspector
  // Panel (which is `overflow-hidden`), so absolute positioning would clip it.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = containerRef.current?.getBoundingClientRect();
      if (r)
        setPos({
          top: Math.round(r.bottom + 6),
          left: Math.round(r.left),
          width: Math.round(r.width),
        });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Outside-click closes — the menu is portaled, so check BOTH the trigger and
  // the menu (the container alone would miss the portaled menu and close on its click).
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) return;
    if (hoveredRef.current) {
      postHighlightTarget(hoveredRef.current, false);
      hoveredRef.current = null;
    }
    postReleaseHighlights();
  }, [open]);

  useEffect(() => {
    const onLeave = () => postReleaseHighlights();
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, []);

  const label = selected
    ? (selected.title || selected.url || selected.appName || "Untitled").slice(0, 90)
    : "Select target";

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <button
        type="button"
        onClick={() => {
          setOpen((wasOpen) => {
            if (!wasOpen) onRefresh();
            return !wasOpen;
          });
        }}
        className="w-full min-w-0 h-[32px] flex items-center justify-between gap-2 bg-surface-3 text-fg border border-divider rounded-card text-[12px] tracking-[-0.01em] px-3 cursor-pointer text-left transition-[background-color] duration-300 ease-[cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="WebKit target"
      >
        <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0">{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
              minWidth: 220,
              zIndex: 1000,
            }}
            className="m-0 p-1.5 list-none bg-panel border border-divider rounded-card shadow-[0_8px_28px_rgba(0,0,0,0.18)] max-h-[min(70vh,420px)] overflow-y-auto font-system"
          >
            {groups.map((group) => {
              const iconUrl = group.bundleId ? icons[group.bundleId] : null;
              return (
                <li key={group.key} className="list-none m-0 p-0">
                  <div className="flex items-center gap-2 px-2 pt-2 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-fg-3">
                    {iconUrl ? (
                      <img src={iconUrl} alt="" className="w-4 h-4 shrink-0 object-cover" />
                    ) : (
                      <span className="w-4 h-4 shrink-0 object-cover" aria-hidden="true" />
                    )}
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {group.appName}
                    </span>
                  </div>
                  <ul role="group" className="list-none m-0 p-0 pl-[26px]">
                    {group.targets.map((target) => {
                      const isSelected = selected?.id === target.id;
                      const isDisabled = !!target.inUseByOtherInspector && !isSelected;
                      const title = (
                        target.title ||
                        target.url ||
                        target.appName ||
                        "Untitled"
                      ).slice(0, 90);
                      const hovered = hoveredId === target.id && !isDisabled;
                      const baseCls =
                        "flex flex-col rounded-sm px-2.5 py-1.5 text-[12px] leading-[1.35] tracking-[-0.01em] transition-[background-color] duration-300 ease-[cubic-bezier(0.4,0,0.6,1)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]";
                      const stateCls = isDisabled
                        ? "opacity-40 cursor-not-allowed italic text-fg-2"
                        : hovered
                          ? "bg-accent-tint text-fg cursor-pointer"
                          : isSelected
                            ? "bg-surface-2 text-fg cursor-pointer"
                            : "text-fg-2 cursor-pointer";
                      return (
                        <li
                          key={target.id}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={isDisabled}
                          tabIndex={isDisabled ? -1 : 0}
                          title={
                            isDisabled ? "Already being inspected by another debugger" : undefined
                          }
                          onMouseEnter={() => {
                            if (isDisabled) return;
                            if (hoveredRef.current && hoveredRef.current !== target.id) {
                              postHighlightTarget(hoveredRef.current, false);
                            }
                            hoveredRef.current = target.id;
                            setHoveredId(target.id);
                            postHighlightTarget(target.id, true);
                          }}
                          onMouseLeave={() => {
                            if (hoveredRef.current === target.id) {
                              postHighlightTarget(target.id, false);
                              hoveredRef.current = null;
                            }
                            setHoveredId((prev) => (prev === target.id ? null : prev));
                          }}
                          onClick={() => {
                            if (isDisabled) return;
                            onSelectTarget(target.id);
                            setOpen(false);
                          }}
                          className={`${baseCls} ${stateCls}`}
                        >
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                            {title}
                          </span>
                          {target.url && target.url !== "about:blank" && (
                            <span className="block font-mono text-[10px] text-fg-3 overflow-hidden text-ellipsis whitespace-nowrap">
                              {target.url}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
