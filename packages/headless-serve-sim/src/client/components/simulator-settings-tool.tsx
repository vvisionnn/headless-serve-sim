import { Contrast, Eye, Moon, SquareDashed, Sun, Volume2, Waves } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorNote, Hold, LiveSlider, SliderRow } from "../inspector/device-rows";
import { Button } from "../ui/button";
import { Row, Section } from "../ui/group";
import { Segmented } from "../ui/segmented";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { hostUiRequest } from "../utils/exec";

// Simulator-wide UI options, mirroring the Xcode Devices app sidebar. Every
// control drives `headless-serve-sim ui <option> <value>`, which handles the
// simctl-native options (appearance, contrast, text size) and the private-
// setter ones (liquid glass, color filter, reduce motion, …) uniformly.

// The slider spans the seven standard content-size categories (the
// accessibility-extended range stays CLI-only); `extra-extra-extra-large` is
// the maximum the control allows.
export const TEXT_SIZE_CATEGORIES = [
  "extra-small",
  "small",
  "medium",
  "large",
  "extra-large",
  "extra-extra-large",
  "extra-extra-extra-large",
] as const;

const TEXT_SIZE_DEBOUNCE_MS = 250;

type SettingsState = Record<string, string>;

// Stock values rendered (disabled) until the real state arrives, so the
// section keeps its full height instead of swapping a "Loading…" line for
// the controls.
const DEFAULT_STATE: SettingsState = {
  appearance: "light",
  "liquid-glass": "clear",
  "color-filter": "none",
  "text-size": "large",
  "reduce-motion": "off",
  "increase-contrast": "off",
  "show-borders": "off",
  "reduce-transparency": "off",
  voiceover: "off",
};

const SELECT_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  appearance: [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ],
  "liquid-glass": [
    { value: "clear", label: "Clear" },
    { value: "tinted", label: "Tinted" },
  ],
  "color-filter": [
    { value: "none", label: "None" },
    { value: "red-green", label: "Red/Green (Protanopia)" },
    { value: "green-red", label: "Green/Red (Deuteranopia)" },
    { value: "blue-yellow", label: "Blue/Yellow (Tritanopia)" },
    { value: "grayscale", label: "Grayscale" },
  ],
};

const SEGMENT_ICONS: Record<string, ReactNode> = {
  light: <Sun />,
  dark: <Moon />,
};

const TOGGLE_OPTIONS = [
  { key: "reduce-motion", label: "Reduce motion", icon: <Waves /> },
  { key: "increase-contrast", label: "Increase contrast", icon: <Contrast /> },
  { key: "show-borders", label: "Show borders", icon: <SquareDashed /> },
  { key: "reduce-transparency", label: "Reduce transparency", icon: <Eye /> },
  { key: "voiceover", label: "VoiceOver", icon: <Volume2 /> },
] as const;

const TEXT_SIZE_LABELS = [
  "Extra small",
  "Small",
  "Medium",
  "Large",
  "Extra large",
  "XX large",
  "XXX large",
] as const;

/** The name shown for a text-size slider stop. */
export function textSizeLabel(index: number): string {
  return TEXT_SIZE_LABELS[index] ?? TEXT_SIZE_LABELS[3];
}

function TextSizeSlider({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (index: number) => void;
}) {
  // Local value while dragging so prop round-trips can't interrupt the
  // gesture. Changes apply live but debounced; release flushes immediately.
  const [drag, setDrag] = useState<number | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef<number | null>(null);

  const send = useCallback(
    (index: number) => {
      if (lastSent.current === index) return;
      lastSent.current = index;
      onChange(index);
    },
    [onChange],
  );

  const handleInput = useCallback(
    (index: number) => {
      setDrag(index);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => send(index), TEXT_SIZE_DEBOUNCE_MS);
    },
    [send],
  );

  const flush = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    setDrag((d) => {
      if (d !== null) send(d);
      return null;
    });
    lastSent.current = null;
  }, [send]);

  const max = TEXT_SIZE_CATEGORIES.length - 1;
  const shown = drag ?? value;

  return (
    <SliderRow label="Text size" value={textSizeLabel(shown)}>
      <LiveSlider
        label="Text size"
        value={shown}
        min={0}
        max={max}
        step={1}
        ticks
        disabled={disabled}
        onChange={(v) => handleInput(Math.round(v))}
        onCommit={flush}
        leading={<span className="w-3 text-center text-caption font-semibold">A</span>}
        trailing={<span className="w-3 text-center text-title3">A</span>}
      />
    </SliderRow>
  );
}

// An enum picks its own control from its shape, not from a house style:
// a handful of short labels reads best laid out flat; a long list, or labels
// like "Red/Green (Protanopia)", only fits behind a menu. Forcing the second
// case into segments is what produced a block of five wrapped buttons.
const SEGMENT_MAX_OPTIONS = 4;
const SEGMENT_MAX_LABEL = 14;

export function fitsSegments(options: Array<{ value: string; label: string }>): boolean {
  return (
    options.length <= SEGMENT_MAX_OPTIONS &&
    options.every((o) => o.label.length <= SEGMENT_MAX_LABEL)
  );
}

