import { useState } from "react";
import { CollapsibleSection } from "./collapsible-section";
import { Slider } from "./design-system";
import { SettingSwitch } from "./setting-switch";

export function DeviceViewTool({
  bezels,
  scale,
  slowAnimations,
  keyboardCapture = false,
  onKeyboardCaptureChange,
  onBezelsChange,
  onScaleChange,
  onSlowAnimationsChange,
  onSoftwareKeyboard,
}: {
  bezels: boolean;
  scale: number;
  slowAnimations: boolean;
  keyboardCapture?: boolean;
  onKeyboardCaptureChange?: (value: boolean) => void;
  onBezelsChange: (value: boolean) => void;
  onScaleChange: (value: number) => void;
  onSlowAnimationsChange: (value: boolean) => void;
  onSoftwareKeyboard: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <CollapsibleSection open={open} onOpenChange={setOpen} summary="View & keyboard">
      <SettingSwitch label="Show bezels" checked={bezels} onChange={onBezelsChange} />
      <Slider
        label="Scale"
        min={0.5}
        max={2}
        step={0.05}
        value={scale}
        onChange={onScaleChange}
        format={(value) => `${Math.round(value * 100)}%`}
      />
      <p className="m-0 text-value text-fg-2">Scale is capped to keep the whole device visible.</p>
      <button
        type="button"
        className="min-h-[38px] rounded-card border border-control-border bg-panel-deep px-3 py-2 text-body text-fg hover:bg-hover"
        onClick={() => onScaleChange(1)}
      >
        Zoom to fit
      </button>
      <SettingSwitch
        label="Slow animations"
        checked={slowAnimations}
        onChange={onSlowAnimationsChange}
      />
      <button
        type="button"
        className="min-h-[38px] rounded-card border border-control-border bg-panel-deep px-3 py-2 text-body text-fg hover:bg-hover"
        onClick={onSoftwareKeyboard}
      >
        Software keyboard
      </button>
      {onKeyboardCaptureChange && (
        <>
          <SettingSwitch
            label="Capture keyboard"
            checked={keyboardCapture}
            onChange={onKeyboardCaptureChange}
          />
          <p className="m-0 text-value text-fg-2">
            Forward keyboard input while this page is focused. Form fields remain editable.
          </p>
        </>
      )}
    </CollapsibleSection>
  );
}
