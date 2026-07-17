import { SettingSwitch } from "./setting-switch";

// Shown when auto-connect is OFF and the pinned simulator disconnects. Unlike
// the auto-connect path, the view deliberately stays with this simulator and
// resumes on its own once the same device is available again — it never
// re-targets a different booted simulator. Per product, it avoids the word
// "reconnecting".
//
// The auto-connect switch lives here too (not just in the inspector, which is
// unmounted while disconnected) so the setting is reachable at the exact moment
// a user might want to switch it on. It's only offered when turning it on would
// actually do something — a URL-pinned session never hops regardless.
export function SimulatorDisconnected({
  deviceName,
  onChooseAnother,
  autoConnect = false,
  onAutoConnectChange,
  canAutoConnect = false,
}: {
  deviceName: string | null;
  onChooseAnother: () => void;
  autoConnect?: boolean;
  onAutoConnectChange?: (next: boolean) => void;
  canAutoConnect?: boolean;
}) {
  const name = deviceName ?? "This simulator";
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-page p-4 font-system box-border">
      <div className="flex w-full max-w-100 flex-col items-center gap-3 rounded-card border border-divider bg-panel-deep px-6 py-8 text-center">
        {/* Small solid status dot — orange reads as "waiting", not an error. */}
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: "var(--color-warning)" }} />
        <h1 className="m-0 font-display text-[20px] font-semibold tracking-[-0.01em] text-fg">
          {name} disconnected
        </h1>
        <p className="m-0 max-w-90 text-[14px] tracking-[-0.01em] text-fg-2">
          Auto-connect is off, so the view stays with this simulator. It resumes on its own
          once {name} is available again.
        </p>
        <button
          type="button"
          onClick={onChooseAnother}
          className="mt-1 cursor-pointer rounded-pill border border-divider bg-panel px-4 py-2 text-[13px] font-medium text-fg [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
        >
          Choose another simulator
        </button>
        {canAutoConnect && onAutoConnectChange && (
          <div className="mt-2 flex items-center gap-2.5 border-t border-divider pt-3">
            <span className="text-[13px] text-fg-2">Auto-connect to another simulator</span>
            <SettingSwitch
              label="Auto-connect to another simulator"
              checked={autoConnect}
              onChange={onAutoConnectChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
