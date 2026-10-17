import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Glasses, RefreshCw, Smartphone, Tablet, Tv, Watch } from "lucide-react";
import { useCallback, useState } from "react";
import { DeviceBezel } from "../components/device-bezel";
import { useFrameSpec } from "../hooks/use-frame-spec";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { Button, IconButton } from "../ui/button";
import { Tip } from "../ui/tooltip";
import { fitDeviceBezel } from "../utils/bezel-geometry";
import { deviceKind, runtimeLabel, runtimeOrder, type SimDevice } from "../utils/devices";
import { simEndpoint } from "../utils/sim-endpoint";

// The waiting device is drawn at the size of a phone at 20%: Simulator.app's
// own artwork is ~1350 × 2780 px.
const DEVICE_BOX = { width: 280, height: 556 };

function glyphFor(name: string) {
  const n = name.toLowerCase();
  if (n.includes("ipad")) return Tablet;
  if (n.includes("watch")) return Watch;
  if (n.includes("vision")) return Glasses;
  if (n.includes("tv")) return Tv;
  return Smartphone;
}

/** Booted first (they stream fastest), then phones before tablets, then by runtime and name. */
export function emptySceneOrder(devices: SimDevice[]): SimDevice[] {
  return [...devices].sort(
    (a, b) =>
      Number(b.state === "Booted") - Number(a.state === "Booted") ||
      deviceKind(a.name) - deviceKind(b.name) ||
      runtimeOrder(a.runtime) - runtimeOrder(b.runtime) ||
      a.name.localeCompare(b.name),
  );
}

export function detachCommand(name: string | null): string {
  return `headless-serve-sim --detach "${name ?? "<device>"}"`;
}

/**
 * Ask the server to start `udid` and move the page onto it as soon as its
 * stream state appears; throws if it never does.
 */
async function startAndNavigate(udid: string): Promise<void> {
  const apiUrl = `${simEndpoint("api")}?device=${encodeURIComponent(udid)}`;
  const navigateWhenReady = (async () => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(apiUrl, { cache: "no-store" });
        if (r.ok && (await r.json())) {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set("device", udid);
          window.location.assign(nextUrl.toString());
          return true;
        }
      } catch {}
      await new Promise((res) => setTimeout(res, 400));
    }
    return false;
  })();

  const startReq = fetch(simEndpoint("grid/api/start"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ udid }),
  }).then(async (res) => {
    const json = await res.json().catch(() => ({}) as { ok?: boolean; error?: string });
    if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  });

  const navigated = await Promise.race([
    navigateWhenReady,
    startReq.then(() => "started" as const),
  ]);
  if (navigated === true) return;
  if (await navigateWhenReady) return;
  throw new Error("headless-serve-sim started but no stream state appeared");
}

/**
 * Nothing streaming yet. An empty device waits on the stage; booting one fills
 * it — the empty state and the working state are the same place.
 *
 * Until the user selects a simulator, the middleware injects no stream config,
 * so this page lists simulators itself and lets the user explicitly start one.
 */
