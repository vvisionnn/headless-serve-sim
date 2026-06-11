import { execOnHost, shellEscape } from "./exec";

// Shared simulator-screenshot capture. Drives `xcrun simctl io <udid>
// screenshot` directly (the io primitive needs no privileged store, so callers
// hit simctl rather than a passthrough), stages a PNG to /tmp, reads it back
// over /exec as base64, then removes the temp file. Type is pinned to png so an
// in-browser Blob/ClipboardItem MIME and the data-URL preview match the bytes
// exactly (jpeg/tiff/bmp would break that). Used by the Screenshot tool card
// and the ⌘S download shortcut.

// Raw-byte slice size for the chunked base64 read-back. Must be a multiple of
// 3 so each chunk's base64 is unpadded and the concatenation stays valid; its
// base64 (bytes / 3 * 4) is comfortably under the /exec route's 16 MB cap.
const READ_CHUNK_BYTES = 6 * 1024 * 1024;
const READ_CHUNK_B64_LEN = (READ_CHUNK_BYTES / 3) * 4;

export type ScreenshotDisplay = "" | "internal" | "external";
export type ScreenshotMask = "" | "ignored" | "alpha" | "black";

export interface Screenshot {
  dataUrl: string;
  bytesB64: string;
}

// Capture a PNG of the simulator and return it as base64 + a data URL. Throws
// on a non-zero simctl/read-back exit so callers surface a real message; always
// removes the temp file. Pure of UI state, so both the tool card and the
// keyboard shortcut can share one implementation of the chunked read-back.
export async function captureScreenshot(
  udid: string,
  opts: { display?: ScreenshotDisplay; mask?: ScreenshotMask } = {},
): Promise<Screenshot> {
  const display = opts.display ?? "";
  const mask = opts.mask ?? "";
  // Build the temp name inside try: crypto.randomUUID() is gated to secure
  // contexts, but middleware serves this UI to LAN clients over plain HTTP,
  // where it's undefined. The Date+random suffix is collision-resistant
  // without the secure-context gate.
  let tmp = "";
  try {
    tmp = `/tmp/headless-serve-sim-shot-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    let cmd = `xcrun simctl io ${udid} screenshot --type png`;
    if (display !== "") cmd += ` --display ${display}`;
    if (mask !== "") cmd += ` --mask ${mask}`;
    cmd += ` ${shellEscape(tmp)}`;
    const cap = await execOnHost(cmd);
    if (cap.exitCode !== 0) {
      throw new Error(cap.stderr.trim() || `screenshot failed (exit ${cap.exitCode})`);
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
        throw new Error(read.stderr.trim() || `read-back failed (exit ${read.exitCode})`);
      }
      const part = read.stdout.replace(/\s/g, "");
      bytesB64 += part;
      // A short (or empty) chunk means dd hit EOF — base64 of a full
      // READ_CHUNK_BYTES block is a fixed length, so anything less is the tail.
      if (part.length < READ_CHUNK_B64_LEN) break;
    }
    return { dataUrl: `data:image/png;base64,${bytesB64}`, bytesB64 };
  } finally {
    execOnHost(`bash -c 'rm -f ${shellEscape(tmp)}'`).catch(() => {});
  }
}

// Decode a base64 PNG payload to a Blob (clipboard writes, programmatic
// download). Lives here so the capture, copy, and download paths agree on the
// byte decode.
export function b64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Stable download name for a capture, e.g. `simulator-20260611-153012.png`.
// Sortable and unique per second so rapid ⌘S presses don't collide into the
// browser's "screenshot (1).png" renaming. Pure (date injected) for testing.
export function screenshotFilename(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `simulator-${stamp}.png`;
}

// Trigger an immediate browser download of a capture with no visible UI. Uses
// an object URL (not the data URL) so multi-MB hi-res captures don't strain
// anchor href limits; revoked once the synthetic click is dispatched.
export function downloadScreenshot(shot: Screenshot, filename: string): void {
  const blob = b64ToBlob(shot.bytesB64, "image/png");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
