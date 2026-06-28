import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { deviceKind, runtimeOrder, type SimDevice } from "../utils/devices";

// Inline dropdown — no shadcn / hugeicons dependency so the headless-serve-sim client
// stays self-contained. The menu is portaled to <body> with fixed positioning so
// it escapes the top bar's `overflow:hidden` and the device frame's stacking
// context (otherwise it gets clipped to the 44px bar and hidden behind the frame).
export function DevicePicker({
  devices,
  selectedUdid,
  loading,
  error,
  stoppingUdids,
  onRefresh,
  onSelect,
  onStop,
  trigger,
}: {
  devices: SimDevice[];
  selectedUdid: string | null;
  loading: boolean;
  error: string | null;
  stoppingUdids: Set<string>;
  onRefresh: () => void;
  onSelect: (d: SimDevice) => void;
  onStop: (udid: string) => void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Anchor the fixed menu to the trigger; keep it pinned on resize while open.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPos({ top: Math.round(r.bottom + 6), left: Math.round(r.left) });
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
  // the menu (rootRef alone would miss the portaled menu and close on its click).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const grouped = new Map<string, SimDevice[]>();
  for (const d of devices) {
    if (d.udid === selectedUdid) continue;
    let list = grouped.get(d.runtime);
    if (!list) { list = []; grouped.set(d.runtime, list); }
    list.push(d);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => deviceKind(a.name) - deviceKind(b.name) || a.name.localeCompare(b.name));
  }
  const sortedGroups = [...grouped.entries()].sort(
    ([a], [b]) => runtimeOrder(a) - runtimeOrder(b) || a.localeCompare(b),
  );
  const selected = devices.find((d) => d.udid === selectedUdid) ?? null;

  return (
    <div ref={triggerRef} className="relative min-w-0">
      <div
        onClick={() => {
          if (!open) onRefresh();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </div>
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000 }}
            className="min-w-65 max-h-[min(70vh,420px)] overflow-y-auto bg-panel border border-divider rounded-card p-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.18)] font-system text-[13px] tracking-[-0.01em] text-fg"
          >
            <div className="flex items-center justify-between px-2.5 py-1.5 text-[12px] text-fg-3">
              <span className="font-semibold uppercase tracking-[0.06em]">Simulators</span>
              <button
                onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                disabled={loading}
                className="bg-transparent border-none text-accent text-[12px] cursor-pointer p-0 transition-colors duration-300 ease-[cubic-bezier(0.4,0,0.6,1)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)] rounded-sm"
              >
                {loading ? "..." : "Refresh"}
              </button>
            </div>
            {error && <div className="px-2.5 py-1.5 text-danger text-[12px]">{error}</div>}
            {selected && (
              <>
                <div className="flex items-center gap-2.5 px-2.5 py-2 text-accent">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: selected.state === "Booted" ? "var(--color-success)" : "var(--color-divider)" }}
                  />
                  <span className="flex-1">{selected.name}</span>
                </div>
                <div className="h-px bg-divider my-1" />
              </>
            )}
            {devices.length === 0 && !loading && !error && (
              <div className="p-2.5 text-fg-3 text-[12px] text-center">No available simulators found</div>
            )}
            {sortedGroups.map(([runtime, devs]) => (
              <div key={runtime}>
                <div className="px-2.5 pt-2 pb-1 text-[12px] font-semibold text-fg-3 uppercase tracking-[0.06em]">{runtime}</div>
                {devs.map((d) => {
                  const isStopping = stoppingUdids.has(d.udid);
                  const isBooted = d.state === "Booted";
                  return (
                    <div
                      key={d.udid}
                      className="flex items-center gap-2.5 px-2.5 py-2 cursor-pointer rounded-sm transition-colors duration-300 ease-[cubic-bezier(0.4,0,0.6,1)] hover:bg-hover"
                      onClick={() => { onSelect(d); setOpen(false); }}
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: isBooted ? "var(--color-success)" : "var(--color-divider)" }}
                      />
                      <span className="flex-1">{d.name}</span>
                      {isBooted && (
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); if (!isStopping) onStop(d.udid); }}
                          className={`text-[11px] py-0.5 px-2 rounded-pill transition-colors duration-300 ease-[cubic-bezier(0.4,0,0.6,1)] ${isStopping ? "text-fg-2 bg-transparent cursor-default" : "text-danger bg-surface-2 cursor-pointer"}`}
                        >
                          {isStopping ? "Stopping..." : "Stop"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
