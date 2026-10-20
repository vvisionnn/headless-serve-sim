import { useEffect, useState } from "react";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { simEndpoint } from "../utils/sim-endpoint";

// One fetch per simulator for the life of the page; a miss is retried on the
// next mount, since the server may simply not have resolved the profile yet.
const specs = new Map<string, Promise<DeviceFrameSpec | null>>();
// The same specs once they have landed, readable synchronously so a tile that
// mounts after a prefetch draws its real bezel on the first frame.
const resolved = new Map<string, DeviceFrameSpec>();

/** Fetch (once) the installed frame spec of any simulator. */
export function prefetchFrameSpec(udid: string): Promise<DeviceFrameSpec | null> {
  let request = specs.get(udid);
  if (!request) {
    request = fetch(simEndpoint(`grid/api/frame?device=${encodeURIComponent(udid)}`))
      .then((r) => r.json() as Promise<{ deviceFrameSpec: DeviceFrameSpec | null }>)
      .then((j) => j.deviceFrameSpec)
      .catch(() => null)
      .then((s) => {
        if (s) resolved.set(udid, s);
        else specs.delete(udid);
        return s;
      });
    specs.set(udid, request);
  }
  return request;
}

/**
 * The installed frame spec of any simulator (not just the streamed one), and
 * whether the answer is in — `spec: null` alone can't tell "no profile" from
 * "still asking".
 */
export function useFrameSpecState(udid: string | null): {
  spec: DeviceFrameSpec | null;
  loaded: boolean;
} {
  const [state, setState] = useState(() => known(udid));
  useEffect(() => {
    const now = known(udid);
    setState((s) => (s.udid === udid && s.spec === now.spec ? s : now));
    if (!udid || now.loaded) return;
    let cancelled = false;
    void prefetchFrameSpec(udid).then((spec) => {
      if (!cancelled) setState({ udid, spec, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, [udid]);
  // A new udid reads the cache this render rather than waiting on the effect.
  const { spec, loaded } = state.udid === udid ? state : known(udid);
  return { spec, loaded };
}

function known(udid: string | null) {
  const spec = udid ? (resolved.get(udid) ?? null) : null;
  return { udid, spec, loaded: !udid || spec !== null };
}

/** The installed frame spec of any simulator (not just the streamed one). */
export function useFrameSpec(udid: string | null): DeviceFrameSpec | null {
  return useFrameSpecState(udid).spec;
}
