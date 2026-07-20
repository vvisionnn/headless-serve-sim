import { useCallback, useMemo, useState } from "react";
import { Chevron } from "../icons";
import { Select as SelectMenu } from "./select";
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

// Inline hover styles — :hover/:focus/:disabled can't live in inline `style`,
// so emit a small sheet keyed off the shared lem-* classnames. Mirrors
// location-emulation-tool.tsx so the look stays consistent.
const HOVER_CSS = `
.lem-toggle:hover { color: var(--color-fg); }
.lem-toggle:hover .lem-chevron { color: var(--color-fg) !important; }
.lem-select:hover { background: var(--color-hover); border-color: var(--color-divider); }
.lem-select:focus { outline: none; border-color: var(--color-accent-solid); box-shadow: 0 0 0 2px var(--color-accent-solid); }
.lem-input:hover { background: var(--color-hover); border-color: var(--color-divider); }
.lem-input:focus-visible { outline: none; border-color: var(--color-accent-solid); box-shadow: 0 0 0 2px var(--color-accent-solid); }
.lem-primary:hover:not(:disabled) { filter: brightness(1.06); }
.lem-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.lem-ghost:hover:not(:disabled) { background: var(--color-hover); border-color: var(--color-divider); color: var(--color-fg); }
.lem-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.lem-primary:focus-visible, .lem-ghost:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-accent-solid); }
`;

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

export function StatusBarTool({ udid }: { udid: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<"override" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);

  // Resolve the in-page CLI runner the same way app-permissions-tool does, so
  // the card drives the `status-bar` passthrough rather than simctl directly.
  const cliPrefix = useMemo(() => {
    const bin = window.__SIM_PREVIEW__?.serveSimBin;
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
    <div className="bg-panel border border-divider rounded-card overflow-hidden">
      <style>{HOVER_CSS}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lem-toggle flex items-center justify-between gap-2.5 px-3.5 min-h-[44px] w-full bg-transparent border-none text-left cursor-pointer select-none [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent-solid)]"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">
          Status Bar
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="border-t border-divider px-3.5 py-3 flex flex-col gap-2">
          <p className="m-0 text-[12px] leading-[1.5] text-fg-3">
            Overrides only affect apps using the standard status bar and reset on reboot.
          </p>

          <div className="flex flex-col gap-2.5">
            <Field label="Time">
              <input
                type="text"
                inputMode="numeric"
                value={fields.time}
                onChange={(e) => set("time", e.target.value)}
                placeholder="9:41"
                className="lem-input appearance-none bg-surface-3 rounded-card border border-divider text-fg text-[13px] font-mono py-2 px-2.5 font-[inherit] w-full [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.24s_cubic-bezier(0.4,0,0.6,1)]"
                aria-label="Time"
              />
            </Field>

            <Field label="Data network">
              <Select
                value={fields.dataNetwork}
                onChange={(v) => set("dataNetwork", v)}
                options={DATA_NETWORK}
                ariaLabel="Data network"
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Cellular bars">
                <NumberInput
                  value={fields.cellularBars}
                  onChange={(v) => set("cellularBars", v)}
                  min={0}
                  max={4}
                  ariaLabel="Cellular bars"
                />
              </Field>
              <Field label="Cellular mode">
                <Select
                  value={fields.cellularMode}
                  onChange={(v) => set("cellularMode", v)}
                  options={CELLULAR_MODE}
                  ariaLabel="Cellular mode"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="WiFi bars">
                <NumberInput
                  value={fields.wifiBars}
                  onChange={(v) => set("wifiBars", v)}
                  min={0}
                  max={3}
                  ariaLabel="WiFi bars"
                />
              </Field>
              <Field label="WiFi mode">
                <Select
                  value={fields.wifiMode}
                  onChange={(v) => set("wifiMode", v)}
                  options={WIFI_MODE}
                  ariaLabel="WiFi mode"
                />
              </Field>
            </div>

            <Field label="Operator name">
              <input
                type="text"
                value={fields.operatorName}
                onChange={(e) => set("operatorName", e.target.value)}
                placeholder="Carrier"
                maxLength={32}
                className="lem-input appearance-none bg-surface-3 rounded-card border border-divider text-fg text-[13px] py-2 px-2.5 font-[inherit] w-full [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.24s_cubic-bezier(0.4,0,0.6,1)]"
                aria-label="Operator name"
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Battery state">
                <Select
                  value={fields.batteryState}
                  onChange={(v) => set("batteryState", v)}
                  options={BATTERY_STATE}
                  ariaLabel="Battery state"
                />
              </Field>
              <Field label="Battery level">
                <NumberInput
                  value={fields.batteryLevel}
                  onChange={(v) => set("batteryLevel", v)}
                  min={0}
                  max={100}
                  ariaLabel="Battery level"
                />
              </Field>
            </div>
          </div>

          <div className="flex">
            <button
              type="button"
              onClick={applyPreset}
              className="lem-ghost rounded-pill bg-transparent border border-divider text-fg-2 text-[12px] px-3 py-1 cursor-pointer tracking-[-0.01em] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.24s_cubic-bezier(0.4,0,0.6,1)]"
              title="Fill the form with the 9:41 keynote preset"
            >
              9:41 keynote
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={apply}
              disabled={pending !== null}
              className="lem-primary rounded-pill flex-1 flex items-center justify-center py-2 px-4 border-none text-[13px] font-semibold tracking-[-0.01em] cursor-pointer font-[inherit] bg-accent-solid text-white [transition:filter_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.24s_cubic-bezier(0.4,0,0.6,1)]"
            >
              {pending === "override" ? "…" : "Apply"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending !== null}
              className="lem-ghost rounded-pill flex items-center justify-center py-2 px-4 border border-divider text-[13px] font-medium tracking-[-0.01em] bg-transparent text-fg cursor-pointer font-[inherit] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.24s_cubic-bezier(0.4,0,0.6,1)]"
              title="Clear all status bar overrides"
            >
              {pending === "clear" ? "…" : "Reset"}
            </button>
          </div>

          {error && (
            <div className="bg-surface-3 rounded-card border border-divider text-danger text-[12px] leading-[1.45] tracking-[-0.01em] px-3 py-2">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[12px] text-fg-3 tracking-[-0.01em]">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  ariaLabel: string;
}) {
  return (
    <div className="relative block">
      <SelectMenu
        label={ariaLabel}
        value={value}
        options={[{ value: "", label: "unset" }, ...options.map((o) => ({ value: o, label: o }))]}
        onChange={onChange}
        className="lem-select bg-surface-3 rounded-card border border-divider text-fg text-[13px] py-2 pr-[28px] pl-2.5 w-full [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1)]"
      />
      <span
        className="absolute right-[10px] top-1/2 -translate-y-1/2 pointer-events-none flex items-center"
        aria-hidden="true"
      >
        <Chevron open={false} />
      </span>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      min={min}
      max={max}
      placeholder={`${min}–${max}`}
      className="lem-input appearance-none bg-surface-3 rounded-card border border-divider text-fg text-[13px] font-mono py-2 px-2.5 font-[inherit] w-full [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),border-color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.24s_cubic-bezier(0.4,0,0.6,1)]"
      aria-label={ariaLabel}
    />
  );
}
