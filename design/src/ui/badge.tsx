import { cn } from "../lib/cn";

type Tone = "neutral" | "green" | "orange" | "red" | "ink";

const tones: Record<Tone, string> = {
  neutral: "bg-fill-2 text-label-2",
  green: "bg-green/12 text-green",
  orange: "bg-orange/14 text-orange",
  red: "bg-red/12 text-red",
  ink: "bg-ink text-on-ink",
};

/** Small status badge (ReUI Badge, "light" appearance). Colour only ever here. */
export function Badge({ tone = "neutral", dot, children, className }: { tone?: Tone; dot?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-[18px] items-center gap-1 rounded-full px-1.5 text-caption font-semibold tabular", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** A status light. `live` breathes, so a stream reads as alive at a glance. */
export function StatusDot({ tone, live, className }: { tone: "green" | "orange" | "red" | "neutral"; live?: boolean; className?: string }) {
  const color = { green: "text-green", orange: "text-orange", red: "text-red", neutral: "text-label-3" }[tone];
  return <span className={cn("inline-block size-[7px] shrink-0 rounded-full bg-current", color, live && "live-dot", className)} />;
}
