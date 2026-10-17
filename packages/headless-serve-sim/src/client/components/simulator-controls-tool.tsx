import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SimulatorControlOption,
  SimulatorControlState,
  DeviceOrientation,
} from "../../simulator-controls";
import { ClipboardCopy, Cpu, Droplets, FingerprintPattern, Volume2 } from "lucide-react";
import { ErrorNote, Field, Hold, LiveSlider, Note } from "../inspector/device-rows";
import { Button } from "../ui/button";
import { ValueChip } from "../ui/field";
import { Disclosure } from "../ui/group";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { hostSimulatorControlRequest, hostDeviceMotionRequest } from "../utils/exec";

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

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

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
    <Field label={label.charAt(0) + label.slice(1).toLowerCase()}>
      <Hold when={disabled}>
        <Select
          label={label}
          value={value}
          options={options}
          onChange={onChange}
          className={disabled ? "w-[148px] min-w-0 text-label-3" : "w-[148px] min-w-0"}
        />
      </Hold>
    </Field>
  );
}

/** A labelled 0–1 slider with its live percentage, committed on release. */
function LevelField({
  label,
  value,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Field label={label}>
        <ValueChip>{percent(value)}</ValueChip>
      </Field>
      <LiveSlider
        label={label}
        value={value}
        min={0}
        max={1}
        step={0.01}
        disabled={disabled}
        onChange={onChange}
        onCommit={onCommit}
      />
    </div>
  );
}

export function SimulatorControlsTool({
  udid,
  execToken,
  onOrientationChange,
  defaultOpen,
}: {
  udid: string;
  execToken?: string;
  onOrientationChange?: (orientation: ScreenOrientation) => void;
  /** Start every disclosure open (tests render static markup). */
  defaultOpen?: boolean;
}) {
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
        <div role="alert" className="flex flex-col gap-1 px-2.5 text-footnote text-label">
          <p className="m-0 font-semibold break-words text-orange">
            Simulator input is owned by Apple’s window.
          </p>
          <p className="m-0 break-words">
            Headless touches, buttons, and keyboard input may be dropped even when delivery
            succeeds.
          </p>
          <p className="m-0 break-words text-label-2">
            Reclaiming input requires restarting SpringBoard and closes running simulator apps. No
            automatic repair is performed.
          </p>
        </div>
      )}
      {state?.errors.inputAttachment && (
        <Note className="px-2.5">Input ownership unavailable: {state.errors.inputAttachment}</Note>
      )}
      {error && (
        <ErrorNote
          message={error}
          action={
            <Button variant="plain" size="sm" disabled={pending} onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      )}
      <Disclosure title="Sound" icon={<Volume2 />} defaultOpen={defaultOpen}>
        <LevelField
          label="Volume"
          value={volume ?? audio?.volume ?? 0.6}
          disabled={audioDisabled}
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
        {state?.errors.audio && <Note>{state.errors.audio}</Note>}
      </Disclosure>
      <Disclosure title="Liquid Glass" icon={<Droplets />} defaultOpen={defaultOpen}>
        <LevelField
          label="Liquid Glass opacity"
          value={opacity ?? state?.appearance?.liquidGlassOpacity ?? 0.5}
          disabled={opacityDisabled}
          onChange={setOpacity}
          onCommit={() => {
            if (opacity !== null && !opacityDisabled) void apply("liquid-glass-opacity", opacity);
          }}
        />
        {state?.errors.appearance && <Note>{state.errors.appearance}</Note>}
      </Disclosure>
      <Disclosure title={biometricLabel} icon={<FingerprintPattern />} defaultOpen={defaultOpen}>
        <Field label={`${biometricLabel} enrolled`}>
          <Switch
            label={`${biometricLabel} Enrolled`}
            checked={biometric?.enabled ?? false}
            disabled={biometricsDisabled}
            onChange={(value) => void apply("biometrics-enrolled", value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant="secondary"
            size="md"
            disabled={biometricsDisabled || !biometric?.enabled}
            onClick={() => void apply("biometric-match", true)}
          >
            {touch ? "Matching Touch" : "Matching Biometric"}
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={biometricsDisabled || !biometric?.enabled}
            onClick={() => void apply("biometric-match", false)}
          >
            {touch ? "Non-matching Touch" : "Non-matching Biometric"}
          </Button>
        </div>
        {state?.errors.biometrics && <Note>{state.errors.biometrics}</Note>}
        {state?.biometrics?.length === 0 && (
          <Note>Biometrics are not supported by this device</Note>
        )}
      </Disclosure>
      <Disclosure title="Hardware" icon={<Cpu />} defaultOpen={defaultOpen}>
        <DeviceSelect
          label="Physical Orientation"
          value={state?.orientation ?? "portrait"}
          options={ORIENTATION_OPTIONS}
          disabled={!state?.orientation || pending}
          onChange={(value) => void apply("orientation", value)}
        />
        {state?.errors.orientation && <Note>{state.errors.orientation}</Note>}
        <Field label="Action button">
          <Button variant="secondary" size="sm" aria-label="Action Button" disabled>
            Press
          </Button>
        </Field>
        <Note>Not supported by this device</Note>
      </Disclosure>
      <Disclosure title="Clipboard" icon={<ClipboardCopy />} defaultOpen={defaultOpen}>
        <Field label="Use shared clipboard">
          <Switch
            label="Use Shared Clipboard"
            checked={state?.sharedClipboard ?? false}
            disabled={clipboardDisabled}
            onChange={(value) => void apply("shared-clipboard", value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant="secondary"
            size="md"
            aria-label="Send Clipboard"
            disabled={clipboardDisabled}
            onClick={() => void apply("clipboard-send", undefined)}
          >
            Send to device
          </Button>
          <Button
            variant="secondary"
            size="md"
            aria-label="Get Clipboard"
            disabled={clipboardDisabled}
            onClick={() => void apply("clipboard-get", undefined)}
          >
            Get from device
          </Button>
        </div>
        <Note>
          Send copies the Mac host clipboard to this device. Get replaces the Mac host clipboard
          with this device’s clipboard.
        </Note>
        <Note>Sharing is off until you enable it, and stops when the preview server closes.</Note>
      </Disclosure>
    </>
  );
}
