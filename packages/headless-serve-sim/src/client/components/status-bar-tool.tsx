import { Signal } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Field, LiveSlider, Note } from "../inspector/device-rows";
import { Button } from "../ui/button";
import { Stepper, TextField, ValueChip } from "../ui/field";
import { Disclosure } from "../ui/group";
import { Select } from "../ui/select";
import { execOnHost, shellEscape } from "../utils/exec";

// Mirrors the simctl status_bar enum sets (see `xcrun simctl help status_bar`).
const DATA_NETWORK = [
  "hide",
  "wifi",
  "3g",
  "4g",
  "lte",
  "lte-a",
  "lte+",
  "5g",
  "5g+",
  "5g-uwb",
  "5g-uc",
] as const;
const WIFI_MODE = ["searching", "failed", "active"] as const;
const CELLULAR_MODE = ["notSupported", "searching", "failed", "active"] as const;
const BATTERY_STATE = ["charging", "charged", "discharging"] as const;

// Display names for the simctl values; "" leaves the field un-overridden.
const OPTION_LABELS: Record<string, string> = {
  "": "Unchanged",
  hide: "Hidden",
  wifi: "Wi‑Fi",
  "3g": "3G",
  "4g": "4G",
  lte: "LTE",
  "lte-a": "LTE‑A",
  "lte+": "LTE+",
  "5g": "5G",
  "5g+": "5G+",
  "5g-uwb": "5G UW",
  "5g-uc": "5G UC",
  searching: "Searching",
  failed: "Failed",
  active: "Active",
  notSupported: "Not supported",
  charging: "Charging",
  charged: "Charged",
  discharging: "Discharging",
};

/** Menu options for a simctl enum, led by "Unchanged" (no override). */
export function statusBarOptions(values: readonly string[]) {
  return ["", ...values].map((value) => ({ value, label: OPTION_LABELS[value] ?? value }));
}

/**
 * The number a stepper or slider shows for a field. Unset fields show the
 * stock full-strength value, which is what the device shows without an
 * override; they still aren't sent until the user changes them.
 */