function SettingSelect({
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
  onChange: (next: string) => void;
}) {
  return (
    <Row label={label}>
      {fitsSegments(options) ? (
        <Segmented
          aria-label={label}
          className="w-[160px]"
          value={value}
          onChange={onChange}
          items={options.map((o) => ({ ...o, icon: SEGMENT_ICONS[o.value], disabled }))}
        />
      ) : (
        <Hold when={disabled}>
          <Select
            label={label}
            value={value}
            options={options}
            onChange={onChange}
            className={disabled ? "w-[148px] min-w-0 text-label-3" : "w-[148px] min-w-0"}
          />
        </Hold>
      )}
    </Row>
  );
}

export function SimulatorSettingsTool({
  udid,
  execToken,
  refreshKey,
}: {
  udid: string;
  execToken?: string;
  refreshKey?: unknown;
}) {
  const [state, setState] = useState<SettingsState | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hydration can fail outright (server restarted under the tab, control
  // socket unreachable) or stall — both must land in the error state with a
  // Retry, never an eternal disabled section.
  const refresh = useCallback(async () => {
    setError(null);
    try {
      const status = await hostUiRequest({ device: udid }, { signal: AbortSignal.timeout(15_000) });
      if (status) setState(status);
      else setError("Unexpected simulator-settings reply");
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "TimeoutError"
          ? "Timed out reading simulator settings"
          : e instanceof Error && e.message !== "Failed to fetch"
            ? e.message
            : "Could not reach the preview server — reload the page if this persists",
      );
    }
  }, [udid]);

  // Re-hydrate on device change and whenever the control token rotates. A
  // server restart mints a fresh exec token, which closes the old socket; once
  // the live token propagates here we re-auth and clear any stale "socket
  // closed" error on our own, without the user reloading the page.
  useEffect(() => {
    setState(null);
    void refresh();
  }, [refresh, execToken, refreshKey]);

  const apply = useCallback(
    async (option: string, value: string) => {
      setPending(option);
      setError(null);
      setState((s) => (s ? { ...s, [option]: value } : s));
      try {
        await hostUiRequest(
          { device: udid, option, value },
          { signal: AbortSignal.timeout(15_000) },
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : `Failed to set ${option}`);
        // Re-sync from the simulator rather than restoring a snapshot — with
        // rapid queued updates (slider drags) a snapshot can predate several
        // successful sets and would yank the control backwards.
        void refresh();
      } finally {
        setPending(null);
      }
    },
    [udid, refresh],
  );

  // Rapid slider movements queue latest-wins: one exec in flight at a time,
  // intermediate values dropped, so out-of-order completions can't leave the
  // simulator on a stale size.
  const textSizeQueue = useRef<{ running: boolean; next: number | null }>({
    running: false,
    next: null,
  });
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const applyTextSize = useCallback((index: number) => {
    const queue = textSizeQueue.current;
    queue.next = index;
    if (queue.running) return;
    queue.running = true;
    void (async () => {
      while (queue.next !== null) {
        const next = queue.next;
        queue.next = null;
        await applyRef.current("text-size", TEXT_SIZE_CATEGORIES[next]!);
      }
      queue.running = false;
    })();
  }, []);

  const ready = state !== null;
  const shown = state ?? DEFAULT_STATE;
  const rawTextSizeIndex = TEXT_SIZE_CATEGORIES.indexOf(shown["text-size"] as never);
  // CLI-set accessibility-range sizes exceed the slider; pin them to its max.
  const textSizeIndex =
    rawTextSizeIndex >= 0
      ? rawTextSizeIndex
      : shown["text-size"]?.startsWith("accessibility")
        ? TEXT_SIZE_CATEGORIES.length - 1
        : 3;

  return (
    <>
      {error && (
        <ErrorNote
          message={error}
          action={
            <Button variant="plain" size="sm" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      )}

      <Section title="Appearance">
        <SettingSelect
          label="Appearance"
          value={shown.appearance ?? "light"}
          options={SELECT_OPTIONS.appearance!}
          disabled={!ready || pending === "appearance"}
          onChange={(v) => apply("appearance", v)}
        />
        <SettingSelect
          label="Liquid Glass"
          value={shown["liquid-glass"] ?? "clear"}
          options={SELECT_OPTIONS["liquid-glass"]!}
          disabled={!ready || pending === "liquid-glass"}
          onChange={(v) => apply("liquid-glass", v)}
        />
        <SettingSelect
          label="Color filter"
          value={shown["color-filter"] ?? "none"}
          options={SELECT_OPTIONS["color-filter"]!}
          disabled={!ready || pending === "color-filter"}
          onChange={(v) => apply("color-filter", v)}
        />
        <TextSizeSlider value={textSizeIndex} disabled={!ready} onChange={applyTextSize} />
      </Section>

      <Section title="Accessibility">
        {TOGGLE_OPTIONS.map(({ key, label, icon }) => (
          <Row key={key} label={label} icon={icon}>
            <Switch
              label={label}
              checked={shown[key] === "on"}
              disabled={!ready || pending === key}
              onChange={(next) => apply(key, next ? "on" : "off")}
            />
          </Row>
        ))}
      </Section>
    </>
  );
}
