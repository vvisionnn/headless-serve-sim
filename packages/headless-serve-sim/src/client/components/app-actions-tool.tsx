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
.lem-toggle:hover { color: #fff; }
.lem-toggle:hover .lem-chevron { color: rgba(255,255,255,0.85) !important; }
.lem-input:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.16); }
.lem-input:focus { outline: none; border-color: rgba(255,255,255,0.24); background: rgba(255,255,255,0.08); }
.lem-primary:hover:not(:disabled) { filter: brightness(1.08); }
.lem-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.lem-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.2); color: #fff; }
.lem-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.lem-danger:hover:not(:disabled) { background: rgba(248,113,113,0.18); border-color: rgba(248,113,113,0.5); }
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
    <div className="bg-panel border border-white/8 rounded-[10px] flex flex-col gap-2.5 px-3 py-2">
      <style>{HOVER_CSS}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lem-toggle grid [grid-template-columns:auto_1fr_auto] items-center gap-2 bg-transparent border-none text-white/90 py-2.5 px-1 -my-2 -mx-1 cursor-pointer w-[calc(100%+8px)] text-left min-h-[36px] leading-none"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold text-white/50 uppercase tracking-[0.08em] leading-none inline-flex items-center">
          App Actions
        </span>
        <span />
        <Chevron open={open} />
      </button>

      {open && (
        <>
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
                className="lem-input flex-1 min-w-0 appearance-none bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] font-mono py-1.5 px-2 font-[inherit] [transition:background_0.12s,border-color_0.12s]"
                aria-label="URL to open"
              />
              <button
                type="button"
                onClick={openUrl}
                disabled={pending !== null || !urlText.trim()}
                className="lem-primary inline-flex items-center justify-center py-1.5 px-3 border-none rounded-[7px] text-[12px] font-semibold cursor-pointer font-[inherit] bg-accent text-[#0b1020]"
              >
                {pending === "open" ? "…" : "Open"}
              </button>
            </div>
          </Section>

          <div className="h-px bg-white/8" />

          {/* ─── Push ─── */}
          <Section label="Push notification">
            <input
              type="text"
              value={pushBundle}
              onChange={(e) => setPushBundle((e.target as HTMLInputElement).value)}
              placeholder="com.example.app"
              spellCheck={false}
              className="lem-input appearance-none bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] font-mono py-1.5 px-2 font-[inherit] w-full [transition:background_0.12s,border-color_0.12s]"
              aria-label="Push target bundle id"
            />
            <textarea
              value={payloadText}
              onChange={(e) => setPayloadText((e.target as HTMLTextAreaElement).value)}
              rows={3}
              spellCheck={false}
              className="lem-input appearance-none resize-y bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] font-mono leading-[1.5] py-1.5 px-2 font-[inherit] w-full [transition:background_0.12s,border-color_0.12s]"
              aria-label="Push payload JSON"
            />
            <div className="flex">
              <button
                type="button"
                onClick={sendPush}
                disabled={pending !== null || !pushBundle.trim()}
                className="lem-primary inline-flex items-center justify-center py-1.5 px-3 border-none rounded-[7px] text-[12px] font-semibold cursor-pointer font-[inherit] bg-accent text-[#0b1020]"
              >
                {pending === "push" ? "…" : "Send"}
              </button>
            </div>
          </Section>

          <div className="h-px bg-white/8" />

          {/* ─── Keychain ─── */}
          <Section label="Keychain">
            {confirmReset ? (
              <div className="flex items-center gap-2 bg-danger/10 border border-danger/20 rounded-md px-2 py-1.5">
                <span className="flex-1 min-w-0 text-[11px] text-danger-soft leading-[1.4]">
                  Reset the device keychain? This clears all stored credentials.
                </span>
                <button
                  type="button"
                  onClick={resetKeychain}
                  disabled={pending !== null}
                  className="lem-danger shrink-0 inline-flex items-center justify-center py-1 px-2.5 rounded-[6px] text-[11px] font-semibold cursor-pointer font-[inherit] bg-danger/15 border border-danger/40 text-danger-soft [transition:background_0.12s,border-color_0.12s]"
                >
                  {pending === "keychain" ? "…" : "Reset"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  disabled={pending !== null}
                  className="lem-ghost shrink-0 inline-flex items-center justify-center py-1 px-2.5 border border-white/12 rounded-[6px] text-[11px] font-medium bg-transparent text-white/85 cursor-pointer font-[inherit] [transition:background_0.12s,border-color_0.12s,color_0.12s]"
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
                className="lem-ghost inline-flex items-center gap-1.5 py-1.5 px-2.5 border border-white/12 rounded-[7px] text-[12px] font-medium bg-transparent text-white/85 cursor-pointer font-[inherit] [transition:background_0.12s,border-color_0.12s,color_0.12s] self-start"
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
            <div className="bg-danger/10 border border-danger/20 text-danger-soft text-[11px] px-2 py-1.5 rounded-md break-words" role="alert">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <span className="text-[9px] uppercase tracking-[0.06em] text-white/45">{label}</span>
      {children}
    </div>
  );
}