export function statusBarNumber(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

interface Fields {
  time: string;
  dataNetwork: string;
  cellularBars: string;
  cellularMode: string;
  wifiBars: string;
  wifiMode: string;
  operatorName: string;
  batteryState: string;
  batteryLevel: string;
}

const EMPTY: Fields = {
  time: "",
  dataNetwork: "",
  cellularBars: "",
  cellularMode: "",
  wifiBars: "",
  wifiMode: "",
  operatorName: "",
  batteryState: "",
  batteryLevel: "",
};

// Field -> simctl override flag, in the order they're appended to the command.
const FLAG_BY_FIELD: ReadonlyArray<[keyof Fields, string]> = [
  ["time", "--time"],
  ["dataNetwork", "--data-network"],
  ["cellularBars", "--cellular-bars"],
  ["cellularMode", "--cellular-mode"],
  ["wifiBars", "--wifi-bars"],
  ["wifiMode", "--wifi-mode"],
  ["operatorName", "--operator-name"],
  ["batteryState", "--battery-state"],
  ["batteryLevel", "--battery-level"],
];

export function StatusBarTool({ udid, defaultOpen }: { udid: string; defaultOpen?: boolean }) {
  const [pending, setPending] = useState<"override" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);

  // Resolve the in-page CLI runner the same way app-permissions-tool does, so
  // the card drives the `status-bar` passthrough rather than simctl directly.
  const cliPrefix = useMemo(() => {
    // No window while server-rendering (tests); fall back to the PATH binary.
    const bin = typeof window === "undefined" ? undefined : window.__SIM_PREVIEW__?.serveSimBin;
    if (!bin) return "headless-serve-sim";
    if (/\.ts$/.test(bin)) return `bun ${shellEscape(bin)}`;
    if (/\.js$/.test(bin)) return `node ${shellEscape(bin)}`;
    return shellEscape(bin);
  }, []);

  const set = useCallback(
    <K extends keyof Fields>(key: K, value: Fields[K]) =>
      setFields((f) => ({ ...f, [key]: value })),
    [],
  );

  const applyPreset = useCallback(() => {
    setFields({
      ...EMPTY,
      time: "9:41",
      dataNetwork: "5g",
      cellularBars: "4",
      wifiBars: "3",
      batteryLevel: "100",
      batteryState: "charged",
    });
  }, []);

  const apply = useCallback(async () => {
    const parts: string[] = [];
    for (const [field, flag] of FLAG_BY_FIELD) {
      const v = fields[field].trim();
      if (v) parts.push(`${flag} ${shellEscape(v)}`);
    }
    if (parts.length === 0) {
      setError("Set at least one field before applying.");
      return;
    }
    setPending("override");
    setError(null);
    try {
      const res = await execOnHost(
        `${cliPrefix} status-bar override ${parts.join(" ")} -d ${shellEscape(udid)}`,
      );
      if (res.exitCode !== 0) {
        setError(res.stderr.trim() || `status-bar override failed (exit ${res.exitCode})`);
      }
    } finally {
      setPending(null);
    }
  }, [cliPrefix, udid, fields]);

  const reset = useCallback(async () => {
    setPending("clear");
    setError(null);
    try {
      const res = await execOnHost(`${cliPrefix} status-bar clear -d ${shellEscape(udid)}`);
      if (res.exitCode !== 0) {
        setError(res.stderr.trim() || `status-bar clear failed (exit ${res.exitCode})`);
        return;
      }
      setFields(EMPTY);
    } finally {
      setPending(null);
    }
  }, [cliPrefix, udid]);

  return (
    <Disclosure title="Status bar" icon={<Signal />} defaultOpen={defaultOpen}>
      <Note>Overrides apply to apps using the standard status bar and reset on reboot.</Note>
      <Field label="Time">
        <TextField
          mono
          inputMode="numeric"
          placeholder="9:41"
          aria-label="Time"
          value={fields.time}
          onChange={(e) => set("time", e.target.value)}
          className="w-[132px]"
        />
      </Field>
      <Field label="Network">
        <Select
          label="Data network"
          value={fields.dataNetwork}
          onChange={(v) => set("dataNetwork", v)}
          options={statusBarOptions(DATA_NETWORK)}
        />
      </Field>
      <Field label="Cellular bars">
        <Stepper
          label="Cellular bars"
          value={statusBarNumber(fields.cellularBars, 4)}
          min={0}
          max={4}
          onChange={(v) => set("cellularBars", String(v))}
        />
      </Field>
      <Field label="Cellular mode">
        <Select
          label="Cellular mode"
          value={fields.cellularMode}
          onChange={(v) => set("cellularMode", v)}
          options={statusBarOptions(CELLULAR_MODE)}
        />
      </Field>
      <Field label="Wi‑Fi bars">
        <Stepper
          label="Wi‑Fi bars"
          value={statusBarNumber(fields.wifiBars, 3)}
          min={0}
          max={3}
          onChange={(v) => set("wifiBars", String(v))}
        />
      </Field>
      <Field label="Wi‑Fi mode">
        <Select
          label="Wi‑Fi mode"
          value={fields.wifiMode}
          onChange={(v) => set("wifiMode", v)}
          options={statusBarOptions(WIFI_MODE)}
        />
      </Field>
      <Field label="Operator">
        <TextField
          placeholder="Carrier"
          maxLength={32}
          aria-label="Operator name"
          value={fields.operatorName}
          onChange={(e) => set("operatorName", e.target.value)}
          className="w-[132px]"
        />
      </Field>
      <Field label="Battery">
        <Select
          label="Battery state"
          value={fields.batteryState}
          onChange={(v) => set("batteryState", v)}
          options={statusBarOptions(BATTERY_STATE)}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <Field label="Battery level">
          <ValueChip>{statusBarNumber(fields.batteryLevel, 100)}%</ValueChip>
        </Field>
        <LiveSlider
          label="Battery level"
          value={statusBarNumber(fields.batteryLevel, 100)}
          min={0}
          max={100}
          step={1}
          onChange={(v) => set("batteryLevel", String(Math.round(v)))}
        />
      </div>
      <div className="flex items-center gap-1.5 pt-1">
        <Button
          variant="secondary"
          size="md"
          onClick={applyPreset}
          title="Fill the form with the 9:41 keynote preset"
        >
          9:41 Keynote
        </Button>
        <span className="flex-1" />
        <Button
          variant="plain"
          size="md"
          onClick={reset}
          disabled={pending !== null}
          title="Clear all status bar overrides"
        >
          {pending === "clear" ? "Resetting…" : "Reset"}
        </Button>
        <Button variant="primary" size="md" onClick={apply} disabled={pending !== null}>
          {pending === "override" ? "Applying…" : "Apply"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-footnote break-words text-red">
          {error}
        </p>
      )}
    </Disclosure>
  );
}
