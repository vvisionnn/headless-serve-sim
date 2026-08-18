import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import qrcode from "qrcode-generator";
import { SimulatorToolbar } from "headless-serve-sim-client/simulator";
import { PanelCard, SquareIconButton } from "./design-system";

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

export function PhonePreviewCard({
  url,
  copied,
  onCopy,
  onClose,
}: {
  url: string;
  copied: boolean;
  onCopy: () => void;
  onClose?: () => void;
}) {
  const qr = qrPath(url);
  return (
    <PanelCard className="w-[340px] max-w-[calc(100vw-32px)]">
      <div className="flex min-h-14 items-center gap-3 px-5">
        <h2 className="mr-auto text-eyebrow uppercase text-fg">Phone preview</h2>
        {onClose && (
          <SquareIconButton onClick={onClose} label="Close phone preview link">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </SquareIconButton>
        )}
      </div>
      <div className="flex flex-col items-center gap-4 border-t border-divider px-5 py-5">
        <svg
          role="img"
          aria-label="QR code for phone preview"
          viewBox={`${-2} ${-2} ${qr.size + 4} ${qr.size + 4}`}
          className="size-[220px] max-w-full rounded-sm bg-white p-2 text-black"
          shapeRendering="crispEdges"
        >
          <path d={qr.path} fill="currentColor" />
        </svg>
        <p className="m-0 text-center text-body text-fg">Scan with your phone on the same LAN.</p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="max-h-14 w-full overflow-hidden break-all rounded-sm border border-control-border bg-surface-3 px-3 py-2 font-mono text-micro text-fg-2 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
        >
          {url}
        </a>
        <button
          type="button"
          autoFocus={onClose !== undefined}
          data-phone-preview-copy
          onClick={onCopy}
          className="min-h-10 w-full cursor-pointer rounded-card border border-accent-solid bg-accent-solid px-4 text-body font-semibold text-on-accent hover:bg-fg focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1)]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <span aria-live="polite" className="sr-only">
          {copied ? "Phone preview link copied" : ""}
        </span>
      </div>
    </PanelCard>
  );
}

export function PhonePreviewLink({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.querySelector("button")?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[data-phone-preview-copy]")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const copy = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1_500);
      })
      .catch(() => {});
  };

  return (
    <>
      <span ref={triggerRef} className="contents">
        <SimulatorToolbar.Button
          aria-label="Show phone preview link"
          aria-haspopup="dialog"
          aria-expanded={open}
          title="Preview on phone"
          onClick={() => setOpen(true)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="7" y="2" width="10" height="20" rx="2" />
            <path d="M10 5h4M11 19h2" />
          </svg>
        </SimulatorToolbar.Button>
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-scrim p-4"
            role="presentation"
            onMouseDown={close}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Phone preview link"
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key !== "Tab") return;
                const controls = event.currentTarget.querySelectorAll<HTMLElement>("a,button");
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }}
            >
              <PhonePreviewCard url={url} copied={copied} onCopy={copy} onClose={close} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
