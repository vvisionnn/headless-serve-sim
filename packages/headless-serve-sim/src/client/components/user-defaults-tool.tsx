import { AnimatePresence, motion } from "motion/react";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { spring } from "../lib/motion";
import { Button, IconButton } from "../ui/button";
import { TextField } from "../ui/field";
import { Section } from "../ui/group";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { execOnHost, shellEscape } from "../utils/exec";

// Drives the `headless-serve-sim defaults` passthrough: Load runs `defaults read`
// (export → host plutil → JSON), editing a scalar runs `defaults write`, and the
// trash button runs `defaults delete`. The defaults tool runs INSIDE the
// simulator, so cfprefsd may cache a running app's values — hence the relaunch
// hint. Nested dict/array values are rendered read-only as compact JSON.

type DefaultsType = "string" | "int" | "float" | "bool";

const TYPE_OPTIONS: { value: DefaultsType; label: string }[] = [
  { value: "string", label: "String" },
  { value: "int", label: "Integer" },
  { value: "float", label: "Float" },
  { value: "bool", label: "Boolean" },
];

interface Row {
  key: string;
  /** A scalar type drives an editable control; null marks a nested value. */
  type: DefaultsType | null;
  /** String form of a scalar value, or compact JSON for a nested value. */
  value: string;
}

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

export function UserDefaultsTool({ udid, bundleId }: { udid: string; bundleId: string | null }) {
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
      <Section title="User defaults">
        <div className="row px-3 py-3 text-center text-footnote text-label-3">
          User defaults appear once an app is in the foreground.
        </div>
      </Section>
    );
  }

  return (
    <Section title="User defaults" footer="Changes may need a relaunch to take effect.">
      <div className="row flex gap-1.5 px-3 py-2.5">
        <TextField
          mono
          value={domain}
          onChange={(e) => {
            // Editing the domain orphans the loaded rows — they belong to
            // the previous domain, but write/delete read the live domain.
            // Clear them so a stale row can't mutate the wrong domain.
            setDomain(e.target.value);
            setRows(null);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load();
          }}
          placeholder="com.example.app"
          spellCheck={false}
          aria-label="Defaults domain"
          className="flex-1"
        />
        <Button
          variant="secondary"
          disabled={pending !== null}
          onClick={load}
          title="Read this domain's defaults"
        >
          {pending === "__load__" ? "Loading…" : "Load"}
        </Button>
      </div>

      {rows !== null && rows.length === 0 && (
        <div className="row px-3 py-2.5 text-footnote text-label-3">
          No preferences set for this domain.
        </div>
      )}

      <AnimatePresence initial={false}>
        {rows?.map((row) => (
          <motion.div
            key={row.key}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring.ui}
            className="row group overflow-hidden"
          >
            <DefaultsRow row={row} pending={pending} onCommit={commit} onRemove={remove} />
          </motion.div>
        ))}
      </AnimatePresence>

      {rows !== null && (
        <div className="row flex flex-col gap-1.5 px-3 py-2.5">
          <span className="text-caption font-semibold text-label-3">Add key</span>
          <div className="flex gap-1.5">
            <TextField
              mono
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="NewKey"
              spellCheck={false}
              aria-label="New key name"
              className="flex-1"
            />
            <Select
              label="New value type"
              value={newType}
              onChange={setNewType}
              options={TYPE_OPTIONS}
              className="w-[104px] min-w-0"
            />
          </div>
          <div className="flex gap-1.5">
            <TextField
              mono
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
              placeholder={newType === "bool" ? "true / false" : "Value"}
              spellCheck={false}
              aria-label="New value"
              className="flex-1"
            />
            <Button
              variant="secondary"
              icon={<Plus />}
              disabled={pending !== null || !newKey.trim()}
              onClick={add}
            >
              {pending === "__add__" ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="row px-3 py-2 text-footnote text-red [overflow-wrap:anywhere]" role="alert">
          {error}
        </div>
      )}
    </Section>
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
    <div className="flex min-h-10 items-center gap-2 px-3 py-1.5">
      <span className="w-9 shrink-0 rounded-[5px] bg-fill-2 py-px text-center font-mono text-caption2 font-semibold text-label-2">
        {row.type ?? "json"}
      </span>
      <span
        className="w-[86px] shrink-0 truncate font-mono text-caption text-label"
        title={row.key}
      >
        {row.key}
      </span>
      <span className="flex min-w-0 flex-1 justify-end">
        {row.type === null ? (
          <span
            className="line-clamp-2 font-mono text-caption2 text-label-2 [overflow-wrap:anywhere]"
            title={row.value}
          >
            {row.value}
          </span>
        ) : row.type === "bool" ? (
          <Switch
            label={`Value for ${row.key}`}
            checked={draft === "true"}
            disabled={busy}
            onChange={(v) => onCommit(row.key, "bool", v ? "true" : "false")}
          />
        ) : (
          <TextField
            mono
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (dirty) onCommit(row.key, row.type as DefaultsType, draft);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            disabled={busy}
            spellCheck={false}
            aria-label={`Value for ${row.key}`}
            className="h-6 text-caption"
          />
        )}
      </span>
      <IconButton
        label={`Delete ${row.key}`}
        title="Delete key"
        size="sm"
        disabled={busy}
        className="text-label-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red focus-visible:opacity-100"
        onClick={() => onRemove(row.key)}
      >
        <Trash2 />
      </IconButton>
    </div>
  );
}
