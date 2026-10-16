import { cn } from "../lib/cn";

/** Keycap, after ReUI's Kbd: rounded, hairline, mono-width glyphs. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-fill-3 px-1 font-sans text-caption font-medium text-label-2 shadow-[inset_0_0_0_0.5px_var(--separator),0_0.5px_0_var(--separator)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Shortcut({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  );
}
