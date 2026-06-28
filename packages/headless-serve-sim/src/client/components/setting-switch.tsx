// iOS-style toggle switch shared across the settings sidebar and tool panels.
export function SettingSwitch({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-8 shrink-0 rounded-pill border border-divider p-0 [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)] ${
        disabled
          ? "cursor-default bg-surface-3"
          : checked
            ? "cursor-pointer bg-accent-solid"
            : "cursor-pointer bg-surface-3"
      }`}
    >
      <span
        className={`absolute top-[2px] size-[14px] rounded-full [transition:left_0.3s_cubic-bezier(0.4,0,0.6,1)] ${disabled ? "bg-fg-3" : checked ? "bg-white" : "bg-fg"}`}
        style={{ left: checked ? 16 : 2 }}
      />
    </button>
  );
}