export function EmptyScene({
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
  const [copied, setCopied] = useState(false);

  const ordered = emptySceneOrder(devices);
  const starting = devices.find((d) => d.udid === startingUdid) ?? null;
  // The device on the stage is the one being started, else the likeliest pick.
  const shown = starting ?? ordered.find((d) => deviceKind(d.name) === 0) ?? ordered[0] ?? null;
  const command = detachCommand(shown?.name ?? null);

  const start = useCallback(
    async (d: SimDevice) => {
      if (startingUdid) return;
      setStartingUdid(d.udid);
      setStartError(null);
      try {
        await startAndNavigate(d.udid);
      } catch (err) {
        setStartError(err instanceof Error ? err.message : "Failed to start stream");
        setStartingUdid(null);
      }
    },
    [startingUdid],
  );

  const copy = () => {
    void navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="stage-bg fixed inset-0 flex items-center justify-center gap-16 overflow-y-auto px-10 py-10 max-lg:flex-col max-lg:justify-start max-lg:gap-8">
      <motion.div
        className="relative shrink-0"
        style={DEVICE_BOX}
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      >
        <WaitingDevice udid={shown?.udid ?? null} booting={!!starting} />
      </motion.div>

      <motion.div
        className="flex w-[380px] max-w-full shrink-0 flex-col gap-6"
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={spring.surface}
      >
        <div className="flex flex-col gap-2">
          <h1 className="text-title1 text-label">No simulator is streaming</h1>
          <p className="text-body text-label-2">
            Pick one to boot and stream it here. Everything you do in this window goes straight to
            the device.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between pl-1">
            <span className="text-caption font-medium text-label-3">Simulators</span>
            <Tip label="Refresh">
              <IconButton
                label="Refresh simulators"
                size="sm"
                onClick={onRefresh}
                disabled={loading}
              >
                <RefreshCw className={cn(loading && "animate-spin")} />
              </IconButton>
            </Tip>
          </div>
          {(error || startError) && (
            <p className="px-1 text-footnote break-words text-red">{startError ?? error}</p>
          )}
          <div className="group-box thin-scrollbar flex max-h-[min(46vh,340px)] flex-col overflow-y-auto p-1 [&>*]:shrink-0">
            {ordered.length === 0 && (
              <p
                className={cn(
                  "px-2.5 py-4 text-center text-footnote",
                  loading ? "shimmer-text font-medium" : "text-label-3",
                )}
              >
                {loading ? "Looking for simulators…" : "No available simulators found"}
              </p>
            )}
            {ordered.map((d) => {
              const G = glyphFor(d.name);
              const isStarting = startingUdid === d.udid;
              const booted = d.state === "Booted";
              return (
                <div
                  key={d.udid}
                  className="flex min-h-12 items-center gap-3 rounded-[10px] px-2.5 transition-colors hover:bg-fill-3"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-fill-2 text-label">
                    <G className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body font-medium text-label">{d.name}</span>
                    <span className="truncate text-caption text-label-3">
                      {runtimeLabel(d.runtime)}
                    </span>
                  </span>
                  <AnimatePresence mode="popLayout" initial={false}>
                    {isStarting ? (
                      <motion.span
                        key="busy"
                        className="shimmer-text text-footnote font-semibold"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                      >
                        {booted ? "Starting…" : "Booting…"}
                      </motion.span>
                    ) : (
                      <motion.span key="idle" exit={{ opacity: 0, scale: 0.9 }}>
                        <Button
                          size="sm"
                          variant={booted ? "primary" : "secondary"}
                          disabled={startingUdid !== null}
                          onClick={() => void start(d)}
                        >
                          {booted ? "Start stream" : "Boot & stream"}
                        </Button>
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-caption font-medium text-label-3">
            Or start one from the terminal
          </span>
          <div className="flex h-9 items-center gap-2 rounded-[10px] bg-fill-3 pr-1 pl-3 font-mono text-footnote text-label shadow-[inset_0_0_0_0.5px_var(--separator)]">
            <span className="text-label-3">$</span>
            <span className="flex-1 truncate select-all">{command}</span>
            <button
              type="button"
              aria-label="Copy command"
              onClick={copy}
              className="flex size-7 items-center justify-center rounded-[7px] text-label-2 hover:bg-fill-2"
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={String(copied)}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={spring.snappy}
                >
                  {copied ? (
                    <Check className="size-3.5 text-green" strokeWidth={2.5} />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/** An off device in its real bezel; a boot lights it with the logo and a progress bar. */
function WaitingDevice({ udid, booting }: { udid: string | null; booting: boolean }) {
  const spec = useFrameSpec(udid);
  const screen = (
    <div className="absolute inset-0 bg-[#050506]">
      {/* An off screen still catches the room's light. */}
      <div className="absolute inset-0 bg-[linear-gradient(125deg,rgba(255,255,255,0.09)_0%,rgba(255,255,255,0.02)_38%,transparent_39%,transparent_100%)]" />
      <AnimatePresence>
        {booting && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <svg width="22%" viewBox="0 0 24 24" fill="#fff" aria-hidden>
              <path d="M16.37 12.55c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.72-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.6 1.1 8.76.73 1.05 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.32-3.5ZM14.2 6.07c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.56-1.23Z" />
            </svg>
            <div className="absolute bottom-[32%] left-1/2 h-[3px] w-[30%] -translate-x-1/2 overflow-hidden rounded-full bg-white/25">
              {/* Boot time is unknown: ease toward the end and wait there. */}
              <motion.div
                className="h-full rounded-full bg-white"
                initial={{ width: "0%" }}
                animate={{ width: "92%" }}
                transition={{ duration: 14, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  if (!spec) {
    // No frame profile (yet): the screen alone, in a plain dark rim.
    return (
      <div
        className="absolute inset-0 overflow-hidden rounded-[44px] bg-black shadow-[0_0_0_3px_#1c1c1e,0_0_0_3.5px_#3a3a3c]"
        style={{ filter: "var(--device-shadow)" }}
      >
        {screen}
      </div>
    );
  }
  const geometry = fitDeviceBezel({
    spec,
    rotation: 0,
    availWidth: DEVICE_BOX.width,
    availHeight: DEVICE_BOX.height,
    maxScreenWidth: Number.POSITIVE_INFINITY,
    maxScale: 1,
  });
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <DeviceBezel spec={spec} geometry={geometry}>
        {screen}
      </DeviceBezel>
    </div>
  );
}
