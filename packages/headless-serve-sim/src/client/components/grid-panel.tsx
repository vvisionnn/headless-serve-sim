import { useCallback, useRef, useState } from "react";
import { Panel, PanelCloseButton, PanelHeader, PanelTitle } from "../Panel";
import { useGridDevices } from "../hooks/use-grid-devices";
import { useGridMemory } from "../hooks/use-grid-memory";
import { type GridDevice, gridPreviewHref } from "../utils/grid";
import { GridCapacityBanner } from "./grid-capacity-banner";
import { GridTile } from "./grid-tile";

export function GridPanel({
  open,
  onClose,
  currentUdid,
  width,
}: {
  open: boolean;
  onClose: () => void;
  currentUdid: string;
  width: number;
}) {
  const config = window.__SIM_PREVIEW__;
  // Carry the streamed device so the server ranks it first — otherwise a large
  // catalog can paginate the active tile off the first page.
  const apiEndpoint =
    config?.gridApiEndpoint && currentUdid
      ? `${config.gridApiEndpoint}?device=${encodeURIComponent(currentUdid)}`
      : config?.gridApiEndpoint;
  const startEndpoint = config?.gridStartEndpoint;
  const shutdownEndpoint = config?.gridShutdownEndpoint;
  const memoryEndpoint = config?.gridMemoryEndpoint;
  const previewEndpoint = config?.previewEndpoint ?? "/";

  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [shuttingDown, setShuttingDown] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const hasPending =
    Object.values(pending).some(Boolean) || Object.values(shuttingDown).some(Boolean);
  const { devices, total, hasMore, refresh, loadMore, resetPage } = useGridDevices(
    apiEndpoint,
    open,
    hasPending,
  );

  // Closing the panel drops back to the first page: leaving a large window
  // loaded means re-fetching every device on each poll for a panel nobody is
  // looking at.
  const wasOpenRef = useRef(open);
  if (wasOpenRef.current !== open) {
    wasOpenRef.current = open;
    if (!open) resetPage();
  }

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!hasMore) return;
      const el = event.currentTarget;
      // One viewport of slack, so the next page is in flight before the user
      // reaches the end rather than after.
      if (el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight) loadMore();
    },
    [hasMore, loadMore],
  );
  const memory = useGridMemory(memoryEndpoint, open);

  const waitForHelper = useCallback(
    async (udid: string, timeoutMs = 20_000): Promise<GridDevice | null> => {
      if (!apiEndpoint) return null;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(apiEndpoint, { cache: "no-store" });
          const json = await res.json();
          const found = (json.devices ?? []).find((d: GridDevice) => d.device === udid && d.helper);
          if (found) return found;
        } catch {}
        await new Promise((r) => setTimeout(r, 400));
      }
      return null;
    },
    [apiEndpoint],
  );

  const start = useCallback(
    async (udid: string) => {
      if (!startEndpoint) return;
      setPending((p) => ({ ...p, [udid]: true }));
      setErrors((e) => ({ ...e, [udid]: null }));
      try {
        const res = await fetch(startEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ udid }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          setErrors((e) => ({ ...e, [udid]: json.error ?? `HTTP ${res.status}` }));
          return;
        }
        const ready = await waitForHelper(udid);
        if (ready) {
          window.location.assign(gridPreviewHref(previewEndpoint, udid));
          return;
        }
        setErrors((e) => ({ ...e, [udid]: "Helper did not register in time" }));
      } catch (err: any) {
        setErrors((e) => ({ ...e, [udid]: err?.message ?? "Request failed" }));
      } finally {
        setPending((p) => ({ ...p, [udid]: false }));
        refresh();
      }
    },
    [startEndpoint, refresh, waitForHelper, previewEndpoint],
  );

  const shutdown = useCallback(
    async (udid: string) => {
      if (!shutdownEndpoint) return;
      setShuttingDown((s) => ({ ...s, [udid]: true }));
      setErrors((e) => ({ ...e, [udid]: null }));
      try {
        const res = await fetch(shutdownEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ udid }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          setErrors((e) => ({ ...e, [udid]: json.error ?? `HTTP ${res.status}` }));
        }
      } catch (err: any) {
        setErrors((e) => ({ ...e, [udid]: err?.message ?? "Request failed" }));
      } finally {
        setShuttingDown((s) => ({ ...s, [udid]: false }));
        refresh();
      }
    },
    [shutdownEndpoint, refresh],
  );

  return (
    <Panel open={open} width={width}>
      <PanelHeader>
        <PanelTitle>
          Simulators
          {devices && total != null && total > devices.length ? (
            <span className="ml-1.5 text-fg-3 font-normal">
              {devices.length}/{total}
            </span>
          ) : null}
        </PanelTitle>
        <div className="flex items-center gap-2">
          <GridCapacityBanner report={memory} />
          <PanelCloseButton onClick={onClose} />
        </div>
      </PanelHeader>
      <div
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto p-2 grid auto-rows-[minmax(300px,auto)] gap-2 content-start grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
      >
        {devices === null ? null : devices.length === 0 ? (
          <div className="col-span-full bg-panel-deep border border-divider rounded-card px-4 py-6 text-fg-3 text-[13px] text-center tracking-[-0.01em]">
            No iOS simulators available.
          </div>
        ) : (
          devices.map((d) => (
            <GridTile
              key={d.device}
              device={d}
              active={d.device === currentUdid}
              previewEndpoint={previewEndpoint}
              starting={!!pending[d.device]}
              shuttingDown={!!shuttingDown[d.device]}
              error={errors[d.device] ?? null}
              onStart={() => start(d.device)}
              onShutdown={() => shutdown(d.device)}
            />
          ))
        )}
      </div>
    </Panel>
  );
}
