import { useCallback, useEffect, useMemo, useState } from "react";
import { Chevron, ReloadIcon } from "../icons";
import { execOnHost, shellEscape } from "../utils/exec";

// Drives the `headless-serve-sim defaults` passthrough: Load runs `defaults read`
// (export → host plutil → JSON), editing a scalar runs `defaults write`, and the
// trash button runs `defaults delete`. The defaults tool runs INSIDE the
// simulator, so cfprefsd may cache a running app's values — hence the relaunch
// hint. Nested dict/array values are rendered read-only as compact JSON.

type DefaultsType = "string" | "int" | "float" | "bool";
const SCALAR_TYPES: DefaultsType[] = ["string", "int", "float", "bool"];

interface Row {
  key: string;
  /** A scalar type drives an editable control; null marks a nested value. */
  type: DefaultsType | null;
  /** String form of a scalar value, or compact JSON for a nested value. */
  value: string;
}

// Inline hover styles — :hover/:focus/:disabled can't live in inline `style`,
// so emit a small sheet keyed off the shared lem-* classnames. Mirrors
// status-bar-tool.tsx so the look stays consistent.
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
.lem-trash:hover:not(:disabled) { color: #f87171; }
.lem-trash:disabled { opacity: 0.4; cursor: not-allowed; }
`;

// Classify a parsed JSON value into an editable scalar row or a read-only one.
function rowsFromJson(parsed: unknown): Row[] {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const out: Row[] = [];
  for (const [key, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string") {
      out.push({ key, type: "string", value: v });
    } else if (typeof v === "boolean") {
      out.push({ key, type: "bool", value: v ? "true" : "false" });
    } else if (typeof v === "number") {
      out.push({ key, type: Number.isInteger(v) ? "int" : "float", value: String(v) });
    } else {
      // dict / array — rendered read-only as compact JSON.
      out.push({ key, type: null, value: JSON.stringify(v) });
    }
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

export function UserDefaultsTool({
  udid,
  bundleId,
}: {
  udid: string;
  bundleId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState(bundleId ?? "");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<DefaultsType>("string");
  const [newValue, setNewValue] = useState("");

  // Resolve the in-page CLI runner the same way app-permissions-tool does, so
  // the card drives the `defaults` passthrough rather than simctl directly.
  const cliPrefix = useMemo(() => {
    const bin = window.__SIM_PREVIEW__?.serveSimBin;
    if (!bin) return "headless-serve-sim";
    if (/\.ts$/.test(bin)) return `bun ${shellEscape(bin)}`;
    if (/\.js$/.test(bin)) return `node ${shellEscape(bin)}`;
    return shellEscape(bin);
  }, []);

  // Re-seed the domain and clear loaded rows whenever the foreground app changes.
  useEffect(() => {
    setDomain(bundleId ?? "");
    setRows(null);
    setError(null);
  }, [bundleId]);

  const load = useCallback(async () => {
    const dom = domain.trim();
    if (!dom) {
      setError("Enter a domain (bundle id or suite id) to load.");
      return;
    }
    setPending("__load__");
    setError(null);
    try {
      const res = await execOnHost(
        `${cliPrefix} defaults read ${shellEscape(dom)} -d ${shellEscape(udid)}`,
      );
      if (res.exitCode !== 0) {
        setError(res.stderr.trim() || `defaults read failed (exit ${res.exitCode})`);
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.stdout.trim() || "{}");
      } catch {
        setError("Could not parse defaults output.");
        return;
      }
      setRows(rowsFromJson(parsed));
    } finally {
      setPending(null);
    }
  }, [cliPrefix, udid, domain]);

  const write = useCallback(
    async (key: string, type: DefaultsType, value: string, pendingKey: string) => {
      const dom = domain.trim();
      setPending(pendingKey);
      setError(null);
      try {
        const res = await execOnHost(
          `${cliPrefix} defaults write ${shellEscape(dom)} ${shellEscape(key)} ` +
            `--type ${type} ${shellEscape(value)} -d ${shellEscape(udid)}`,
        );
        if (res.exitCode !== 0) {
          setError(res.stderr.trim() || `defaults write failed (exit ${res.exitCode})`);
          return false;
        }
        return true;
      } finally {
        setPending(null);
      }
    },
    [cliPrefix, udid, domain],
  );

  // Commit an edited scalar value, then patch the row in place on success.
  const commit = useCallback(
    async (key: string, type: DefaultsType, value: string) => {
      const ok = await write(key, type, value, `write:${key}`);
      if (ok) {
        setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, value } : r)) ?? rs);
      }
    },
    [write],
  );

  const remove = useCallback(
    async (key: string) => {
      const dom = domain.trim();
      setPending(`delete:${key}`);
      setError(null);
      try {
        const res = await execOnHost(
          `${cliPrefix} defaults delete ${shellEscape(dom)} ${shellEscape(key)} -d ${shellEscape(udid)}`,
        );
        if (res.exitCode !== 0) {
          setError(res.stderr.trim() || `defaults delete failed (exit ${res.exitCode})`);
          return;
        }
        setRows((rs) => rs?.filter((r) => r.key !== key) ?? rs);
      } finally {
        setPending(null);
      }
    },
    [cliPrefix, udid, domain],
  );

  const add = useCallback(async () => {
    const key = newKey.trim();
    if (!key) {
      setError("Enter a key name to add.");
      return;
    }
    const ok = await write(key, newType, newValue, "__add__");
    if (ok) {
      setRows((rs) => {
        const next = (rs ?? []).filter((r) => r.key !== key);
        next.push({ key, type: newType, value: newValue });
        next.sort((a, b) => a.key.localeCompare(b.key));
        return next;
      });
      setNewKey("");
      setNewValue("");
    }
  }, [write, newKey, newType, newValue]);

  if (!bundleId) {
    return (
      <div className="bg-panel border border-dashed border-white/10 rounded-[10px] p-4 text-white/50 text-[12px] text-center">
        User Defaults appear once an app is in the foreground.
      </div>
    );
  }

  return (
    <div className="bg-panel border border-white/8 rounded-[10px] flex flex-col gap-2.5 px-3 py-2">
      <style>{HOVER_CSS}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lem-toggle grid [grid-template-columns:auto_1fr_auto] items-center gap-2 bg-transparent border-none text-white/90 py-2.5 px-1 -my-2 -mx-1 cursor-pointer w-[calc(100%+8px)] text-left min-h-[36px] leading-none"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold text-white/50 uppercase tracking-[0.08em] leading-none inline-flex items-center">
          User Defaults
        </span>
        <span />
        <Chevron open={open} />
      </button>

      {open && (
        <>
          <p className="m-0 text-[10px] leading-[1.5] text-white/45">
            Changes may require relaunching the app to take effect.
          </p>

          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 min-w-0 flex-1">
              <span className="text-[9px] uppercase tracking-[0.06em] text-white/45">Domain</span>
              <input
                type="text"
                value={domain}
                onChange={(e) => {
                  // Editing the domain orphans the loaded rows — they belong to
                  // the previous domain, but write/delete read the live domain.
                  // Clear them so a stale row can't mutate the wrong domain.
                  setDomain((e.target as HTMLInputElement).value);
                  setRows(null);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") load();
                }}
                placeholder="com.example.app"
                spellCheck={false}
                className="lem-input appearance-none bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] font-mono py-1.5 px-2 font-[inherit] w-full [transition:background_0.12s,border-color_0.12s]"
                aria-label="Defaults domain"
              />
            </label>
            <button
              type="button"
              onClick={load}
              disabled={pending !== null}
              className="lem-ghost inline-flex items-center gap-1.5 py-1.5 px-2.5 border border-white/12 rounded-[7px] text-[12px] font-medium bg-transparent text-white/85 cursor-pointer font-[inherit] [transition:background_0.12s,border-color_0.12s,color_0.12s]"
              title="Read this domain's defaults"
            >
              <ReloadIcon size={14} strokeWidth={2.4} />
              {pending === "__load__" ? "…" : "Load"}
            </button>
          </div>

          {rows !== null && (
            <div className="flex flex-col gap-1 max-h-[260px] overflow-y-auto [scrollbar-width:thin] py-0.5">
              {rows.length === 0 && (
                <p className="m-0 text-[11px] text-white/40 px-0.5 py-1">
                  No preferences set for this domain.
                </p>
              )}
              {rows.map((row) => (
                <DefaultsRow
                  key={row.key}
                  row={row}
                  pending={pending}
                  onCommit={commit}
                  onRemove={remove}
                />
              ))}
            </div>
          )}

          {rows !== null && (
            <div className="flex items-end gap-2 border-t border-white/8 pt-2.5">
              <label className="flex flex-col gap-1 min-w-0 flex-1">
                <span className="text-[9px] uppercase tracking-[0.06em] text-white/45">Key</span>
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey((e.target as HTMLInputElement).value)}
                  placeholder="NewKey"
                  spellCheck={false}
                  className="lem-input appearance-none bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] font-mono py-1.5 px-2 font-[inherit] w-full [transition:background_0.12s,border-color_0.12s]"
                  aria-label="New key name"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-[0.06em] text-white/45">Type</span>
                <TypeSelect value={newType} onChange={setNewType} />
              </label>
              <label className="flex flex-col gap-1 min-w-0 flex-1">
                <span className="text-[9px] uppercase tracking-[0.06em] text-white/45">Value</span>
                <input
                  type="text"
                  value={newValue}
                  onChange={(e) => setNewValue((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") add();
                  }}
                  placeholder={newType === "bool" ? "true / false" : "value"}
                  spellCheck={false}
                  className="lem-input appearance-none bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] font-mono py-1.5 px-2 font-[inherit] w-full [transition:background_0.12s,border-color_0.12s]"
                  aria-label="New value"
                />
              </label>
              <button
                type="button"
                onClick={add}
                disabled={pending !== null || !newKey.trim()}
                className="lem-primary inline-flex items-center justify-center py-1.5 px-3 border-none rounded-[7px] text-[12px] font-semibold cursor-pointer font-[inherit] bg-accent text-[#0b1020]"
              >
                {pending === "__add__" ? "…" : "Add"}
              </button>
            </div>
          )}

          {error && (
            <div className="bg-danger/10 border border-danger/20 text-danger-soft text-[11px] px-2 py-1.5 rounded-md break-words" role="alert">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───

function DefaultsRow({
  row,
  pending,
  onCommit,
  onRemove,
}: {
  row: Row;
  pending: string | null;
  onCommit: (key: string, type: DefaultsType, value: string) => void;
  onRemove: (key: string) => void;
}) {
  const [draft, setDraft] = useState(row.value);

  // Keep the field in sync when an external load replaces this row's value.
  useEffect(() => setDraft(row.value), [row.value]);

  const busy = pending === `write:${row.key}` || pending === `delete:${row.key}`;
  const dirty = draft !== row.value;

  return (
    <div className="flex items-center gap-2 bg-white/[0.03] border border-white/8 rounded-[7px] px-2 py-1.5">
      <span className="shrink-0 text-[9px] tracking-[0.08em] uppercase text-white/55 bg-white/[0.06] border border-white/8 px-[6px] py-[2px] rounded-full font-mono">
        {row.type ?? "json"}
      </span>
      <span
        className="shrink-0 max-w-[110px] truncate text-[12px] text-white/90 font-mono"
        title={row.key}
      >
        {row.key}
      </span>
      <div className="flex-1 min-w-0">
        {row.type === null ? (
          <code className="block truncate text-[11px] text-white/45 font-mono" title={row.value}>
            {row.value}
          </code>
        ) : row.type === "bool" ? (
          <BoolToggle
            value={draft === "true"}
            disabled={busy}
            onChange={(v) => onCommit(row.key, "bool", v ? "true" : "false")}
          />
        ) : (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft((e.target as HTMLInputElement).value)}
            onBlur={() => {
              if (dirty) onCommit(row.key, row.type as DefaultsType, draft);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            disabled={busy}
            spellCheck={false}
            className="lem-input appearance-none bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] font-mono py-1 px-2 font-[inherit] w-full [transition:background_0.12s,border-color_0.12s]"
            aria-label={`Value for ${row.key}`}
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(row.key)}
        disabled={busy}
        aria-label={`Delete ${row.key}`}
        title="Delete key"
        className="lem-trash shrink-0 flex items-center justify-center w-6 h-6 border-none rounded p-0 bg-transparent text-white/55 cursor-pointer [transition:color_0.12s]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
}

function BoolToggle({
  value,
  disabled,
  onChange,
}: {
  value: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className="relative inline-flex h-[20px] w-[36px] items-center rounded-full border border-white/8 cursor-pointer [transition:background_0.15s] disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ background: value ? "#4ade80" : "rgba(255,255,255,0.12)" }}
    >
      <span
        className="inline-block h-[14px] w-[14px] rounded-full bg-white [transition:transform_0.15s]"
        style={{ transform: value ? "translateX(18px)" : "translateX(3px)" }}
      />
    </button>
  );
}

function TypeSelect({
  value,
  onChange,
}: {
  value: DefaultsType;
  onChange: (v: DefaultsType) => void;
}) {
  return (
    <div className="relative block">
      <select
        value={value}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value as DefaultsType)}
        className="lem-select appearance-none [-webkit-appearance:none] bg-white/[0.04] border border-white/8 rounded-md text-white/90 text-[12px] py-1.5 pr-[26px] pl-2 font-[inherit] cursor-pointer [transition:background_0.12s,border-color_0.12s]"
        aria-label="New value type"
      >
        {SCALAR_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <span className="absolute right-[9px] top-1/2 -translate-y-1/2 pointer-events-none flex items-center" aria-hidden="true">
        <Chevron open={false} />
      </span>
    </div>
  );
}
