import { AnimatePresence, motion } from "motion/react";
import { KeyRound, Link, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { spring } from "../lib/motion";
import { useOptionalShell } from "../shell/shell-context";
import { Button } from "../ui/button";
import { TextArea, TextField } from "../ui/field";
import { Section } from "../ui/group";
import { execOnHost, shellEscape } from "../utils/exec";

// Drives the `headless-serve-sim app-actions` passthrough: Open URL runs
// `app-actions open-url`, Send runs `app-actions push <bundle> --payload <json>`
// (the CLI pipes the JSON to `simctl push … -` via stdin), and Reset Keychain
// runs `app-actions keychain-reset`. The card sends inline JSON; every user
// token is shellEscape'd (udid is a trusted UUID and stays raw).

const DEFAULT_PAYLOAD = '{"aps":{"alert":"Hello"}}';

type Pending = "open" | "push" | "keychain" | null;

const morph = (dir: 1 | -1) => ({
  initial: { opacity: 0, y: 6 * dir, filter: "blur(3px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -6 * dir, filter: "blur(3px)" },
  transition: spring.ui,
});

export function AppActionsTool({ udid, bundleId }: { udid: string; bundleId: string | null }) {
  const shell = useOptionalShell();
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
        return;
      }
      shell?.toast({ title: "Opened URL", detail: url, tone: "success" });
    } finally {
      setPending(null);
    }
  }, [cliPrefix, udid, urlText, shell]);

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
        return;
      }
      shell?.toast({ title: "Notification sent", detail: bundle, tone: "success" });
    } finally {
      setPending(null);
    }
  }, [cliPrefix, udid, pushBundle, payloadText, shell]);

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
      shell?.toast({
        title: "Keychain reset",
        detail: shell.device?.name ?? undefined,
        tone: "danger",
      });
    } finally {
      setPending(null);
    }
  }, [cliPrefix, udid, shell]);

  return (
    <Section title="Actions">
      <div className="row flex flex-col gap-2 px-3 py-2.5">
        <ActionLabel icon={<Link />}>Open URL</ActionLabel>
        <div className="flex gap-1.5">
          <TextField
            mono
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void openUrl();
            }}
            placeholder="https://… or myapp://path"
            spellCheck={false}
            aria-label="URL to open"
            className="flex-1"
          />
          <Button
            variant="secondary"
            disabled={pending !== null || !urlText.trim()}
            onClick={openUrl}
          >
            {pending === "open" ? "Opening…" : "Open"}
          </Button>
        </div>
      </div>

      <div className="row flex flex-col gap-2 px-3 py-2.5">
        <ActionLabel icon={<Send />}>Push notification</ActionLabel>
        <TextField
          mono
          value={pushBundle}
          onChange={(e) => setPushBundle(e.target.value)}
          placeholder="com.example.app"
          spellCheck={false}
          aria-label="Push target bundle id"
        />
        <TextArea
          rows={4}
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
          spellCheck={false}
          aria-label="Push payload JSON"
        />
        <div className="flex justify-end">
          <Button
            variant="primary"
            icon={<Send />}
            disabled={pending !== null || !pushBundle.trim()}
            onClick={sendPush}
          >
            {pending === "push" ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>

      <div className="row flex min-h-11 items-center gap-2 px-3 py-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {confirmReset ? (
            <motion.div key="confirm" className="flex w-full items-center gap-1.5" {...morph(1)}>
              <span className="flex-1 text-footnote text-label-2">
                Clears every stored credential.
              </span>
              <Button
                variant="plain"
                size="sm"
                disabled={pending !== null}
                onClick={() => setConfirmReset(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={pending !== null}
                onClick={resetKeychain}
              >
                {pending === "keychain" ? "Resetting…" : "Reset keychain"}
              </Button>
            </motion.div>
          ) : (
            <motion.div key="idle" className="flex w-full items-center gap-2" {...morph(-1)}>
              <span className="flex-1">
                <ActionLabel icon={<KeyRound />}>Keychain</ActionLabel>
              </span>
              <Button
                variant="destructive"
                size="sm"
                disabled={pending !== null}
                onClick={() => {
                  setError(null);
                  setConfirmReset(true);
                }}
              >
                Reset…
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {error && (
        <div className="row px-3 py-2 text-footnote text-red [overflow-wrap:anywhere]" role="alert">
          {error}
        </div>
      )}
    </Section>
  );
}

function ActionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-body font-medium text-label [&_svg]:size-[13px] [&_svg]:stroke-[2] [&_svg]:text-label-3">
      {icon}
      {children}
    </span>
  );
}
