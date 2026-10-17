import { Popover } from "@base-ui/react/popover";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Smartphone } from "lucide-react";
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useRef, useState } from "react";
import { spring } from "../lib/motion";
import { IconButton } from "../ui/button";

function qrPath(url: string): { size: number; path: string } {
  const code = qrcode(0, "M");
  code.addData(url);
  code.make();
  const size = code.getModuleCount();
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (code.isDark(y, x)) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, path };
}

/** QR, link and Copy — the body of the phone-preview popover. */
export function PhonePreviewCard({
  url,
  deviceName = null,
  copied,
  onCopy,
}: {
  url: string;
  deviceName?: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  const qr = useMemo(() => qrPath(url), [url]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-headline text-label">Preview on phone</h2>
        <p className="m-0 text-caption text-label-2">
          Scan with a phone on the same network. The link stays pinned to{" "}
          {deviceName ?? "this simulator"} until the server stops.
        </p>
      </div>
      <div className="flex justify-center rounded-[12px] bg-white p-3 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
        <svg
          role="img"
          aria-label="QR code for phone preview"
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          width={184}
          height={184}
          shapeRendering="crispEdges"
        >
          <path d={qr.path} fill="#1d1d1f" />
        </svg>
      </div>
      <div className="flex items-center gap-2 rounded-[10px] bg-fill-3 py-1 pr-1 pl-2.5 shadow-[inset_0_0_0_0.5px_var(--separator)]">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={url}
          className="min-w-0 flex-1 truncate font-mono text-caption text-label outline-none hover:underline focus-visible:underline"
        >
          {url.replace(/^https?:\/\//, "")}
        </a>
        <motion.button
          type="button"
          autoFocus
          data-phone-preview-copy
          whileTap={{ scale: 0.95 }}
          transition={spring.snappy}
          onClick={onCopy}
          className="flex h-6 shrink-0 items-center gap-1 overflow-hidden rounded-full bg-ink px-2.5 text-footnote font-semibold text-on-ink"
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={copied ? "copied" : "copy"}
              className="flex items-center gap-1"
              initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(3px)" }}
              transition={spring.snappy}
            >
              {copied ? (
                <Check className="size-3" strokeWidth={3} />
              ) : (
                <Copy className="size-3" strokeWidth={2.4} />
              )}
              {copied ? "Copied" : "Copy"}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? "Phone preview link copied" : ""}
      </span>
    </div>
  );
}

/** Toolbar button → QR popover that grows out of the button it came from. */
export function PhoneLinkButton({ url, deviceName }: { url: string; deviceName: string | null }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1_600);
      })
      .catch(() => {});
  };

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <IconButton label="Preview on phone">
            <Smartphone />
          </IconButton>
        }
      />
      <Popover.Portal>
        <Popover.Positioner sideOffset={10} align="end" className="z-[80]">
          <Popover.Popup
            aria-label="Preview on phone"
            className="glass-pop menu-pop w-[280px] max-w-[calc(100vw-24px)] origin-[var(--transform-origin)] rounded-[18px] p-4 outline-none"
          >
            <PhonePreviewCard url={url} deviceName={deviceName} copied={copied} onCopy={copy} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
