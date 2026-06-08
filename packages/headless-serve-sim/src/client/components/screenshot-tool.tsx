import { useCallback, useState } from "react";
import { Chevron } from "../icons";
import { execOnHost, shellEscape } from "../utils/exec";

// Drives `xcrun simctl io <udid> screenshot` directly (the io primitive needs
// no privileged store, so the card calls simctl rather than a passthrough).
// Capture stages a PNG to /tmp, reads it back over /exec as base64, previews
// it, then removes the temp file. The CLI verb exposes the full --type enum;
// the card pins type=png so the in-browser Blob/ClipboardItem MIME and the
// data-URL preview match the bytes exactly (jpeg/tiff/bmp would break that).

const HOVER_CSS = `
.lem-toggle:hover { color: #fff; }
.lem-toggle:hover .lem-chevron { color: rgba(255,255,255,0.85) !important; }
.lem-primary:hover:not(:disabled) { filter: brightness(1.08); }
.lem-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.lem-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.2); color: #fff; }
.lem-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.lem-chip { background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.55); }
.lem-chip:hover:not([data-active="true"]) { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.8); }
.lem-chip[data-active="true"] { background: rgba(165,180,252,0.18); color: #a5b4fc; }
`;

type Pending = "capture" | null;
type Display = "" | "internal" | "external";
type Mask = "" | "ignored" | "alpha" | "black";

// Raw-byte slice size for the chunked base64 read-back. Must be a multiple of
// 3 so each chunk's base64 is unpadded and the concatenation stays valid; its
// base64 (bytes / 3 * 4) is comfortably under the /exec route's 16 MB cap.
const READ_CHUNK_BYTES = 6 * 1024 * 1024;
const READ_CHUNK_B64_LEN = (READ_CHUNK_BYTES / 3) * 4;

interface Shot {
  dataUrl: string;
  bytesB64: string;
}

// Decode a base64 PNG payload to a Blob for clipboard writes.
function b64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

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
    // Build the temp name inside try: crypto.randomUUID() is gated to secure
    // contexts, but middleware serves this UI to LAN clients over plain HTTP,
    // where it's undefined. A throw before try would never reset pending; the
    // Date+random suffix is collision-resistant without the secure-context gate.
    let tmp = "";
    try {
      tmp = `/tmp/headless-serve-sim-shot-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
      let cmd = `xcrun simctl io ${udid} screenshot --type png`;
      if (display !== "") cmd += ` --display ${display}`;
      if (mask !== "") cmd += ` --mask ${mask}`;
      cmd += ` ${shellEscape(tmp)}`;
      const cap = await execOnHost(cmd);
      if (cap.exitCode !== 0) {
        setError(cap.stderr.trim() || `screenshot failed (exit ${cap.exitCode})`);
        return;
      }
      // Read the PNG back as base64 in raw-byte chunks. A single `base64 -i`
      // over a large file (External display / hi-res iPad) can exceed the
      // /exec route's 16 MB maxBuffer once base64 inflates the bytes ~1.37x,
      // truncating stdout and failing an otherwise-valid capture. Slicing with
      // `dd` at a multiple-of-3 block size keeps each call well under the cap
      // and the concatenated base64 byte-identical to one-shot encoding.
      let bytesB64 = "";
      for (let skip = 0; ; skip++) {
        const read = await execOnHost(
          `dd if=${shellEscape(tmp)} bs=${READ_CHUNK_BYTES} skip=${skip} count=1 2>/dev/null | base64`,
        );
        if (read.exitCode !== 0) {
          setError(read.stderr.trim() || `read-back failed (exit ${read.exitCode})`);
          return;
        }
        const part = read.stdout.replace(/\s/g, "");
        bytesB64 += part;
        // A short (or empty) chunk means dd hit EOF — base64 of a full
        // READ_CHUNK_BYTES block is a fixed length, so anything less is the tail.
        if (part.length < READ_CHUNK_B64_LEN) break;
      }
      setShot({ dataUrl: `data:image/png;base64,${bytesB64}`, bytesB64 });
    } finally {
      execOnHost(`bash -c 'rm -f ${shellEscape(tmp)}'`).catch(() => {});
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
    <div className="bg-panel border border-white/8 rounded-[10px] flex flex-col gap-2.5 px-3 py-2">
      <style>{HOVER_CSS}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lem-toggle grid [grid-template-columns:auto_1fr_auto] items-center gap-2 bg-transparent border-none text-white/90 py-2.5 px-1 -my-2 -mx-1 cursor-pointer w-[calc(100%+8px)] text-left min-h-[36px] leading-none"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold text-white/50 uppercase tracking-[0.08em] leading-none inline-flex items-center">
          Screenshot
        </span>
        <span />
        <Chevron open={open} />
      </button>

      {open && (
        <>
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
            className="lem-primary inline-flex items-center justify-center gap-1.5 py-2 px-3 border-none rounded-[7px] text-[12px] font-semibold cursor-pointer font-[inherit] bg-accent text-[#0b1020] w-full"
          >
            {pending === "capture" ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-[#0b1020]/80 animate-pulse" />
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
                className="w-full max-h-[220px] object-contain rounded-[8px] border border-white/8 bg-black/20"
              />
              <div className="flex gap-2">
                <a
                  href={shot.dataUrl}
                  download="screenshot.png"
                  className="lem-ghost flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 border border-white/12 rounded-[7px] text-[12px] font-medium bg-transparent text-white/85 cursor-pointer font-[inherit] no-underline [transition:background_0.12s,border-color_0.12s,color_0.12s]"
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
                    className="text-white/85"
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
                  className="lem-ghost flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 border border-white/12 rounded-[7px] text-[12px] font-medium bg-transparent text-white/85 cursor-pointer font-[inherit] [transition:background_0.12s,border-color_0.12s,color_0.12s]"
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
                        className="text-white/85"
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
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <span className="text-[9px] uppercase tracking-[0.06em] text-white/45 w-[44px] shrink-0">
        {label}
      </span>
      <div className="flex gap-0.5 bg-white/[0.04] border border-white/8 rounded-md p-0.5 flex-1 overflow-hidden">
        {options.map(([val, text]) => (
          <button
            key={val}
            type="button"
            data-active={value === val}
            onClick={() => onChange(val)}
            className="lem-chip flex-1 min-w-0 truncate py-1 px-1.5 border-none rounded text-[11px] font-medium cursor-pointer font-[inherit] [transition:background_0.12s,color_0.12s]"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
