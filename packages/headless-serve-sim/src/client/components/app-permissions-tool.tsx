import { Check, Minus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Row, Section } from "../ui/group";
import { Segmented } from "../ui/segmented";
import { execOnHost, shellEscape } from "../utils/exec";
import { PERMISSION_SERVICES, type PermAction, type PermState } from "../utils/permissions";

/** The control's tri-state, in the words it shows: Allow / Deny / Not set. */
export type PermSegment = "allow" | "deny" | "unset";

export function segmentForAction(action: PermAction | undefined): PermSegment {
  return action === "grant" ? "allow" : action === "revoke" ? "deny" : "unset";
}

export function actionForSegment(segment: PermSegment): PermAction {
  return segment === "allow" ? "grant" : segment === "deny" ? "revoke" : "reset";
}

const SEGMENTS = [
  { value: "allow" as const, icon: <Check />, title: "Allow" },
  { value: "deny" as const, icon: <X />, title: "Deny" },
  { value: "unset" as const, icon: <Minus />, title: "Not set" },
];

export function AppPermissionsTool({ udid, bundleId }: { udid: string; bundleId: string | null }) {
  const [state, setState] = useState<PermState>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The `headless-serve-sim permissions` subcommand handles the stores `simctl privacy`
  // can't (push notifications via BulletinBoard, location's `i<bundleId>:`
  // clients.plist keys), so the UI drives it instead of calling simctl directly.
  const cliPrefix = useMemo(() => {
    const bin = window.__SIM_PREVIEW__?.serveSimBin;
    if (!bin) return "headless-serve-sim";
    if (/\.ts$/.test(bin)) return `bun ${shellEscape(bin)}`;
    if (/\.js$/.test(bin)) return `node ${shellEscape(bin)}`;
    return shellEscape(bin);
  }, []);

  // Reset assumed state whenever the foreground app changes.
  useEffect(() => {
    setState({});
    setError(null);
  }, [bundleId]);

  const apply = useCallback(
    async (service: string, action: PermAction) => {
      if (!bundleId) return;
      const key = `${service}:${action}`;
      setPending(key);
      setError(null);
      try {
        const res = await execOnHost(
          `${cliPrefix} permissions ${action} ${service} ${shellEscape(bundleId)} -d ${shellEscape(udid)}`,
        );
        if (res.exitCode !== 0) {
          setError(
            res.stderr.trim() || `headless-serve-sim permissions failed (exit ${res.exitCode})`,
          );
          return;
        }
        setState((s) => ({ ...s, [service]: action === "reset" ? undefined : action }));
      } finally {
        setPending(null);
      }
    },
    [cliPrefix, udid, bundleId],
  );

  const resetAll = useCallback(async () => {
    if (!bundleId) return;
    setPending("__all__");
    setError(null);
    try {
      const res = await execOnHost(
        `${cliPrefix} permissions reset all ${shellEscape(bundleId)} -d ${shellEscape(udid)}`,
      );
      if (res.exitCode !== 0) {
        setError(
          res.stderr.trim() || `headless-serve-sim permissions failed (exit ${res.exitCode})`,
        );
        return;
      }
      setState({});
    } finally {
      setPending(null);
    }
  }, [cliPrefix, udid, bundleId]);

  if (!bundleId) {
    return (
      <Section title="Permissions">
        <div className="row px-3 py-3 text-center text-footnote text-label-3">
          Permissions appear once an app is in the foreground.
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Permissions"
      accessory={
        <Button
          variant="plain"
          size="sm"
          disabled={pending === "__all__"}
          onClick={resetAll}
          title="headless-serve-sim permissions reset all"
        >
          {pending === "__all__" ? "Resetting…" : "Reset all"}
        </Button>
      }
    >
      {error && (
        <div className="row px-3 py-2 text-footnote text-red [overflow-wrap:anywhere]" role="alert">
          {error}
        </div>
      )}
      {PERMISSION_SERVICES.map(({ key, label }) => {
        const busy = pending?.startsWith(`${key}:`) || pending === "__all__";
        return (
          <Row key={key} label={label} className="min-h-9 py-1.5">
            <Segmented
              aria-label={label}
              size="sm"
              className="w-[96px]"
              value={segmentForAction(state[key])}
              onChange={(v) => {
                if (!busy) void apply(key, actionForSegment(v));
              }}
              items={SEGMENTS}
            />
          </Row>
        );
      })}
    </Section>
  );
}
