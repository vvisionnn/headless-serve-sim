import { useEffect, useState } from "react";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { simEndpoint } from "../utils/sim-endpoint";

// One fetch per simulator for the life of the page; a miss is retried on the
// next mount, since the server may simply not have resolved the profile yet.
const specs = new Map<string, Promise<DeviceFrameSpec | null>>();

/** The installed frame spec of any simulator (not just the streamed one). */
export function useFrameSpec(udid: string | null): DeviceFrameSpec | null {
  const [spec, setSpec] = useState<DeviceFrameSpec | null>(null);
  useEffect(() => {
    if (!udid) {
      setSpec(null);
      return;
    }
    let cancelled = false;
    let request = specs.get(udid);
    if (!request) {
      request = fetch(simEndpoint(`grid/api/frame?device=${encodeURIComponent(udid)}`))
        .then((r) => r.json() as Promise<{ deviceFrameSpec: DeviceFrameSpec | null }>)
        .then((j) => j.deviceFrameSpec)
        .catch(() => null);
      specs.set(udid, request);
    }
    void request.then((s) => {
      if (!s) specs.delete(udid);
      if (!cancelled) setSpec(s);
    });
    return () => {
      cancelled = true;
    };
  }, [udid]);
  return spec;
}
