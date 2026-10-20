export type SimulatorSettings = Record<string, string>;

// The last known simulator settings per udid, kept for the page's life so the
// inspector (re)mounts — opening it, returning to the tab, switching devices —
// render real values at once and only refresh underneath. The dock's
// appearance toggle reads and writes it too, so it never has to ask first.
const cache = new Map<string, SimulatorSettings>();
const revisions = new Map<string, number>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function cachedSimulatorSettings(udid: string): SimulatorSettings | null {
  return cache.get(udid) ?? null;
}

/** Bumped by every optimistic change; a read records it when it starts. */
export function settingsRevision(udid: string): number {
  return revisions.get(udid) ?? 0;
}

/**
 * Store a read from the simulator. A read that started before an optimistic
 * change may predate it, so it's dropped rather than undoing the change.
 */
export function storeSimulatorSettings(
  udid: string,
  settings: SimulatorSettings,
  startedAt: number,
): boolean {
  if (startedAt !== settingsRevision(udid)) return false;
  cache.set(udid, settings);
  notify();
  return true;
}

/** An optimistic change, shown before the simulator confirms it. */
export function patchSimulatorSettings(udid: string, patch: SimulatorSettings) {
  revisions.set(udid, settingsRevision(udid) + 1);
  const current = cache.get(udid);
  if (!current) return;
  cache.set(udid, { ...current, ...patch });
  notify();
}

export function subscribeSimulatorSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only. */
export function clearSimulatorSettingsCache() {
  cache.clear();
  revisions.clear();
}
