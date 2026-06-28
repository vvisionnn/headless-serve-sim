import { useEffect, useRef, useState, type ReactNode } from "react";
import { deviceKind, runtimeOrder, type SimDevice } from "../utils/devices";

// Inline dropdown — no shadcn / hugeicons dependency so the headless-serve-sim client
// stays self-contained.
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
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
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
    <div ref={rootRef} className="relative min-w-0">
      <div
        onClick={() => {
          if (!open) onRefresh();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </div>
      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 min-w-65 max-h-90 overflow-y-auto bg-panel border border-divider p-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] font-mono text-[13px] text-fg z-20">
          <div className="flex items-center justify-between px-2 py-1.5 text-[11px] text-fg-2">
            <span className="font-semibold">Simulators</span>
            <button
              onClick={(e) => { e.stopPropagation(); onRefresh(); }}
              disabled={loading}
              className="bg-transparent border-none text-accent text-[11px] cursor-pointer p-0"
            >
              {loading ? "..." : "Refresh"}
            </button>
          </div>
          {error && <div className="px-2 py-1.5 text-danger text-[11px]">{error}</div>}
          {selected && (
            <>
              <div className="flex items-center gap-2 px-2 py-1.5 text-accent">
                <span
                  className="size-1.5 shrink-0"
                  style={{ background: selected.state === "Booted" ? "var(--color-success)" : "var(--color-divider)" }}
                />
                <span className="flex-1">{selected.name}</span>
              </div>
              <div className="h-px bg-divider my-1" />
            </>
          )}
          {devices.length === 0 && !loading && !error && (
            <div className="p-2 text-fg-3 text-[11px] text-center">No available simulators found</div>
          )}
          {sortedGroups.map(([runtime, devs]) => (
            <div key={runtime}>
              <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold text-fg-3 uppercase tracking-[0.08em]">{runtime}</div>
              {devs.map((d) => {
                const isStopping = stoppingUdids.has(d.udid);
                const isBooted = d.state === "Booted";
                return (
                  <div
                    key={d.udid}
                    className="flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors hover:bg-hover"
                    onClick={() => { onSelect(d); setOpen(false); }}
                  >
                    <span
                      className="size-1.5 shrink-0"
                      style={{ background: isBooted ? "var(--color-success)" : "var(--color-divider)" }}
                    />
                    <span className="flex-1">{d.name}</span>
                    {isBooted && (
                      <span
                        role="button"
                        onClick={(e) => { e.stopPropagation(); if (!isStopping) onStop(d.udid); }}
                        className={`text-[10px] py-px px-1.5 ${isStopping ? "text-fg-2 bg-transparent cursor-default" : "text-danger bg-surface-2 cursor-pointer"}`}
                      >
                        {isStopping ? "Stopping..." : "Stop"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
