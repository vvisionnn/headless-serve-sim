/**
 * Which device UDID the `/api/events` SSE subscription should pin to.
 *
 * The subscription is always pinned to an explicit or previously committed
 * user selection. With no selection it stays empty. If that simulator goes
 * away, the server returns `null` and only resumes the same device.
 *
 * Rules:
 * - An explicit `?device=` in the URL always wins.
 * - With no URL device, pin to the initially-committed device so a disconnect
 *   can only ever resume the same user selection.
 */
export function resolveEventsDevice(opts: {
  urlDevice: string | null;
  initialDevice: string | null;
}): string | null {
  const url = opts.urlDevice?.trim() || null;
  if (url) return url;
  return opts.initialDevice?.trim() || null;
}
