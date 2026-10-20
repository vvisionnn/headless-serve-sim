import { Keyboard, Smartphone, Snail, TextCursorInput } from "lucide-react";
import { SliderRow } from "../inspector/device-rows";
import { Button } from "../ui/button";
import { Row, Section } from "../ui/group";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";

export function scaleLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function DeviceViewTool({
  bezels,
  scale,
  slowAnimations,
  keyboardCapture = false,
  onKeyboardCaptureChange,
  onBezelsChange,
  onScaleChange,
  onZoomToFit = () => onScaleChange(1),
  onRealSize,
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
  /** A one-step jump back to scale 1, which the stage animates; drags track. */
  onZoomToFit?: () => void;
  /** Back to the device's real size, forgetting a chosen one. */
  onRealSize?: () => void;
  onSlowAnimationsChange: (value: boolean) => void;
  onSoftwareKeyboard: () => void;
}) {
  return (
    <Section
      title="View"
      accessory={
        <div className="flex gap-1">
          {onRealSize && (
            <Button variant="plain" size="sm" onClick={onRealSize}>
              Real size
            </Button>
          )}
          <Button variant="plain" size="sm" onClick={onZoomToFit}>
            Zoom to fit
          </Button>
        </div>
      }
      footer="Opens at its real size, with room around it."
    >
      <Row label="Show bezel" icon={<Smartphone />}>
        <Switch label="Show bezel" checked={bezels} onChange={onBezelsChange} />
      </Row>
      <SliderRow label="Scale" value={scaleLabel(scale)}>
        <Slider
          label="Scale"
          value={scale}
          min={0.25}
          max={1}
          step={0.05}
          onChange={onScaleChange}
        />
      </SliderRow>
      <Row label="Slow animations" icon={<Snail />}>
        <Switch
          label="Slow animations"
          checked={slowAnimations}
          onChange={onSlowAnimationsChange}
        />
      </Row>
      {onKeyboardCaptureChange && (
        <Row
          label="Capture keyboard"
          detail="Forward keys while this page is focused. Form fields remain editable."
          icon={<Keyboard />}
        >
          <Switch
            label="Capture keyboard"
            checked={keyboardCapture}
            onChange={onKeyboardCaptureChange}
          />
        </Row>
      )}
      <Row label="Software keyboard" icon={<TextCursorInput />}>
        <Button variant="secondary" size="sm" onClick={onSoftwareKeyboard}>
          Toggle
        </Button>
      </Row>
    </Section>
  );
}
