import { useCallback, useState } from "react";
import { deviceKind, runtimeOrder, type SimDevice } from "../utils/devices";
import { simEndpoint } from "../utils/sim-endpoint";

// ─── Empty state: pick a simulator to boot ───
//
// Until the user selects a simulator, the middleware injects no stream config.
// List available simulators inline and let the user explicitly start one.
export function BootEmptyState({
  devices,
  loading,
  error,
  onRefresh,
}: {
  devices: SimDevice[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [startingUdid, setStartingUdid] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const start = useCallback(async (d: SimDevice) => {
    if (startingUdid) return;
    setStartingUdid(d.udid);
    setStartError(null);
    try {
      const apiUrl = `${simEndpoint("api")}?device=${encodeURIComponent(d.udid)}`;
      const navigateWhenReady = (async () => {
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          try {
            const r = await fetch(apiUrl, { cache: "no-store" });
            if (r.ok && (await r.json())) {
              const nextUrl = new URL(window.location.href);
              nextUrl.searchParams.set("device", d.udid);
              window.location.assign(nextUrl.toString());
              return true;
            }
          } catch {}
          await new Promise((res) => setTimeout(res, 400));
        }
        return false;
      })();

      const startUrl = simEndpoint("grid/api/start");
      const startReq = fetch(startUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ udid: d.udid }),
      })
        .then(async (res) => {
          const json = await res.json().catch(() => ({} as any));
          if (!res.ok || !json.ok) {
            throw new Error(json.error ?? `HTTP ${res.status}`);
          }
        });

      const navigated = await Promise.race([
        navigateWhenReady,
        startReq.then(() => "started" as const),
      ]);

      if (navigated === true) return;
      const ready = await navigateWhenReady;
      if (ready) return;
      throw new Error("headless-serve-sim started but no stream state appeared");
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start stream");
      setStartingUdid(null);
    }
  }, [startingUdid]);

  const grouped = new Map<string, SimDevice[]>();
  for (const d of devices) {
    let list = grouped.get(d.runtime);
    if (!list) { list = []; grouped.set(d.runtime, list); }
    list.push(d);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => {
      const ab = a.state === "Shutdown" ? 0 : a.state === "Booted" ? 1 : 2;
      const bb = b.state === "Shutdown" ? 0 : b.state === "Booted" ? 1 : 2;
      if (ab !== bb) return ab - bb;
      return deviceKind(a.name) - deviceKind(b.name) || a.name.localeCompare(b.name);
    });
  }
  const sortedGroups = [...grouped.entries()].sort(
    ([a], [b]) => runtimeOrder(a) - runtimeOrder(b) || a.localeCompare(b),
  );

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-page p-4 gap-4 font-system box-border">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="font-display text-[24px] font-semibold tracking-[-0.01em] m-0 text-fg">No headless-serve-sim stream running</h1>
        <p className="text-fg-2 text-[15px] tracking-[-0.01em] max-w-120">
          Pick a simulator to connect, or start a specific one yourself with{" "}
          <code className="bg-surface-2 rounded-pill px-2 py-0.5 text-[13px]">bunx headless-serve-sim --detach &lt;device&gt;</code>.
        </p>
        <div className="w-full max-w-90 mt-2 bg-panel-deep rounded-card border border-divider font-mono text-[13px] text-fg text-left max-h-[70vh] overflow-y-auto min-h-0">
          <div className="flex items-center justify-between px-3 py-2.5 text-[12px] text-fg-3 border-b border-divider">
            <span className="font-semibold uppercase tracking-[0.06em]">Simulators</span>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="bg-transparent border-none text-accent text-[12px] cursor-pointer p-0 rounded-sm transition-[color] duration-300 ease-[cubic-bezier(0.4,0,0.6,1)] disabled:cursor-default disabled:opacity-50 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
            >
              {loading ? "..." : "Refresh"}
            </button>
          </div>
          {error && <div className="px-3 py-2 text-danger text-[12px] break-words border-b border-divider">{error}</div>}
          {startError && <div className="px-3 py-2 text-danger text-[12px] break-words border-b border-divider">{startError}</div>}
          {!loading && !error && devices.length === 0 && (
            <div className="px-3 py-3 text-fg-3 text-[12px] text-center">No available simulators found</div>
          )}
          {sortedGroups.map(([runtime, devs]) => (
            <div key={runtime} className="border-b border-divider last:border-b-0">
              <div className="px-3 pt-2.5 pb-1 text-[12px] font-semibold text-fg-3 uppercase tracking-[0.07em]">{runtime}</div>
              {devs.map((d) => {
                const isStarting = startingUdid === d.udid;
                const disabled = startingUdid !== null && !isStarting;
                const isBooted = d.state === "Booted";
                return (
                  <div
                    key={d.udid}
                    className={`flex items-center gap-2.5 px-3 py-2 transition-[background-color] duration-300 ease-[cubic-bezier(0.4,0,0.6,1)] ${disabled ? "cursor-default opacity-50" : "cursor-pointer hover:bg-hover"}`}
                    onClick={() => { if (!disabled) start(d); }}
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: isBooted ? "var(--color-success)" : "var(--color-fg-3)" }}
                    />
                    <span className="flex-1 min-w-0 truncate text-left">{d.name}</span>
                    <span className={`shrink-0 whitespace-nowrap text-[11px] ${isStarting ? "text-accent" : "text-fg-2"}`}>
                      {isStarting
                        ? (isBooted ? "Starting..." : "Booting...")
                        : (isBooted ? "Start stream" : "Boot & stream")}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
