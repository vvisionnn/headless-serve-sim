import { selectedPreviewConfig } from "./preview-config";
import { simEndpoint } from "./sim-endpoint";
import { warmSimulatorSettings } from "./simulator-settings-cache";

type PreviewConfig = NonNullable<Window["__SIM_PREVIEW__"]>;

/** A simulator's preview config, or a rejection when it isn't streaming. */
async function fetchDeviceConfig(udid: string): Promise<PreviewConfig> {
  const url = new URL(simEndpoint("api"), window.location.href);
  url.searchParams.set("device", udid);
  const res = await fetch(url.toString(), { cache: "no-store" });
  const next = selectedPreviewConfig(
    (await res.json().catch(() => null)) as Partial<PreviewConfig> | null,
  );
  if (!next || next.device !== udid) throw new Error("The simulator isn't streaming yet");
  return next;
}

/**
 * The server answers a config from its booted-device snapshot, which it lists
 * again once that is 1.5s old — 120ms+ a click would wait on. Fetching as the
 * pointer arrives lets the click switch on an answer already in hand.
 */
const PREFETCH_FRESH_MS = 3000;
const prefetched = new Map<string, { promise: Promise<unknown>; at: number }>();

export function prefetchDeviceConfig<T = PreviewConfig>(
  udid: string,
  load: (udid: string) => Promise<T> = fetchDeviceConfig as (udid: string) => Promise<T>,
): Promise<T> {
  const entry = { promise: load(udid), at: Date.now() };
  // A fresh answer in hand keeps serving until this one lands; a refresh
  // that meets a stale server snapshot mustn't make a click wait on it.
  if (!isFresh(prefetched.get(udid))) prefetched.set(udid, entry);
  entry.promise.then(
    () => {
      const held = prefetched.get(udid);
      if (!held || held.at <= entry.at) prefetched.set(udid, entry);
    },
    // A failure is never reused: the next ask fetches again.
    () => {
      if (prefetched.get(udid) === entry) prefetched.delete(udid);
    },
  );
  return entry.promise as Promise<T>;
}

function isFresh(entry: { at: number } | undefined): boolean {
  return !!entry && Date.now() - entry.at < PREFETCH_FRESH_MS;
}

/** The prefetched config while fresh, else a new fetch. */
export function deviceConfig<T = PreviewConfig>(
  udid: string,
  load?: (udid: string) => Promise<T>,
): Promise<T> {
  const entry = prefetched.get(udid);
  if (entry && isFresh(entry)) return entry.promise as Promise<T>;
  return prefetchDeviceConfig(udid, load);
}

/**
 * Keep configs fresh while the pointer rests where a click would switch to
 * them, quicker than the server's snapshot goes stale. Returns the stop.
 * Each one's simulator settings are read too (throttled — it's a `simctl`
 * exec), so the inspector shows real values on the first switch to it.
 */
export function keepDeviceConfigsWarm<T = PreviewConfig>(
  udids: string[],
  load?: (udid: string) => Promise<T>,
  everyMs = 1200,
  warmSettings: (udid: string) => void = (udid) => void warmSimulatorSettings(udid),
): () => void {
  const warm = () => {
    for (const udid of udids)
      prefetchDeviceConfig(udid, load).then(
        () => warmSettings(udid),
        () => {},
      );
  };
  warm();
  const timer = setInterval(warm, everyMs);
  return () => clearInterval(timer);
}

/**
 * Starting a simulator that already streams only tidies up (orphan helpers,
 * the touch service), yet spawns the CLI and costs half a second. Switch at
 * once and let the start run alongside; wait on it only when the switch
 * finds nothing streaming yet.
 */
export async function switchWhileStarting(
  start: () => Promise<void>,
  switchTo: () => Promise<void>,
): Promise<void> {
  const started = start();
  try {
    await switchTo();
    started.catch(() => {});
  } catch {
    await started;
    await switchTo();
  }
}
