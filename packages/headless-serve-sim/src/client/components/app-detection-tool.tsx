import { useEffect, useState, type ReactNode } from "react";
import { type AppDetails, fetchAppDetails } from "../utils/app-icon";
import { execOnHost, shellEscape } from "../utils/exec";
import { Chevron } from "../icons";

export function AppDetectionTool({
  udid,
  currentApp,
}: {
  udid: string;
  currentApp: { bundleId: string; isReactNative: boolean; pid?: number } | null;
}) {
  const [details, setDetails] = useState<AppDetails | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!currentApp) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    setDetails({
      bundleId: currentApp.bundleId,
      isReactNative: currentApp.isReactNative,
      pid: currentApp.pid,
      loading: true,
    });
    void fetchAppDetails(execOnHost, udid, currentApp.bundleId).then((extra) => {
      if (cancelled) return;
      setDetails({
        bundleId: currentApp.bundleId,
        isReactNative: currentApp.isReactNative,
        pid: currentApp.pid,
        loading: false,
        ...extra,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [udid, currentApp, currentApp?.bundleId, currentApp?.pid, currentApp?.isReactNative]);

  if (!details) {
    return (
      <div className="bg-panel px-5 py-4 text-center text-body text-fg-3">
        Waiting for an app to come to the foreground…
      </div>
    );
  }

  return (
    <div className="border-t border-divider bg-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="lem-toggle flex items-center gap-3 bg-transparent border-none text-fg px-5 py-3 cursor-pointer w-full text-left min-h-[56px] [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent-solid)]"
        aria-expanded={open}
      >
        {/* Two lines, not three: the section's name, then the app's. The bundle
            id is reference data and lives in the body with the rest of it. An
            icon appears only when there is one — an empty placeholder box is
            just a hole in the layout. */}
        <div className="min-w-0 flex-1">
          <div className="text-body font-semibold text-fg text-fg">Current App</div>
          <div className="mt-1 truncate text-body text-fg-2">
            {details.displayName ?? details.bundleId}
            {details.loading && <span className="text-fg-3"> …</span>}
          </div>
        </div>
        {details.iconDataUrl && (
          <img
            src={details.iconDataUrl}
            className="size-9 shrink-0 rounded-sm object-cover"
            alt=""
          />
        )}
        <Chevron open={open} />
      </button>

      {open && (
        <div className="px-5 pb-4 pt-1 flex flex-col gap-3">
          {details.error && (
            <div className="bg-surface-2 border border-divider rounded-card text-danger text-value px-3 py-2">
              {details.error}
            </div>
          )}

          <dl className="m-0 flex flex-col gap-2">
            <Row label="Bundle ID" value={details.bundleId} />
            <Row
              label="Version"
              value={
                details.shortVersion
                  ? `${details.shortVersion} (${details.bundleVersion ?? "—"})`
                  : details.loading
                    ? "…"
                    : "—"
              }
            />
            <Row label="Min iOS" value={details.minOS ?? (details.loading ? "…" : "—")} />
            <Row label="Executable" value={details.executable ?? (details.loading ? "…" : "—")} />
            <Row label="PID" value={details.pid != null ? String(details.pid) : "—"} />
            {details.isReactNative && <Row label="React Native" value="Yes" />}
            <Row
              label="App path"
              value={details.appPath ?? (details.loading ? "…" : "—")}
              action={
                details.appPath
                  ? {
                      title: "Reveal in Finder",
                      onClick: () => {
                        void execOnHost(`open -R ${shellEscape(details.appPath!)}`);
                      },
                      icon: (
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="7" y1="17" x2="17" y2="7" />
                          <polyline points="10 7 17 7 17 14" />
                        </svg>
                      ),
                    }
                  : undefined
              }
            />
          </dl>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: { title: string; onClick: () => void; icon: ReactNode };
}) {
  return (
    <div className="group flex items-baseline gap-2 min-w-0">
      <dt className="m-0 w-24 shrink-0 text-value text-fg-3">{label}</dt>
      <dd
        className="m-0 flex-1 min-w-0 relative font-mono text-value text-fg break-all line-clamp-2"
        title={value}
      >
        {value}
        {action && (
          <div className="absolute top-0 right-0 bottom-0 pl-7 flex items-center justify-end bg-[linear-gradient(to_right,transparent_0%,var(--color-panel)_55%)] [transition:opacity_0.24s_cubic-bezier(0.4,0,0.6,1),transform_0.3s_cubic-bezier(0.4,0,0.6,1)] opacity-0 translate-x-1 pointer-events-none group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-x-0 group-focus-within:pointer-events-auto">
            <button
              type="button"
              onClick={action.onClick}
              title={action.title}
              aria-label={action.title}
              className="w-6 h-6 flex items-center justify-center bg-transparent border-none text-accent rounded-full cursor-pointer p-0 [transition:background-color_0.3s_cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
            >
              {action.icon}
            </button>
          </div>
        )}
      </dd>
    </div>
  );
}
