import { SquareIconButton, ValueChip } from "./design-system";

export type DuoPose = "closed" | "book" | "open";

const poses: { value: DuoPose; label: string; angle: number }[] = [
  { value: "closed", label: "Closed", angle: 0 },
  { value: "book", label: "Book", angle: 130 },
  { value: "open", label: "Open", angle: 180 },
];

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
      <div className="flex h-[52px] items-center gap-3 px-3">
        <div className="flex items-center gap-1" role="group" aria-label="Pose">
          {poses.map((option) => (
            <span
              key={option.value}
              data-selected={pose === option.value}
              className="duo-pose-button"
            >
              <SquareIconButton
                label={option.label}
                pressed={pose === option.value}
                disabled={disabled}
                title={`${option.label} · ${option.angle}°`}
                onClick={() => onAngleChange(option.angle)}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  {option.value === "closed" ? (
                    <>
                      <rect x="7" y="3.5" width="10" height="17" rx="2" />
                      <path d="M5 5v14" />
                    </>
                  ) : option.value === "book" ? (
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
              </SquareIconButton>
            </span>
          ))}
        </div>
        <span className="h-5 w-px shrink-0 bg-divider" aria-hidden />
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="shrink-0 text-fg-2"
          aria-hidden
        >
          <path d="M3 16V4m0 12h13M7 16a4 4 0 0 0-4-4" />
        </svg>
        <input
          type="range"
          className="duo-hinge-slider min-w-0 flex-1"
          aria-label="Hinge angle"
          disabled={disabled}
          min={0}
          max={180}
          step={1}
          value={angle}
          onChange={(event) => onAngleChange(Number(event.currentTarget.value))}
        />
        <ValueChip className="w-[52px] shrink-0 text-center">{Math.round(angle)}°</ValueChip>
      </div>
      {error && (
        <p role="alert" className="m-0 border-t border-divider px-3 py-2 text-value text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
