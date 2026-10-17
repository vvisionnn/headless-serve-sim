import { IconButton } from "../ui/button";
import { ValueChip } from "../ui/field";
import { Slider } from "../ui/slider";
import { Tip } from "../ui/tooltip";

export type DuoPose = "closed" | "book" | "open";

export const DUO_POSES: { value: DuoPose; label: string; angle: number }[] = [
  { value: "closed", label: "Closed", angle: 0 },
  { value: "book", label: "Book", angle: 130 },
  { value: "open", label: "Open", angle: 180 },
];

function PoseGlyph({ pose }: { pose: DuoPose }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      aria-hidden
    >
      {pose === "closed" ? (
        <>
          <rect x="7" y="3.5" width="10" height="17" rx="2" />
          <path d="M5 5v14" />
        </>
      ) : pose === "book" ? (
        <>
          <path d="M3 5.5 12 7l9-1.5v14L12 21l-9-1.5z" />
          <path d="M12 7v14" />
        </>
      ) : (
        <>
          <rect x="2.5" y="5" width="19" height="14" rx="2" />
          <path d="M12 5v14" />
        </>
      )}
    </svg>
  );
}

/**
 * The Duo's hinge, as a glass capsule under the dock: three poses for the
 * common states and a continuous slider for everything between.
 */
export function DeviceMotionTool({
  angle,
  pose,
  onAngleChange,
  error,
  disabled = false,
}: {
  angle: number;
  pose: DuoPose;
  onAngleChange: (angle: number) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col" aria-label="Fold controls">
      <div className="flex h-11 items-center gap-2 pr-2 pl-1.5">
        <div className="flex items-center gap-0.5" role="group" aria-label="Pose">
          {DUO_POSES.map((option) => (
            <Tip key={option.value} label={`${option.label} · ${option.angle}°`} side="top">
              <IconButton
                label={option.label}
                active={pose === option.value}
                disabled={disabled}
                onClick={() => onAngleChange(option.angle)}
              >
                <PoseGlyph pose={option.value} />
              </IconButton>
            </Tip>
          ))}
        </div>
        <span className="h-5 w-px shrink-0 bg-separator" aria-hidden />
        <Slider
          label="Hinge angle"
          className="min-w-[120px] flex-1"
          min={0}
          max={180}
          step={1}
          value={angle}
          disabled={disabled}
          onChange={onAngleChange}
        />
        <ValueChip className="w-[48px] shrink-0 text-center">{Math.round(angle)}°</ValueChip>
      </div>
      {error && (
        <p role="alert" className="m-0 px-3 pb-2.5 text-footnote text-red [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
    </div>
  );
}
