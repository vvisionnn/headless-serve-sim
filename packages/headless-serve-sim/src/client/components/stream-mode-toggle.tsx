import type { StreamMode } from "../utils/stream-mode-control";

export type { StreamMode } from "../utils/stream-mode-control";

export function StreamModeToggle({
  label,
  mode,
  disabled = false,
  onModeChange,
}: {
  label: string;
  mode: StreamMode;
  disabled?: boolean;
  onModeChange: (mode: StreamMode) => void;
}) {
  return (
    <div className="flex items-center gap-2.5" role="radiogroup" aria-label={label}>
      <span className="w-[76px] shrink-0 text-[12px] text-fg-3">{label}</span>
      <div className="flex flex-1 gap-0.5 rounded-pill border border-divider bg-surface-2 p-0.5">
        {(["perf", "quality"] as const).map((option) => {
          const active = option === mode;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onModeChange(option)}
              className={`min-h-7 flex-1 cursor-pointer rounded-pill border-none px-2 text-[11px] font-semibold focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)] disabled:cursor-not-allowed disabled:text-fg-3 ${active ? "bg-panel shadow-sm" : "bg-transparent text-fg-3 hover:bg-hover"}`}
              style={
                active
                  ? {
                      color: option === "quality" ? "var(--color-accent)" : "var(--color-success)",
                    }
                  : undefined
              }
            >
              {option === "perf" ? "Perf" : "Quality"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
