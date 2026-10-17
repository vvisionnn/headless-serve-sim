import { Camera } from "lucide-react";
import { useCallback, useState } from "react";
import { useOptionalShell } from "../shell/shell-context";
import { Button } from "../ui/button";
import { Row, Section } from "../ui/group";
import { Shortcut } from "../ui/kbd";
import { Segmented } from "../ui/segmented";
import {
  captureScreenshot,
  b64ToBlob,
  screenshotFilename,
  type ScreenshotDisplay,
  type ScreenshotMask,
} from "../utils/screenshot";

// Screenshot section of the Capture tab: pick display/mask options and capture
// via the shared helper. The result lands in the shell's Recent captures, which
// owns preview, copy and download. Capture mechanics (simctl, chunked base64
// read-back) live in ../utils/screenshot.

/** Pixel size from a base64 PNG's IHDR chunk; null if it isn't a PNG. */
export function pngSize(bytesB64: string): { width: number; height: number } | null {
  // 24 header bytes = 32 base64 chars: signature (8), IHDR length+type (8), w, h.
  const head = atob(bytesB64.slice(0, 32));
  if (head.length < 24 || head.slice(1, 4) !== "PNG") return null;
  const u32 = (at: number) =>
    ((head.charCodeAt(at) << 24) |
      (head.charCodeAt(at + 1) << 16) |
      (head.charCodeAt(at + 2) << 8) |
      head.charCodeAt(at + 3)) >>>
    0;
  return { width: u32(16), height: u32(20) };
}

export function screenshotMeta(bytesB64: string): string {
  const size = pngSize(bytesB64);
  return size ? `${size.width} × ${size.height} · PNG` : "PNG";
}

export function ScreenshotTool({
  udid,
  displayId,
  foldable = false,
}: {
  udid: string;
  displayId?: number;
  foldable?: boolean;
}) {
  const shell = useOptionalShell();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [display, setDisplay] = useState<ScreenshotDisplay>("");
  const [mask, setMask] = useState<ScreenshotMask>("");

  const capture = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const shot = await captureScreenshot(udid, {
        display: display || (displayId ? `${displayId}` : ""),
        mask,
      });
      const blob = b64ToBlob(shot.bytesB64, "image/png");
      const createdAt = Date.now();
      shell?.addCapture({
        kind: "screenshot",
        createdAt,
        meta: screenshotMeta(shot.bytesB64),
        url: URL.createObjectURL(blob),
        filename: screenshotFilename(new Date(createdAt)),
        blob,
      });
    } catch (e: any) {
      setError(e?.message ?? "screenshot failed");
    } finally {
      setPending(false);
    }
  }, [udid, display, displayId, mask, shell]);

  return (
    <Section title="Screenshot">
      <Row label="Display" stacked>
        <Segmented<ScreenshotDisplay>
          aria-label="Display"
          size="sm"
          value={display}
          onChange={setDisplay}
          items={
            foldable
              ? [
                  { value: "", label: "Active" },
                  { value: "1", label: "Cover" },
                  { value: "3", label: "Inner" },
                ]
              : [
                  { value: "", label: "Default" },
                  { value: "internal", label: "Internal" },
                  { value: "external", label: "External" },
                ]
          }
        />
      </Row>
      <Row label="Mask" stacked>
        <Segmented<ScreenshotMask>
          aria-label="Mask"
          size="sm"
          value={mask}
          onChange={setMask}
          items={[
            { value: "", label: "Default" },
            { value: "ignored", label: "Ignored" },
            { value: "alpha", label: "Alpha" },
            { value: "black", label: "Black" },
          ]}
        />
      </Row>
      <div className="row flex flex-col gap-2 px-3 py-2.5">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={pending}
          onClick={() => void capture()}
          className="justify-between pr-2"
        >
          <span className="flex items-center gap-1.5">
            <Camera /> {pending ? "Capturing…" : "Take screenshot"}
          </span>
          <Shortcut
            keys={["⌘", "S"]}
            className="[&_kbd]:bg-on-ink/15 [&_kbd]:text-on-ink/80 [&_kbd]:shadow-none"
          />
        </Button>
        {error && (
          <p role="alert" className="text-footnote text-red [overflow-wrap:anywhere]">
            {error}
          </p>
        )}
      </div>
    </Section>
  );
}
