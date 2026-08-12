import { SegmentedGroup } from "./design-system";
import type { StreamMode } from "../utils/stream-mode-control";

export type { StreamMode } from "../utils/stream-mode-control";

const MODE_OPTIONS = [
  { value: "perf", label: "Perf" },
  { value: "quality", label: "Quality" },
] as const;

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
    <SegmentedGroup
      label={label}
      value={mode}
      options={MODE_OPTIONS}
      disabled={disabled}
      showValue={false}
      onChange={onModeChange}
    />
  );
}
