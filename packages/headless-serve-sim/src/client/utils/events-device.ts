/**
 * Which device UDID the `/api/events` SSE subscription should pin to.
 *
 * The server resolves an *unpinned* subscription to "the first booted helper"
 * (`selectServeSimState` → `states[0]`). When the selected simulator shuts down
 * its helper state is recycled, so `states[0]` silently flips to another booted
 * simulator and the server pushes that config — the page hops to a *different*
 * device. A subscription pinned to an explicit udid never falls back: the
 * server returns `null` (empty) once that udid is gone, and re-pushes its config
 * only when the *same* simulator comes back.
 *
 * Rules:
 * - An explicit `?device=` in the URL always wins (both modes).
 * - `autoConnect` ON, no URL device  → unpinned (legacy: may hop to whichever
 *   simulator is booted).
 * - `autoConnect` OFF, no URL device → pin to the initially-committed device so
 *   a disconnect can only ever reconnect to the same simulator.
 */
export function resolveEventsDevice(opts: {
  autoConnect: boolean;
  urlDevice: string | null;
  initialDevice: string | null;
}): string | null {
  const url = opts.urlDevice?.trim() || null;
  if (url) return url;
  if (opts.autoConnect) return null;
  return opts.initialDevice?.trim() || null;
}
