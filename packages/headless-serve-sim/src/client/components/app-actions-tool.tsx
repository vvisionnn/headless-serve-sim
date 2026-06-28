import { useCallback, useEffect, useMemo, useState } from "react";
import { Chevron } from "../icons";
import { execOnHost, shellEscape } from "../utils/exec";

// Drives the `headless-serve-sim app-actions` passthrough: Open URL runs
// `app-actions open-url`, Send runs `app-actions push <bundle> --payload <json>`
// (the CLI pipes the JSON to `simctl push … -` via stdin), and Reset Keychain
// runs `app-actions keychain-reset`. The card sends inline JSON; every user
// token is shellEscape'd (udid is a trusted UUID and stays raw).

// Inline hover styles — :hover/:focus/:disabled can't live in inline `style`,
// so emit a small sheet keyed off the shared lem-* classnames. Mirrors
// status-bar-tool.tsx / user-defaults-tool.tsx so the look stays consistent.
const HOVER_CSS = `
.lem-toggle:hover { color: var(--color-accent); }
.lem-toggle:hover .lem-chevron { color: var(--color-accent) !important; }
.lem-input:hover { background: var(--color-surface-3); border-color: var(--color-fg-3); }
.lem-input:focus { outline: none; border-color: var(--color-accent-solid); background: var(--color-panel); box-shadow: 0 0 0 2px var(--color-accent-solid); }
.lem-primary:hover:not(:disabled) { filter: brightness(1.05); }
.lem-primary:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-accent-solid); }
.lem-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.lem-ghost:hover:not(:disabled) { background: var(--color-hover); }
.lem-ghost:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-accent-solid); }
.lem-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.lem-danger:hover:not(:disabled) { background: var(--color-hover); border-color: var(--color-danger); }
.lem-danger:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-accent-solid); }
.lem-danger:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const DEFAULT_PAYLOAD = '{"aps":{"alert":"Hello"}}';

type Pending = "open" | "push" | "keychain" | null;

export function AppActionsTool({
  udid,
  bundleId,
}: {
  udid: string;
  bundleId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [urlText, setUrlText] = useState("");
  const [pushBundle, setPushBundle] = useState(bundleId ?? "");
  const [payloadText, setPayloadText] = useState(DEFAULT_PAYLOAD);
  const [confirmReset, setConfirmReset] = useState(false);

  // Resolve the in-page CLI runner the same way app-permissions-tool does, so
  // the card drives the `app-actions` passthrough rather than simctl directly.
  const cliPrefix = useMemo(() => {
    const bin = window.__SIM_PREVIEW__?.serveSimBin;
    if (!bin) return "headless-serve-sim";
    if (/\.ts$/.test(bin)) return `bun ${shellEscape(bin)}`;
    if (/\.js$/.test(bin)) return `node ${shellEscape(bin)}`;
    return shellEscape(bin);
  }, []);

  // Re-seed the push bundle id whenever the foreground app changes.
  useEffect(() => {
    setPushBundle(bundleId ?? "");
    setError(null);
    setConfirmReset(false);
  }, [bundleId]);

  const openUrl = useCallback(async () => {
    const url = urlText.trim();
    if (!url) {
      setError("Enter a URL to open.");
      return;
    }
    setPending("open");
    setError(null);
    try {
      const res = await execOnHost(
        `${cliPrefix} app-actions open-url ${shellEscape(url)} -d ${shellEscape(udid)}`,
      );
      if (res.exitCode !== 0) {
        setError(res.stderr.trim() || `open-url failed (exit ${res.exitCode})`);
      }
    } finally {
      setPending(null);
    }
  }, [cliPrefix, udid, urlText]);

  const sendPush = useCallback(async () => {
    const bundle = pushBundle.trim();
    if (!bundle) {
      setError("Enter a bundle id to push to.");
      return;
    }
    const payload = payloadText.trim();
    if (!payload) {
      setError("Enter a JSON payload to send.");
      return;
    }
    setPending("push");
    setError(null);
    try {
      const res = await execOnHost(
        `${cliPrefix} app-actions push ${shellEscape(bundle)} --payload ${shellEscape(payload)} -d ${shellEscape(udid)}`,
      );
      if (res.exitCode !== 0) {
        setError(res.stderr.trim() || `push failed (exit ${res.exitCode})`);
      }
    } finally {
      setPending(null);
    }
  }, [cliPrefix, udid, pushBundle, payloadText]);

  const resetKeychain = useCallback(async () => {
    setPending("keychain");
    setError(null);
    try {
      const res = await execOnHost(
        `${cliPrefix} app-actions keychain-reset -d ${shellEscape(udid)}`,
      );
      if (res.exitCode !== 0) {
        setError(res.stderr.trim() || `keychain-reset failed (exit ${res.exitCode})`);
        return;
      }
      setConfirmReset(false);
    } finally {
      setPending(null);
    }
  }, [cliPrefix, udid]);

  return (
    <div className="bg-panel border border-divider rounded-card overflow-hidden">
      <style>{HOVER_CSS}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lem-toggle flex items-center justify-between gap-2.5 px-3.5 min-h-[44px] w-full text-left bg-transparent border-none cursor-pointer select-none [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent-solid)]"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">
          App Actions
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="border-t border-divider px-3.5 py-3 flex flex-col gap-2">
          {/* ─── Open URL ─── */}
          <Section label="Open URL">
            <div className="flex items-end gap-2">
              <input
                type="text"
                value={urlText}
                onChange={(e) => setUrlText((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openUrl();
                }}
                placeholder="https://example.com or myapp://path"
                spellCheck={false}
                className="lem-input flex-1 min-w-0 appearance-none rounded-card bg-surface-3 border border-divider text-fg text-[12px] font-mono py-2 px-2.5 font-[inherit] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.3s_cubic-bezier(0.4,0,0.6,1)]"
                aria-label="URL to open"
              />
              <button
                type="button"
                onClick={openUrl}
                disabled={pending !== null || !urlText.trim()}
                className="lem-primary inline-flex items-center justify-center rounded-pill py-2 px-4 border-none text-[12px] font-semibold cursor-pointer font-[inherit] bg-accent-solid text-white min-h-[32px] [transition:filter_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.3s_cubic-bezier(0.4,0,0.6,1)]"
              >
                {pending === "open" ? "…" : "Open"}
              </button>
            </div>
          </Section>

          <div className="h-px bg-divider" />

          {/* ─── Push ─── */}
          <Section label="Push notification">
            <input
              type="text"
              value={pushBundle}
              onChange={(e) => setPushBundle((e.target as HTMLInputElement).value)}
              placeholder="com.example.app"
              spellCheck={false}
              className="lem-input appearance-none rounded-card bg-surface-3 border border-divider text-fg text-[12px] font-mono py-2 px-2.5 font-[inherit] w-full [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.3s_cubic-bezier(0.4,0,0.6,1)]"
              aria-label="Push target bundle id"
            />
            <textarea
              value={payloadText}
              onChange={(e) => setPayloadText((e.target as HTMLTextAreaElement).value)}
              rows={3}
              spellCheck={false}
              className="lem-input appearance-none resize-y rounded-card bg-surface-3 border border-divider text-fg text-[12px] font-mono leading-[1.5] py-2 px-2.5 font-[inherit] w-full [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.3s_cubic-bezier(0.4,0,0.6,1)]"
              aria-label="Push payload JSON"
            />
            <div className="flex">
              <button
                type="button"
                onClick={sendPush}
                disabled={pending !== null || !pushBundle.trim()}
                className="lem-primary inline-flex items-center justify-center rounded-pill py-2 px-4 border-none text-[12px] font-semibold cursor-pointer font-[inherit] bg-accent-solid text-white min-h-[32px] [transition:filter_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.3s_cubic-bezier(0.4,0,0.6,1)]"
              >
                {pending === "push" ? "…" : "Send"}
              </button>
            </div>
          </Section>

          <div className="h-px bg-divider" />

          {/* ─── Keychain ─── */}
          <Section label="Keychain">
            {confirmReset ? (
              <div className="flex items-center gap-2 rounded-card bg-surface-2 border border-divider px-3 py-2.5">
                <span className="flex-1 min-w-0 text-[12px] text-danger leading-[1.4]">
                  Reset the device keychain? This clears all stored credentials.
                </span>
                <button
                  type="button"
                  onClick={resetKeychain}
                  disabled={pending !== null}
                  className="lem-danger shrink-0 inline-flex items-center justify-center rounded-pill py-1.5 px-3 text-[12px] font-semibold cursor-pointer font-[inherit] bg-transparent border border-divider text-danger min-h-[32px] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.3s_cubic-bezier(0.4,0,0.6,1)]"
                >
                  {pending === "keychain" ? "…" : "Reset"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  disabled={pending !== null}
                  className="lem-ghost shrink-0 inline-flex items-center justify-center rounded-pill py-1.5 px-3 border border-divider text-[12px] font-medium bg-transparent text-fg cursor-pointer font-[inherit] min-h-[32px] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.3s_cubic-bezier(0.4,0,0.6,1)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setConfirmReset(true);
                }}
                disabled={pending !== null}
                className="lem-ghost inline-flex items-center gap-1.5 rounded-pill py-2 px-3 border border-divider text-[12px] font-medium bg-transparent text-fg cursor-pointer font-[inherit] min-h-[32px] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.3s_cubic-bezier(0.4,0,0.6,1)] self-start"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Reset Keychain
              </button>
            )}
          </Section>

          {error && (
            <div className="rounded-card bg-surface-2 border border-divider text-danger text-[12px] px-3 py-2.5 break-words" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <span className="text-[12px] uppercase tracking-[0.06em] text-fg-3">{label}</span>
      {children}
    </div>
  );
}
