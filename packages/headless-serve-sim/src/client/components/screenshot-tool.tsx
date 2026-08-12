import { useCallback, useState } from "react";
import { Chevron } from "../icons";
import { SegmentedGroup } from "./design-system";
import {
  captureScreenshot,
  b64ToBlob,
  type Screenshot,
  type ScreenshotDisplay,
  type ScreenshotMask,
} from "../utils/screenshot";

// Screenshot tool card: pick display/mask options, capture via the shared
// helper, preview the PNG, then download or copy it. Capture mechanics (simctl,
// chunked base64 read-back) live in ../utils/screenshot.

const HOVER_CSS = `
.lem-primary:hover:not(:disabled) { filter: brightness(1.05); }
.lem-primary:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-accent-solid); }
.lem-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.lem-ghost:hover:not(:disabled) { background: var(--color-hover); }
.lem-ghost:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-accent-solid); }
.lem-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
`;

type Pending = "capture" | null;
type Display = ScreenshotDisplay;
type Mask = ScreenshotMask;
type Shot = Screenshot;

// clipboard.write / ClipboardItem only exist in a secure context, but this UI is
// also served to LAN clients over plain HTTP (see capture's note). Gate the Copy
// button on availability so it isn't shown broken — Download is the fallback.
const canCopyImage =
  typeof navigator !== "undefined" &&
  typeof navigator.clipboard?.write === "function" &&
  typeof ClipboardItem !== "undefined";

export function ScreenshotTool({ udid }: { udid: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [display, setDisplay] = useState<Display>("");
  const [mask, setMask] = useState<Mask>("");
  const [copied, setCopied] = useState(false);

  const capture = useCallback(async () => {
    setPending("capture");
    setError(null);
    setCopied(false);
    try {
      setShot(await captureScreenshot(udid, { display, mask }));
    } catch (e: any) {
      setError(e?.message ?? "screenshot failed");
    } finally {
      setPending(null);
    }
  }, [udid, display, mask]);

  const copy = useCallback(async () => {
    if (!shot) return;
    setError(null);
    try {
      const blob = b64ToBlob(shot.bytesB64, "image/png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e: any) {
      setError(e?.message ?? "Copy to clipboard failed");
    }
  }, [shot]);

  return (
    <div className="border-t border-divider bg-panel overflow-hidden">
      <style>{HOVER_CSS}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between gap-2.5 px-5 min-h-[56px] w-full cursor-pointer select-none bg-transparent border-none text-left [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent-solid)]"
        aria-expanded={open}
      >
        <span className="mr-auto text-body font-semibold text-fg text-fg">Screenshot</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="px-5 pb-4 pt-1 flex flex-col gap-3">
          {/* ─── Options ─── */}
          <ChipGroup
            label="Display"
            value={display}
            onChange={(v) => setDisplay(v as Display)}
            options={[
              ["", "Default"],
              ["internal", "Internal"],
              ["external", "External"],
            ]}
          />
          <ChipGroup
            label="Mask"
            value={mask}
            onChange={(v) => setMask(v as Mask)}
            options={[
              ["", "Default"],
              ["ignored", "Ignored"],
              ["alpha", "Alpha"],
              ["black", "Black"],
            ]}
          />

          {/* ─── Capture ─── */}
          <button
            type="button"
            onClick={capture}
            disabled={pending !== null}
            className="lem-primary inline-flex items-center justify-center gap-1.5 py-2 px-4 min-h-[32px] border-none rounded-card text-value font-semibold cursor-pointer font-[inherit] bg-accent-solid text-on-accent w-full [transition:filter_0.3s_cubic-bezier(0.4,0,0.6,1)]"
          >
            {pending === "capture" ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-white/80 animate-pulse" />
                Capturing…
              </span>
            ) : (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Capture
              </>
            )}
          </button>

          {/* ─── Result ─── */}
          {shot && (
            <div className="flex flex-col gap-2" role="group" aria-label="Captured screenshot">
              <img
                src={shot.dataUrl}
                alt="Simulator screenshot"
                className="w-full max-h-[220px] object-contain border border-divider rounded-card bg-surface-2"
              />
              <div className="flex gap-2">
                <a
                  href={shot.dataUrl}
                  download="screenshot.png"
                  className="lem-ghost flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 min-h-[32px] border border-divider rounded-card text-value font-medium bg-transparent text-fg-2 cursor-pointer font-[inherit] no-underline [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1)]"
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
                    className="text-fg-2"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download
                </a>
                {canCopyImage && (
                  <button
                    type="button"
                    onClick={copy}
                    className="lem-ghost flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 min-h-[32px] border border-divider rounded-card text-value font-medium bg-transparent text-fg-2 cursor-pointer font-[inherit] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1)]"
                    aria-label="Copy screenshot to clipboard"
                  >
                    {copied ? (
                      <>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-success"
                          aria-hidden="true"
                        >
                          <polyline points="5 12 10 17 19 7" />
                        </svg>
                        Copied
                      </>
                    ) : (
                      <>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-fg-2"
                          aria-hidden="true"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {error && (
            <div
              className="bg-surface-2 border border-divider rounded-card text-danger-soft text-value px-3 py-2 break-words"
              role="alert"
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function ChipGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <SegmentedGroup
      label={label}
      value={value}
      options={options.map(([val, text]) => ({ value: val, label: text }))}
      showValue={false}
      onChange={onChange}
    />
  );
}
