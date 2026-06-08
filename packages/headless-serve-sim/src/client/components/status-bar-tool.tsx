import { useCallback, useMemo, useState } from "react";
import { Chevron } from "../icons";
import { execOnHost, shellEscape } from "../utils/exec";

// Mirrors the simctl status_bar enum sets (see `xcrun simctl help status_bar`).
const DATA_NETWORK = [
  "hide", "wifi", "3g", "4g", "lte", "lte-a", "lte+", "5g", "5g+", "5g-uwb", "5g-uc",
] as const;
const WIFI_MODE = ["searching", "failed", "active"] as const;
const CELLULAR_MODE = ["notSupported", "searching", "failed", "active"] as const;
const BATTERY_STATE = ["charging", "charged", "discharging"] as const;

// Inline hover styles — :hover/:focus/:disabled can't live in inline `style`,
// so emit a small sheet keyed off the shared lem-* classnames. Mirrors
// location-emulation-tool.tsx so the look stays consistent.
const HOVER_CSS = `
.lem-toggle:hover { color: #fff; }
.lem-toggle:hover .lem-chevron { color: rgba(255,255,255,0.85) !important; }
.lem-select:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.16); }
.lem-select:focus { outline: none; border-color: rgba(255,255,255,0.24); background: rgba(255,255,255,0.08); }
.lem-input:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.16); }
.lem-input:focus { outline: none; border-color: rgba(255,255,255,0.24); background: rgba(255,255,255,0.08); }
.lem-primary:hover:not(:disabled) { filter: brightness(1.08); }
.lem-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.lem-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.2); color: #fff; }
.lem-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
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
    <div className="bg-panel border border-white/8 rounded-[10px] flex flex-col gap-2.5 px-3 py-2">
      <style>{HOVER_CSS}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lem-toggle grid [grid-template-columns:auto_1fr_auto] items-center gap-2 bg-transparent border-none text-white/90 py-2.5 px-1 -my-2 -mx-1 cursor-pointer w-[calc(100%+8px)] text-left min-h-[36px] leading-none"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold text-white/50 uppercase tracking-[0.08em] leading-none inline-flex items-center">Status Bar</span>
        <span />
        <Chevron open={open} />
      </button>

      {open && (
        <>
          <p className="m-0 text-[10px] leading-[1.5] text-white/45">
            Overrides only affect apps using the standard status bar and reset on reboot.
          </p>

          <div className="flex flex-col gap-2">
            <Field label="Time">
              <input
                type="text"
                inputMode="numeric"
                value={fields.time}
                onChange={(e) => set("time", e.target.value)}
                placeholder="9:41"
                className="lem-input appearance-none bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] font-mono py-1.5 px-2 font-[inherit] w-full [transition:background_0.12s,border-color_0.12s]"
                aria-label="Time"
              />
            </Field>

            <Field label="Data network">
              <Select value={fields.dataNetwork} onChange={(v) => set("dataNetwork", v)} options={DATA_NETWORK} ariaLabel="Data network" />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Cellular bars">
                <NumberInput value={fields.cellularBars} onChange={(v) => set("cellularBars", v)} min={0} max={4} ariaLabel="Cellular bars" />
              </Field>
              <Field label="Cellular mode">
                <Select value={fields.cellularMode} onChange={(v) => set("cellularMode", v)} options={CELLULAR_MODE} ariaLabel="Cellular mode" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="WiFi bars">
                <NumberInput value={fields.wifiBars} onChange={(v) => set("wifiBars", v)} min={0} max={3} ariaLabel="WiFi bars" />
              </Field>
              <Field label="WiFi mode">
                <Select value={fields.wifiMode} onChange={(v) => set("wifiMode", v)} options={WIFI_MODE} ariaLabel="WiFi mode" />
              </Field>
            </div>

            <Field label="Operator name">
              <input
                type="text"
                value={fields.operatorName}
                onChange={(e) => set("operatorName", e.target.value)}
                placeholder="Carrier"
                maxLength={32}
                className="lem-input appearance-none bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] py-1.5 px-2 font-[inherit] w-full [transition:background_0.12s,border-color_0.12s]"
                aria-label="Operator name"
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Battery state">
                <Select value={fields.batteryState} onChange={(v) => set("batteryState", v)} options={BATTERY_STATE} ariaLabel="Battery state" />
              </Field>
              <Field label="Battery level">
                <NumberInput value={fields.batteryLevel} onChange={(v) => set("batteryLevel", v)} min={0} max={100} ariaLabel="Battery level" />
              </Field>
            </div>
          </div>

          <div className="flex">
            <button
              type="button"
              onClick={applyPreset}
              className="lem-ghost bg-transparent border border-white/12 text-white/70 text-[10px] px-2 py-[3px] rounded-[5px] cursor-pointer uppercase tracking-[0.04em] [transition:background_0.12s,border-color_0.12s,color_0.12s]"
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
              className="lem-primary flex-1 flex items-center justify-center py-2 px-2.5 border-none rounded-[7px] text-[12px] font-semibold cursor-pointer font-[inherit] bg-success-emerald text-[#062018]"
            >
              {pending === "override" ? "…" : "Apply"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending !== null}
              className="lem-ghost flex items-center justify-center py-2 px-3 border border-white/12 rounded-[7px] text-[12px] font-medium bg-transparent text-white/85 cursor-pointer font-[inherit] [transition:background_0.12s,border-color_0.12s,color_0.12s]"
              title="Clear all status bar overrides"
            >
              {pending === "clear" ? "…" : "Reset"}
            </button>
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/20 text-danger-soft text-[11px] px-2 py-1.5 rounded-md">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[9px] uppercase tracking-[0.06em] text-white/45">{label}</span>
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
      <select
        value={value}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
        className="lem-select appearance-none [-webkit-appearance:none] bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] py-1.5 pr-[26px] pl-2 font-[inherit] cursor-pointer w-full [transition:background_0.12s,border-color_0.12s]"
        aria-label={ariaLabel}
      >
        <option value="">unset</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <span className="absolute right-[9px] top-1/2 -translate-y-1/2 pointer-events-none flex items-center" aria-hidden="true">
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
      className="lem-input appearance-none bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] font-mono py-1.5 px-2 font-[inherit] w-full [transition:background_0.12s,border-color_0.12s]"
      aria-label={ariaLabel}
    />
  );
}
