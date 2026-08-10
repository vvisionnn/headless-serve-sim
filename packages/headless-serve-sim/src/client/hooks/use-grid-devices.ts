import { useCallback, useEffect, useMemo, useState } from "react";
import type { GridDevice } from "../utils/grid";

/** Devices fetched initially, and added by each `loadMore`. */
export const GRID_PAGE_SIZE = 24;

/** Matches the server's own page cap. */
const GRID_MAX_PAGE_SIZE = 1000;

/**
 * Poll the grid API for a *window* of devices.
 *
 * The window is re-fetched whole on every tick rather than accumulated page by
 * page. Device state (booted, helper attached) changes underneath us, so pages
 * appended once and never refreshed would show stale badges for everything but
 * the newest page. Growing a single window keeps it to one request per tick
 * and keeps every loaded row live.
 */
export function useGridDevices(endpoint: string | undefined, enabled: boolean, fast: boolean) {
  const [devices, setDevices] = useState<GridDevice[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState(GRID_PAGE_SIZE);
  const [refreshKey, setRefreshKey] = useState(0);

  const pagedEndpoint = useMemo(() => {
    if (!endpoint) return undefined;
    const separator = endpoint.includes("?") ? "&" : "?";
    return `${endpoint}${separator}limit=${pageSize}&offset=0`;
  }, [endpoint, pageSize]);

  useEffect(() => {
    if (!enabled || !pagedEndpoint) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(pagedEndpoint, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        setDevices(json.devices ?? []);
        // `total` is absent from a server that ignores paging; there the
        // response already holds everything, so the count is what arrived.
        setTotal(typeof json.total === "number" ? json.total : (json.devices?.length ?? 0));
      } catch {
        if (!cancelled) setDevices([]);
      }
    };
    void tick();
    const id = setInterval(tick, fast ? 750 : 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pagedEndpoint, enabled, refreshKey, fast]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const loadMore = useCallback(
    () => setPageSize((n) => Math.min(n + GRID_PAGE_SIZE, GRID_MAX_PAGE_SIZE)),
    [],
  );
  const loadAll = useCallback(() => setPageSize(GRID_MAX_PAGE_SIZE), []);
  const resetPage = useCallback(() => setPageSize(GRID_PAGE_SIZE), []);

  const hasMore = devices !== null && total !== null && devices.length < total;

  return { devices, total, hasMore, refresh, loadMore, loadAll, resetPage };
}
