import { AppWindow, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../ui/badge";
import { IconButton } from "../ui/button";
import { InfoRow } from "../ui/group";
import { type AppDetails, fetchAppDetails } from "../utils/app-icon";
import { execOnHost, shellEscape } from "../utils/exec";

/** "2.4.1 (318)" — short version with the build in parentheses. */
export function formatVersion(
  details: Pick<AppDetails, "shortVersion" | "bundleVersion" | "loading">,
): string {
  if (details.shortVersion) return `${details.shortVersion} (${details.bundleVersion ?? "—"})`;
  return details.loading ? "…" : "—";
}

export function AppDetectionTool({
  udid,
  currentApp,
}: {
  udid: string;
  currentApp: { bundleId: string; isReactNative: boolean; pid?: number } | null;
}) {
  const [details, setDetails] = useState<AppDetails | null>(() =>
    currentApp
      ? {
          bundleId: currentApp.bundleId,
          isReactNative: currentApp.isReactNative,
          pid: currentApp.pid,
          loading: true,
        }
      : null,
  );

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
      <div className="group-box">
        <div className="row px-3 py-6 text-center text-footnote text-label-3">
          Waiting for an app to come to the foreground…
        </div>
      </div>
    );
  }

  const pending = (v: string | undefined) => v ?? (details.loading ? "…" : "—");

  return (
    <div className="group-box overflow-hidden">
      <div className="row flex items-center gap-3 px-3 py-3">
        {details.iconDataUrl ? (
          <img
            src={details.iconDataUrl}
            alt=""
            className="size-[52px] shrink-0 rounded-[12px] object-cover shadow-[0_0_0_0.5px_var(--separator)]"
          />
        ) : (
          <span className="flex size-[52px] shrink-0 items-center justify-center rounded-[12px] bg-fill-2 text-label-2">
            <AppWindow className="size-[22px]" strokeWidth={1.75} />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={
              details.loading && !details.displayName
                ? "shimmer-text text-title3"
                : "text-title3 text-label [overflow-wrap:anywhere]"
            }
          >
            {details.displayName ?? details.bundleId}
          </span>
          <span className="font-mono text-caption text-label-3 [overflow-wrap:anywhere]">
            {details.bundleId}
          </span>
          <span className="flex flex-wrap gap-1">
            {details.isReactNative && <Badge>React Native</Badge>}
            <Badge tone="green" dot>
              Running
            </Badge>
          </span>
        </div>
      </div>
      {details.error && (
        <div className="row px-3 py-2 text-footnote text-red [overflow-wrap:anywhere]">
          {details.error}
        </div>
      )}
      <InfoRow label="Version" value={formatVersion(details)} />
      <InfoRow label="Minimum OS" value={pending(details.minOS)} />
      <InfoRow label="Executable" value={pending(details.executable)} />
      <InfoRow label="PID" value={details.pid != null ? String(details.pid) : "—"} />
      <InfoRow
        label="Path"
        value={
          <span className="line-clamp-3" title={details.appPath}>
            {pending(details.appPath)}
          </span>
        }
        action={
          details.appPath ? (
            <IconButton
              label="Reveal in Finder"
              title="Reveal in Finder"
              size="sm"
              className="-my-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => {
                void execOnHost(`open -R ${shellEscape(details.appPath!)}`);
              }}
            >
              <FolderOpen />
            </IconButton>
          ) : undefined
        }
      />
    </div>
  );
}
