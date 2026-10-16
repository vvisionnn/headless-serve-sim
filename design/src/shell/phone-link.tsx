import { Popover } from "@base-ui/react/popover";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Smartphone } from "lucide-react";
import qrcode from "qrcode-generator";
import { useMemo, useState } from "react";
import { spring } from "../lib/motion";
import { IconButton } from "../ui/button";

const URL = "http://192.168.1.24:3200/p/7f3a9c2e";

function QR({ text, size }: { text: string; size: number }) {
  const cells = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    const out: [number, number][] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) out.push([c, r]);
    return { n, out };
  }, [text]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${cells.n} ${cells.n}`} shapeRendering="crispEdges" aria-label={`QR code for ${text}`}>
      {cells.out.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill="#1d1d1f" />
      ))}
    </svg>
  );
}

/** Toolbar button → QR popover that grows out of the button it came from. */
export function PhoneLinkButton() {
  const [copied, setCopied] = useState(false);
  return (
    <Popover.Root>
      <Popover.Trigger render={<IconButton label="Preview on phone"><Smartphone /></IconButton>} />
      <Popover.Portal>
        <Popover.Positioner sideOffset={10} align="end" className="z-[80]">
          <Popover.Popup className="glass-pop menu-pop flex w-[280px] origin-[var(--transform-origin)] flex-col gap-3 rounded-[18px] p-4 outline-none">
            <div className="flex flex-col gap-1">
              <Popover.Title className="text-headline text-label">Preview on phone</Popover.Title>
              <Popover.Description className="text-caption text-label-2">
                Scan with a phone on the same network. The link stays pinned to iPhone 17 Pro until the server stops.
              </Popover.Description>
            </div>
            <div className="flex justify-center rounded-[12px] bg-white p-3 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
              <QR text={URL} size={184} />
            </div>
            <div className="flex items-center gap-2 rounded-[10px] bg-fill-3 py-1 pr-1 pl-2.5 shadow-[inset_0_0_0_0.5px_var(--separator)]">
              <span className="min-w-0 flex-1 truncate font-mono text-caption text-label">{URL.replace("http://", "")}</span>
              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                transition={spring.snappy}
                onClick={() => {
                  void navigator.clipboard?.writeText(URL).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
                className="flex h-6 items-center gap-1 overflow-hidden rounded-full bg-ink px-2.5 text-footnote font-semibold text-on-ink"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={copied ? "y" : "n"}
                    className="flex items-center gap-1"
                    initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -8, filter: "blur(3px)" }}
                    transition={spring.snappy}
                  >
                    {copied ? <Check className="size-3" strokeWidth={3} /> : <Copy className="size-3" strokeWidth={2.4} />}
                    {copied ? "Copied" : "Copy"}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
