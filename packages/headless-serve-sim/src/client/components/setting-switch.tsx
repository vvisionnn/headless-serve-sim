import type { ReactNode } from "react";

// A boolean setting: name on the left, its current state spelled out in mono,
// then the switch itself.
//
// The switch is a soft-cornered rectangle with a square-ish knob, not an iOS
// stadium — same shape family as the chips, segments and icon buttons, so it
// belongs to this system rather than being imported from another one. The state
// word is what actually tells you the value; the fill is the reinforcement, so
// the control still reads correctly without relying on the fill alone.
export function SettingSwitch({
  label,
  decoratedLabel,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  /** Label with its icon, when the row shows one. Falls back to `label`. */
  decoratedLabel?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex min-h-[38px] items-center justify-between gap-3" data-setting-row={label}>
      <span className="min-w-0 truncate text-body text-fg">{decoratedLabel ?? label}</span>
      <span className="flex shrink-0 items-center gap-2.5">
        <span
          aria-hidden
          className={`w-7 text-right font-mono text-value leading-none ${
            checked ? "text-fg" : "text-fg-3"
          }`}
        >
          {checked ? "on" : "off"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={`relative h-[24px] w-[44px] shrink-0 rounded-sm border p-0 disabled:opacity-45 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1)] ${
            disabled ? "cursor-default" : "cursor-pointer"
          } ${
            checked
              ? "border-accent-solid bg-accent-solid"
              : "border-control-border bg-track hover:bg-hover"
          }`}
        >
          <span
            className="absolute top-[2px] size-[18px] rounded-[5px] bg-thumb [box-shadow:0_1px_3px_rgba(0,0,0,0.16)] [transition:left_0.3s_cubic-bezier(0.4,0,0.6,1)]"
            style={{ left: checked ? 22 : 2 }}
          />
        </button>
      </span>
    </div>
  );
}
