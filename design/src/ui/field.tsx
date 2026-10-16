import { Minus, Plus } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

const fieldBase =
  "h-7 w-full min-w-0 rounded-[8px] bg-control px-2.5 text-body text-label placeholder:text-label-3 shadow-[0_0_0_0.5px_var(--separator),inset_0_1px_1px_rgba(0,0,0,0.03)] outline-none transition-shadow focus:shadow-[0_0_0_0.5px_var(--separator),0_0_0_3px_color-mix(in_srgb,var(--ink)_14%,transparent)] dark:shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)]";

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode; mono?: boolean }>(
  function TextField({ className, leading, mono, ...rest }, ref) {
    if (!leading) return <input ref={ref} className={cn(fieldBase, mono && "font-mono text-footnote", className)} {...rest} />;
    return (
      <label className={cn("relative flex items-center", className)}>
        <span className="pointer-events-none absolute left-2 flex text-label-3 [&_svg]:size-[13px]">{leading}</span>
        <input ref={ref} className={cn(fieldBase, "pl-7", mono && "font-mono text-footnote")} {...rest} />
      </label>
    );
  },
);

export function TextArea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "h-auto resize-none py-1.5 font-mono text-footnote leading-[17px]", className)} {...rest} />;
}

/** Stepper (ReUI NumberField shape): − value + in one capsule. */
export function Stepper({ value, min, max, onChange, suffix, label }: { value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-7 items-center rounded-[8px] bg-control shadow-[0_0_0_0.5px_var(--separator),0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-[inset_0_0.5px_0_rgba(255,255,255,0.08)]">
      <button type="button" aria-label="Decrease" disabled={value <= min} onClick={() => onChange(value - 1)} className="flex h-full w-7 items-center justify-center rounded-l-[8px] text-label-2 hover:bg-fill-3 disabled:opacity-30">
        <Minus className="size-3" strokeWidth={2.5} />
      </button>
      <span className="min-w-8 border-x-[0.5px] border-separator text-center font-mono text-footnote tabular text-label">
        {value}
        {suffix}
      </span>
      <button type="button" aria-label="Increase" disabled={value >= max} onClick={() => onChange(value + 1)} className="flex h-full w-7 items-center justify-center rounded-r-[8px] text-label-2 hover:bg-fill-3 disabled:opacity-30">
        <Plus className="size-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}

export function ValueChip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("rounded-[6px] bg-fill-3 px-1.5 py-0.5 font-mono text-caption font-medium tabular text-label-2", className)}>{children}</span>;
}
