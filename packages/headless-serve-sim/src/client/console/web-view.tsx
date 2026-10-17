import { Menu } from "@base-ui/react/menu";
import { Check, ChevronsUpDown, Globe } from "lucide-react";
import { useEffect, useRef } from "react";
import { groupTargetsByApp } from "../../devtools-targets";
import { useAppIcons } from "../hooks/use-app-icons";
import type { useWebKitDevtools } from "../hooks/use-webkit-devtools";
import { cn } from "../lib/cn";
import {
  collapseScreencastPane,
  postHighlightTarget,
  postReleaseHighlights,
  type WebKitDevtoolsTarget,
} from "../utils/devtools";

const targetTitle = (t: WebKitDevtoolsTarget) =>
  (t.title || t.url || t.appName || "Untitled").slice(0, 90);

/**
 * Inspectable pages grouped under the app that owns them, like Safari's
 * Develop menu. Hovering a page highlights it on the device.
 */
function TargetPicker({
  udid,
  targets,
  selected,
  onSelect,
  onRefresh,
}: {
  udid: string;
  targets: WebKitDevtoolsTarget[];
  selected: WebKitDevtoolsTarget | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const groups = groupTargetsByApp(targets);
  const icons = useAppIcons(
    udid,
    groups.map((g) => g.bundleId).filter((id): id is string => !!id),
  );
  const hovered = useRef<string | null>(null);

  const unhover = () => {
    if (hovered.current) postHighlightTarget(hovered.current, false);
    hovered.current = null;
  };

  useEffect(() => {
    window.addEventListener("pagehide", postReleaseHighlights);
    window.addEventListener("beforeunload", postReleaseHighlights);
    return () => {
      window.removeEventListener("pagehide", postReleaseHighlights);
      window.removeEventListener("beforeunload", postReleaseHighlights);
    };
  }, []);

  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (open) onRefresh();
        else {
          unhover();
          postReleaseHighlights();
        }
      }}
    >
      <Menu.Trigger
        aria-label="WebKit target"
        className="inline-flex h-7 max-w-[360px] min-w-[220px] items-center justify-between gap-2 rounded-[8px] bg-control pr-1.5 pl-2.5 text-body font-medium text-label shadow-[0_0_0_0.5px_var(--separator),0_1px_2px_rgba(0,0,0,0.06)] outline-none transition-colors hover:bg-fill-3 focus-visible:outline-2 focus-visible:outline-[var(--focus)] data-[popup-open]:bg-fill-3 dark:shadow-[inset_0_0.5px_0_rgba(255,255,255,0.08)]"
      >
        <span className={cn("truncate", !selected && "text-label-3")}>
          {selected ? targetTitle(selected) : "Select target"}
        </span>
        <ChevronsUpDown className="size-[13px] shrink-0 text-label-3" strokeWidth={2} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start" className="z-[80] outline-none">
          <Menu.Popup className="glass-pop menu-pop thin-scrollbar max-h-[min(420px,var(--available-height))] w-[max(var(--anchor-width),300px)] origin-[var(--transform-origin)] overflow-y-auto rounded-[12px] p-[5px] outline-none">
            {groups.map((group) => {
              const icon = group.bundleId ? icons[group.bundleId] : null;
              return (
                <Menu.Group key={group.key} className="pb-1 last:pb-0">
                  <Menu.GroupLabel className="flex h-7 items-center gap-2 px-1.5 text-caption font-semibold text-label-3">
                    {icon ? (
                      <img src={icon} alt="" className="size-4 shrink-0 rounded-[4px]" />
                    ) : (
                      <span className="size-4 shrink-0 rounded-[4px] bg-fill-2" aria-hidden />
                    )}
                    <span className="truncate">{group.appName}</span>
                  </Menu.GroupLabel>
                  {group.targets.map((target) => {
                    const isSelected = selected?.id === target.id;
                    const disabled = !!target.inUseByOtherInspector && !isSelected;
                    return (
                      <Menu.Item
                        key={target.id}
                        disabled={disabled}
                        title={disabled ? "Already being inspected by another debugger" : undefined}
                        onClick={() => onSelect(target.id)}
                        onPointerEnter={() => {
                          if (disabled || hovered.current === target.id) return;
                          unhover();
                          hovered.current = target.id;
                          postHighlightTarget(target.id, true);
                        }}
                        onPointerLeave={() => {
                          if (hovered.current === target.id) unhover();
                        }}
                        className="group grid min-h-7 cursor-default grid-cols-[16px_minmax(0,1fr)] items-center gap-1.5 rounded-[7px] py-1 pr-3 pl-1.5 text-body text-label outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-ink data-[highlighted]:text-on-ink"
                      >
                        <span className="col-start-1 flex">
                          {isSelected && <Check className="size-[13px]" strokeWidth={2.5} />}
                        </span>
                        <span className="col-start-2 flex min-w-0 flex-col">
                          <span className="truncate">
                            {targetTitle(target)}
                            {disabled && <span className="text-label-3"> · In use</span>}
                          </span>
                          {target.url && target.url !== "about:blank" && (
                            <span className="truncate font-mono text-caption text-label-3 group-data-[highlighted]:text-on-ink/70">
                              {target.url}
                            </span>
                          )}
                        </span>
                      </Menu.Item>
                    );
                  })}
                </Menu.Group>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-footnote text-label-3">
      <Globe className="size-5 text-label-3" strokeWidth={1.75} />
      {children}
    </div>
  );
}

export function WebView({
  udid,
  devtools,
  selectedTargetId,
  onSelectTarget,
  live,
}: {
  udid: string;
  devtools: ReturnType<typeof useWebKitDevtools>;
  selectedTargetId: string | null;
  onSelectTarget: (id: string | null) => void;
  /** Only hold the inspector connection while the drawer is actually open. */
  live: boolean;
}) {
  const { targets, loading, error, refresh } = devtools;
  const selected = selectedTargetId
    ? (targets.find((target) => target.id === selectedTargetId) ?? null)
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b-[0.5px] border-separator px-2.5">
        {targets.length > 0 ? (
          <TargetPicker
            udid={udid}
            targets={targets}
            selected={selected}
            onSelect={onSelectTarget}
            onRefresh={() => void refresh()}
          />
        ) : (
          <span className={cn("truncate text-footnote text-label-3", loading && "shimmer-text")}>
            {loading
              ? "Looking for Safari and inspectable webviews…"
              : "No inspectable Safari or WKWebView targets"}
          </span>
        )}
        {selected?.url && (
          <span className="ml-auto truncate pl-2 font-mono text-caption text-label-3">
            {selected.url}
          </span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {error ? (
          <Empty>{error}</Empty>
        ) : selected && live ? (
          // Mount the iframe only while the drawer is visible. Unmounting tears
          // down the WebSocket so WIR releases the page; otherwise we'd hold
          // the inspector connection and block other debuggers (Safari's
          // Develop menu, chrome://inspect, …) from attaching.
          <iframe
            key={selected.id}
            src={selected.devtoolsFrontendUrl}
            title={`WebKit DevTools - ${selected.title || selected.url || selected.id}`}
            className="block size-full border-none bg-transparent"
            onLoad={(event) => collapseScreencastPane(event.currentTarget)}
          />
        ) : (
          <Empty>
            {selected
              ? "DevTools paused — open the console to reattach."
              : targets.length > 0
                ? "Pick a page to inspect."
                : "Open Safari or an inspectable WKWebView in the simulator."}
          </Empty>
        )}
      </div>
    </div>
  );
}
