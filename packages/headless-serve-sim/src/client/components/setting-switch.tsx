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
      className={`relative h-[18px] w-8 shrink-0 border border-divider p-0 [transition:background_0.15s] ${
        disabled
          ? "cursor-default bg-surface-3"
          : checked
            ? "cursor-pointer bg-accent"
            : "cursor-pointer bg-surface-3"
      }`}
    >
      <span
        className={`absolute top-[2px] size-[14px] [transition:left_0.15s] ${disabled ? "bg-fg-3" : "bg-fg"}`}
        style={{ left: checked ? 16 : 2 }}
      />
    </button>
  );
}
