import { hostUiRequest } from "./exec";

export type SimulatorSettings = Record<string, string>;

// The last known simulator settings per udid, kept for the page's life so the
// inspector (re)mounts — opening it, returning to the tab, switching devices —
// render real values at once and only refresh underneath. The dock's
// appearance toggle reads and writes it too, so it never has to ask first.
const cache = new Map<string, SimulatorSettings>();
const revisions = new Map<string, number>();
// When each value was last known to match the simulator: read, or set by us.
const confirmedAt = new Map<string, Map<string, number>>();
const listeners = new Set<() => void>();

/**
 * How long a confirmed value is trusted without asking again. The simulator
 * can change under the page (the CLI, its Settings app, another tab), so an
 * old value is only good for showing, not for deciding what a toggle sets.
 */
export const SETTINGS_FRESH_MS = 5000;

function notify() {
  for (const listener of listeners) listener();
}

function confirm(udid: string, options: string[]) {
  const at = confirmedAt.get(udid) ?? new Map<string, number>();
  for (const option of options) at.set(option, Date.now());
  confirmedAt.set(udid, at);
}

export function cachedSimulatorSettings(udid: string): SimulatorSettings | null {
  return cache.get(udid) ?? null;
}

/** A value confirmed in the last few seconds, else undefined. */
export function freshSimulatorSetting(udid: string, option: string): string | undefined {
  const at = confirmedAt.get(udid)?.get(option);
  if (at === undefined || Date.now() - at > SETTINGS_FRESH_MS) return undefined;
  return cache.get(udid)?.[option];
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
  confirm(udid, Object.keys(settings));
  notify();
  return true;
}

/** An optimistic change, shown before the simulator confirms it. */
export function patchSimulatorSettings(udid: string, patch: SimulatorSettings) {
  revisions.set(udid, settingsRevision(udid) + 1);
  for (const option of Object.keys(patch)) confirmedAt.get(udid)?.delete(option);
  const current = cache.get(udid);
  if (!current) return;
  cache.set(udid, { ...current, ...patch });
  notify();
}

/** A set landed: the value is trusted again, unless a later change replaced it. */
export function confirmSimulatorSetting(udid: string, option: string, value: string) {
  if (cache.get(udid)?.[option] === value) confirm(udid, [option]);
}

export function subscribeSimulatorSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Read a simulator's settings before the inspector shows it, so the first
 * switch to it renders real values. Reading is a `simctl` exec, so each
 * simulator is read at most once every few seconds, and never twice at once.
 */
export const SETTINGS_WARM_MS = 5000;
const warmedAt = new Map<string, number>();
const warming = new Set<string>();

export async function warmSimulatorSettings(
  udid: string,
  read: (udid: string) => Promise<SimulatorSettings | null> = (device) =>
    hostUiRequest({ device }, { signal: AbortSignal.timeout(15_000) }),
): Promise<void> {
  const last = warmedAt.get(udid);
  if (warming.has(udid) || (last !== undefined && Date.now() - last < SETTINGS_WARM_MS)) return;
  warming.add(udid);
  warmedAt.set(udid, Date.now());
  const startedAt = settingsRevision(udid);
  try {
    const settings = await read(udid);
    if (settings) storeSimulatorSettings(udid, settings, startedAt);
  } catch {
    // The inspector reads again when it shows this simulator.
  } finally {
    warming.delete(udid);
  }
}

/** Tests only. */
export function clearSimulatorSettingsCache() {
  cache.clear();
  revisions.clear();
  confirmedAt.clear();
  warmedAt.clear();
  warming.clear();
}
