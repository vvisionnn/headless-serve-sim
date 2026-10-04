import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SimulatorControlOption,
  SimulatorControlState,
  DeviceOrientation,
} from "../../simulator-controls";
import { hostSimulatorControlRequest, hostDeviceMotionRequest } from "../utils/exec";
import { CollapsibleSection } from "./collapsible-section";
import { Slider } from "./design-system";
import { Select } from "./select";
import { SettingSwitch } from "./setting-switch";

type ScreenOrientation = "portrait" | "portrait_upside_down" | "landscape_left" | "landscape_right";
const SCREEN_ORIENTATIONS: Partial<Record<DeviceOrientation, ScreenOrientation>> = {
  portrait: "portrait",
  portraitUpsideDown: "portrait_upside_down",
  landscapeLeft: "landscape_right",
  landscapeRight: "landscape_left",
};
const ORIENTATION_OPTIONS = [
  { value: "portrait", label: "Portrait" },
  { value: "portraitUpsideDown", label: "Portrait Upside Down" },
  { value: "landscapeLeft", label: "Landscape Left" },
  { value: "landscapeRight", label: "Landscape Right" },
  { value: "faceUp", label: "Face Up" },
  { value: "faceDown", label: "Face Down" },
];
const DEFAULT_AUDIO_DEVICES = [{ value: "systemDefault", label: "System Default" }];
const SELECT_CLASS =
  "w-[168px] min-w-0 rounded-sm border border-control-border bg-panel px-3 py-2 text-value text-fg outline-none hover:border-fg-3 hover:bg-hover focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)] disabled:text-fg-3";
const BUTTON_CLASS =
  "min-h-[38px] cursor-pointer rounded-card border border-control-border bg-panel-deep px-3 py-2 text-body text-fg hover:bg-hover disabled:cursor-default disabled:opacity-45 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]";

function DeviceSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-h-[38px] items-center justify-between gap-3">
      <span className="min-w-0 text-body text-fg">{label}</span>
      <Select
        label={label}
        value={value}
        options={options}
        disabled={disabled}
        onChange={onChange}
        className={SELECT_CLASS}
      />
    </div>
  );
}

