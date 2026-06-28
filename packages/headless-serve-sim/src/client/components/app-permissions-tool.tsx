import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Chevron, ReloadIcon } from "../icons";
import { execOnHost, shellEscape } from "../utils/exec";
import {
  PERMISSION_SERVICES,
  type PermAction,
  type PermState,
} from "../utils/permissions";

export function AppPermissionsTool({
  udid,
  bundleId,
}: {
  udid: string;
  bundleId: string | null;
}) {
  const [state, setState] = useState<PermState>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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
  useEffect(() => { setState({}); setError(null); }, [bundleId]);

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
          setError(res.stderr.trim() || `headless-serve-sim permissions failed (exit ${res.exitCode})`);
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
        setError(res.stderr.trim() || `headless-serve-sim permissions failed (exit ${res.exitCode})`);
        return;
      }
      setState({});
    } finally {
      setPending(null);
    }
  }, [cliPrefix, udid, bundleId]);

  if (!bundleId) {
    return (
      <div className="bg-panel border border-divider p-2 text-fg-3 text-[12px] text-center">
        Permissions appear once an app is in the foreground.
      </div>
    );
  }

  return (
    <div className="bg-panel border border-divider flex flex-col gap-1 px-2 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lem-toggle grid [grid-template-columns:auto_1fr_auto] items-center gap-2 bg-transparent border-none text-fg py-1.5 px-1 -my-1 -mx-1 cursor-pointer w-[calc(100%+8px)] text-left min-h-[36px] leading-none"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold text-fg-3 uppercase tracking-[0.08em] leading-none inline-flex items-center">Permissions</span>
        <span />
        <Chevron open={open} />
      </button>

      {open && error && (
        <div className="bg-panel-deep border border-divider text-danger-soft text-[11px] px-2 py-1.5 mt-1">
          {error}
        </div>
      )}

      {open && (
        <div className="relative mt-1">
          <div className="max-h-[260px] overflow-y-auto flex flex-col py-1 [scrollbar-width:thin]">
            {PERMISSION_SERVICES.map(({ key, label }) => {
              const current = state[key];
              return (
                <div key={key} className="flex items-center justify-between gap-2 px-0.5 py-1 border-b border-divider last:border-b-0">
                  <span className="text-[12px] text-fg overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">{label}</span>
                  <div
                    className="flex gap-0.5 bg-panel-deep border border-divider p-0.5"
                    role="group"
                    aria-label={label}
                  >
                    <PermBtn
                      active={current === "grant"}
                      pending={pending === `${key}:grant`}
                      onClick={() => apply(key, "grant")}
                      variant="grant"
                      title="Allow"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="5 12 10 17 19 7" />
                      </svg>
                    </PermBtn>
                    <PermBtn
                      active={current === "revoke"}
                      pending={pending === `${key}:revoke`}
                      onClick={() => apply(key, "revoke")}
                      variant="revoke"
                      title="Deny"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="6" y1="6" x2="18" y2="18" />
                        <line x1="18" y1="6" x2="6" y2="18" />
                      </svg>
                    </PermBtn>
                    <PermBtn
                      active={false}
                      pending={pending === `${key}:reset`}
                      onClick={() => apply(key, "reset")}
                      variant="reset"
                      title="Reset"
                    >
                      <ReloadIcon size={11} strokeWidth={2.4} />
                    </PermBtn>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="absolute top-0 left-0 right-0 h-[14px] pointer-events-none bg-[linear-gradient(to_bottom,#1d1d1f_0%,rgba(29,29,31,0)_100%)]" />
          <div className="absolute bottom-0 left-0 right-0 h-[14px] pointer-events-none bg-[linear-gradient(to_top,#1d1d1f_0%,rgba(29,29,31,0)_100%)]" />
        </div>
      )}

      {open && (
        <div className="flex justify-end pt-1">
          <button
            onClick={resetAll}
            disabled={pending === "__all__"}
            className="bg-transparent border border-divider text-fg-2 hover:bg-hover text-[10px] px-2 py-[3px] cursor-pointer uppercase tracking-[0.04em]"
            title="headless-serve-sim permissions reset all"
          >
            {pending === "__all__" ? "…" : "Reset all"}
          </button>
        </div>
      )}
    </div>
  );
}

function PermBtn({
  active,
  pending,
  onClick,
  variant,
  title,
  children,
}: {
  active: boolean;
  pending: boolean;
  onClick: () => void;
  variant: "grant" | "revoke" | "reset";
  title: string;
  children: ReactNode;
}) {
  const accent = variant === "grant" ? "#30d158" : variant === "revoke" ? "#ff453a" : "#2997ff";
  return (
    <button
      onClick={onClick}
      disabled={pending}
      title={title}
      aria-label={title}
      className="w-6 h-5.5 flex items-center justify-center border-none p-0 cursor-pointer [transition:background_0.12s,color_0.12s]"
      style={{
        background: active ? `${accent}22` : "transparent",
        color: active ? accent : "var(--color-fg-2)",
        opacity: pending ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
