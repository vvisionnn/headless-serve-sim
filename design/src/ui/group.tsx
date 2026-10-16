import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";

/**
 * Inset grouped list — the System Settings shape. A titled group of rows in a
 * soft box; rows divide with an inset hairline. This is the only container
 * inside a sidebar: no cards in cards.
 */
export function Section({
  title,
  accessory,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  accessory?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      {(title || accessory) && (
        <header className="flex min-h-5 items-center justify-between px-2.5">
          <h3 className="text-headline text-label">{title}</h3>
          {accessory}
        </header>
      )}
      <div className="group-box">{children}</div>
      {footer && <p className="px-2.5 text-caption text-label-3">{footer}</p>}
    </section>
  );
}

export function Row({
  icon,
  label,
  detail,
  children,
  className,
  stacked,
}: {
  icon?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Put the control under the label — for wide controls like sliders. */
  stacked?: boolean;
}) {
  return (
    <div className={cn("row flex min-h-10 gap-2.5 px-3 py-2", stacked ? "flex-col" : "items-center", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {icon && <RowIcon>{icon}</RowIcon>}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium text-label">{label}</span>
          {detail && <span className="text-caption text-label-3">{detail}</span>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function RowIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-[22px] shrink-0 items-center justify-center rounded-[6px] bg-fill-2 text-label [&_svg]:size-[13px] [&_svg]:stroke-[2]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A label/value pair, value in mono so data never reads as a label. */
export function InfoRow({ label, value, mono = true, action }: { label: string; value: ReactNode; mono?: boolean; action?: ReactNode }) {
  return (
    <div className="row group flex min-h-9 items-start gap-3 px-3 py-2">
      <span className="w-[86px] shrink-0 pt-px text-footnote text-label-2">{label}</span>
      <span className={cn("min-w-0 flex-1 text-footnote text-label [overflow-wrap:anywhere]", mono && "font-mono text-[11.5px]/4 tracking-normal")}>{value}</span>
      {action}
    </div>
  );
}

/**
 * Disclosure group. Height animates on a spring, and the chevron turns with
 * it — the content grows out of the header that owns it.
 */
export function Disclosure({
  title,
  icon,
  status,
  defaultOpen,
  children,
}: {
  title: string;
  icon?: ReactNode;
  status?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="group-box overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-fill-3"
      >
        {icon && <RowIcon>{icon}</RowIcon>}
        <span className="flex-1 truncate text-body font-semibold text-label">{title}</span>
        {status}
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={spring.ui} className="flex text-label-3">
          <ChevronRight className="size-[14px]" strokeWidth={2.25} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: spring.ui, opacity: { duration: 0.2 } }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 border-t-[0.5px] border-separator px-3 pt-3 pb-3.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
