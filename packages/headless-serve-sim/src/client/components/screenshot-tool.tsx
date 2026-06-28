import { useCallback, useState } from "react";
import { Chevron } from "../icons";
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
.lem-chip { background: transparent; color: var(--color-fg-2); }
.lem-chip:hover:not([data-active="true"]) { background: var(--color-hover); color: var(--color-fg); }
.lem-chip:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-accent-solid); }
.lem-chip[data-active="true"] { background: var(--color-panel); color: var(--color-fg); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
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
    <div className="bg-panel border border-divider rounded-card overflow-hidden">
      <style>{HOVER_CSS}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between gap-2.5 px-3.5 min-h-[44px] w-full cursor-pointer select-none bg-transparent border-none text-left [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent-solid)]"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">
          Screenshot
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="border-t border-divider px-3.5 py-3 flex flex-col gap-2">
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
            className="lem-primary inline-flex items-center justify-center gap-1.5 py-2 px-4 min-h-[32px] border-none rounded-pill text-[12px] font-semibold cursor-pointer font-[inherit] bg-accent-solid text-white w-full tracking-[-0.01em] [transition:filter_0.3s_cubic-bezier(0.4,0,0.6,1)]"
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
                  className="lem-ghost flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 min-h-[32px] border border-divider rounded-pill text-[12px] font-medium bg-transparent text-fg-2 cursor-pointer font-[inherit] no-underline tracking-[-0.01em] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1)]"
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
                  className="lem-ghost flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 min-h-[32px] border border-divider rounded-pill text-[12px] font-medium bg-transparent text-fg-2 cursor-pointer font-[inherit] tracking-[-0.01em] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1)]"
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
            <div className="bg-surface-2 border border-divider rounded-card text-danger-soft text-[12px] px-3 py-2 break-words tracking-[-0.01em]" role="alert">
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
    <div className="flex items-center gap-2.5" role="group" aria-label={label}>
      <span className="text-[12px] text-fg-3 w-[48px] shrink-0 tracking-[-0.01em]">
        {label}
      </span>
      <div className="flex gap-0.5 bg-surface-2 border border-divider rounded-pill p-0.5 flex-1">
        {options.map(([val, text]) => (
          <button
            key={val}
            type="button"
            data-active={value === val}
            onClick={() => onChange(val)}
            className="lem-chip flex-1 min-w-0 truncate py-1.5 px-2 min-h-[28px] border-none rounded-pill text-[11px] font-medium cursor-pointer font-[inherit] tracking-[-0.01em] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1)]"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