export function SimulatorControlsTool({
  udid,
  execToken,
  onOrientationChange,
}: {
  udid: string;
  execToken?: string;
  onOrientationChange?: (orientation: ScreenOrientation) => void;
}) {
  const [soundOpen, setSoundOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [hardwareOpen, setHardwareOpen] = useState(false);
  const [biometricsOpen, setBiometricsOpen] = useState(false);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [state, setState] = useState<SimulatorControlState | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const [opacity, setOpacity] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setError(null);
    try {
      const next = await hostSimulatorControlRequest(
        { device: udid },
        { signal: AbortSignal.timeout(20_000) },
      );
      if (request === generation.current) setState(next);
    } catch (error) {
      if (request === generation.current)
        setError(error instanceof Error ? error.message : "Simulator controls unavailable");
    }
  }, [udid]);

  useEffect(() => {
    const requests = generation;
    setState(null);
    setVolume(null);
    setOpacity(null);
    setPending(false);
    void refresh();
    return () => {
      requests.current++;
    };
  }, [refresh, execToken]);

  const apply = async (option: SimulatorControlOption, value: unknown) => {
    const request = ++generation.current;
    setPending(true);
    setError(null);
    try {
      if (option === "orientation")
        await hostDeviceMotionRequest({
          device: udid,
          command: "orientation",
          orientation: value as string,
        });
      const next = await hostSimulatorControlRequest(
        option === "orientation" ? { device: udid } : { device: udid, option, value },
        { signal: AbortSignal.timeout(35_000) },
      );
      if (request !== generation.current) return;
      setState(next);
      if (option === "orientation") {
        const screenOrientation = SCREEN_ORIENTATIONS[value as DeviceOrientation];
        if (screenOrientation) onOrientationChange?.(screenOrientation);
      }
    } catch (error) {
      if (request === generation.current)
        setError(error instanceof Error ? error.message : "Could not update simulator control");
    } finally {
      if (request === generation.current) {
        setPending(false);
        setVolume(null);
        setOpacity(null);
      }
    }
  };

  const audio = state?.audio;
  const biometric = state?.biometrics?.[0];
  const biometricLabel = biometric?.type ?? "Biometrics";
  const touch = !biometric || biometric.type === "Touch ID";
  const audioDisabled = !audio || pending;
  const biometricsDisabled = !biometric || pending;
  const clipboardDisabled = typeof state?.sharedClipboard !== "boolean" || pending;
  const opacityDisabled = !state?.appearance || pending;

  return (
    <>
      {state?.inputAttachment?.appleWindowActive && (
        <div role="alert" className="flex flex-col gap-2 px-5 py-3 text-value text-fg">
          <p className="m-0 break-words font-semibold">
            Simulator input is owned by Apple’s window.
          </p>
          <p className="m-0 break-words">
            Headless touches, buttons, and keyboard input may be dropped even when delivery
            succeeds.
          </p>
          <p className="m-0 break-words text-fg-2">
            Reclaiming input requires restarting SpringBoard and closes running simulator apps. No
            automatic repair is performed.
          </p>
        </div>
      )}
      {state?.errors.inputAttachment && (
        <p className="m-0 break-words px-5 py-3 text-value text-fg-2">
          Input ownership unavailable: {state.errors.inputAttachment}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-5 py-3 text-value text-danger"
        >
          <span className="min-w-0 break-words">{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={pending}
            className={BUTTON_CLASS}
          >
            Retry
          </button>
        </div>
      )}
      <CollapsibleSection open={soundOpen} onOpenChange={setSoundOpen} summary="Sound">
        <Slider
          label="Volume"
          value={volume ?? audio?.volume ?? 0.6}
          min={0}
          max={1}
          step={0.01}
          disabled={audioDisabled}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={setVolume}
          onCommit={() => {
            if (volume !== null && !audioDisabled) void apply("volume", volume);
          }}
        />
        <DeviceSelect
          label="Input Device"
          value={audio?.inputDevice ?? "systemDefault"}
          options={audio?.inputDevices ?? DEFAULT_AUDIO_DEVICES}
          disabled={audioDisabled}
          onChange={(value) => void apply("audio-input", value)}
        />
        <DeviceSelect
          label="Output Device"
          value={audio?.outputDevice ?? "systemDefault"}
          options={audio?.outputDevices ?? DEFAULT_AUDIO_DEVICES}
          disabled={audioDisabled}
          onChange={(value) => void apply("audio-output", value)}
        />
        {state?.errors.audio && (
          <p className="m-0 break-words text-value text-fg-2">{state.errors.audio}</p>
        )}
      </CollapsibleSection>
      <CollapsibleSection
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
        summary="Liquid Glass"
      >
        <Slider
          label="Liquid Glass opacity"
          value={opacity ?? state?.appearance?.liquidGlassOpacity ?? 0.5}
          min={0}
          max={1}
          step={0.01}
          disabled={opacityDisabled}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={setOpacity}
          onCommit={() => {
            if (opacity !== null && !opacityDisabled) void apply("liquid-glass-opacity", opacity);
          }}
        />
        {state?.errors.appearance && (
          <p className="m-0 break-words text-value text-fg-2">{state.errors.appearance}</p>
        )}
      </CollapsibleSection>
      <CollapsibleSection
        open={biometricsOpen}
        onOpenChange={setBiometricsOpen}
        summary={biometricLabel}
      >
        <SettingSwitch
          label={`${biometricLabel} Enrolled`}
          checked={biometric?.enabled ?? false}
          disabled={biometricsDisabled}
          onChange={(value) => void apply("biometrics-enrolled", value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={biometricsDisabled || !biometric?.enabled}
            className={BUTTON_CLASS}
            onClick={() => void apply("biometric-match", true)}
          >
            {touch ? "Matching Touch" : "Matching Biometric"}
          </button>
          <button
            type="button"
            disabled={biometricsDisabled || !biometric?.enabled}
            className={BUTTON_CLASS}
            onClick={() => void apply("biometric-match", false)}
          >
            {touch ? "Non-matching Touch" : "Non-matching Biometric"}
          </button>
        </div>
        {state?.errors.biometrics && (
          <p className="m-0 break-words text-value text-fg-2">{state.errors.biometrics}</p>
        )}
        {state?.biometrics?.length === 0 && (
          <p className="m-0 text-value text-fg-2">Biometrics are not supported by this device</p>
        )}
      </CollapsibleSection>
      <CollapsibleSection open={hardwareOpen} onOpenChange={setHardwareOpen} summary="Hardware">
        <DeviceSelect
          label="Physical Orientation"
          value={state?.orientation ?? "portrait"}
          options={ORIENTATION_OPTIONS}
          disabled={!state?.orientation || pending}
          onChange={(value) => void apply("orientation", value)}
        />
        {state?.errors.orientation && (
          <p className="m-0 break-words text-value text-fg-2">{state.errors.orientation}</p>
        )}
        <button type="button" aria-label="Action Button" disabled className={BUTTON_CLASS}>
          Action Button
        </button>
        <p className="m-0 text-value text-fg-2">Not supported by this device</p>
      </CollapsibleSection>
      <CollapsibleSection open={clipboardOpen} onOpenChange={setClipboardOpen} summary="Clipboard">
        <SettingSwitch
          label="Use Shared Clipboard"
          checked={state?.sharedClipboard ?? false}
          disabled={clipboardDisabled}
          onChange={(value) => void apply("shared-clipboard", value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-label="Send Clipboard"
            disabled={clipboardDisabled}
            className={BUTTON_CLASS}
            onClick={() => void apply("clipboard-send", undefined)}
          >
            Send Clipboard
          </button>
          <button
            type="button"
            aria-label="Get Clipboard"
            disabled={clipboardDisabled}
            className={BUTTON_CLASS}
            onClick={() => void apply("clipboard-get", undefined)}
          >
            Get Clipboard
          </button>
        </div>
        <p className="m-0 text-value text-fg-2">
          Send copies the Mac host clipboard to this device. Get replaces the Mac host clipboard
          with this device’s clipboard.
        </p>
        <p className="m-0 text-value text-fg-2">
          Sharing is off until you enable it, and stops when the preview server closes.
        </p>
      </CollapsibleSection>
    </>
  );
}
