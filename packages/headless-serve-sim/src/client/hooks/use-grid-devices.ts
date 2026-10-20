import { useCallback, useEffect, useMemo, useState } from "react";
import type { GridDevice } from "../utils/grid";

/** Devices fetched initially, and added by each `loadMore`. */
export const GRID_PAGE_SIZE = 24;

/** Matches the server's own page cap. */
export const GRID_MAX_PAGE_SIZE = 1000;

interface GridAnswer {
  devices: GridDevice[];
  total: number;
}

// The last answer per URL outlives the views that asked: the wall and the
// navigator mount and unmount freely, and a fresh mount should show what was
// last known on its very first frame while a refresh runs.
const answers = new Map<string, GridAnswer>();
const inFlight = new Map<string, Promise<GridAnswer | null>>();

export function gridPageUrl(endpoint: string, pageSize: number): string {
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}limit=${pageSize}&offset=0`;
}

/**
 * One request per URL at a time. Pollers that tick while it runs (or another
 * view polling the same window) join it rather than stacking a second
 * `simctl list` behind it.
 */
export function fetchGrid(url: string): Promise<GridAnswer | null> {
  const running = inFlight.get(url);
  if (running) return running;
  const request = fetch(url, { cache: "no-store" })
    .then((res) => res.json())
    .then((json: { devices?: GridDevice[]; total?: number }) => {
      const answer = {
        devices: json.devices ?? [],
        // `total` is absent from a server that ignores paging; there the
        // response already holds everything, so the count is what arrived.
        total: typeof json.total === "number" ? json.total : (json.devices?.length ?? 0),
      };
      answers.set(url, answer);
      return answer;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(url));
  inFlight.set(url, request);
  return request;
}

/**
 * Poll the grid API for a *window* of devices.
 *
 * The window is re-fetched whole on every tick rather than accumulated page by
 * page. Device state (booted, helper attached) changes underneath us, so pages
 * appended once and never refreshed would show stale badges for everything but
 * the newest page. Growing a single window keeps it to one request per tick
 * and keeps every loaded row live.
 */
export function useGridDevices(
  endpoint: string | undefined,
  enabled: boolean,
  fast: boolean,
  initialPageSize = GRID_PAGE_SIZE,
) {
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [refreshKey, setRefreshKey] = useState(0);

  const pagedEndpoint = useMemo(
    () => (endpoint ? gridPageUrl(endpoint, pageSize) : undefined),
    [endpoint, pageSize],
  );
  const [last] = useState(() => (pagedEndpoint ? answers.get(pagedEndpoint) : undefined));
  const [devices, setDevices] = useState<GridDevice[] | null>(last?.devices ?? null);
  const [total, setTotal] = useState<number | null>(last?.total ?? null);

  useEffect(() => {
    if (!enabled || !pagedEndpoint) return;
    let cancelled = false;
    const tick = async () => {
      const answer = await fetchGrid(pagedEndpoint);
      if (cancelled) return;
      if (!answer) {
        // Keep what is on screen through a failed poll.
        setDevices((d) => d ?? []);
        return;
      }
      setDevices(answer.devices);
      setTotal(answer.total);
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
