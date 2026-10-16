import { AnimatePresence, motion } from "motion/react";
import { Check, FileText, Folder, FolderOpen, KeyRound, Link, Minus, Plus, Send, Trash2, Upload, X } from "lucide-react";
import { useState } from "react";
import { AppIcon, apps } from "../device/screens/parts";
import { cn } from "../lib/cn";
import { currentApp, permissions, userDefaults } from "../lib/mock";
import { spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { Badge } from "../ui/badge";
import { Button, IconButton } from "../ui/button";
import { TextArea, TextField } from "../ui/field";
import { InfoRow, Row, Section } from "../ui/group";
import { Segmented } from "../ui/segmented";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";

export function AppTab() {
  return (
    <>
      <AppHeader />
      <ActionsSection />
      <PermissionsSection />
      <UserDefaultsSection />
      <DocumentsSection />
    </>
  );
}

function AppHeader() {
  return (
    <div className="group-box overflow-hidden">
      <div className="row flex items-center gap-3 px-3 py-3">
        <AppIcon app={apps.trails!} size={52} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-title3 text-label">{currentApp.name}</span>
          <span className="truncate font-mono text-caption text-label-3">{currentApp.bundleId}</span>
          <span className="flex flex-wrap gap-1">
            {currentApp.reactNative && <Badge>React Native</Badge>}
            <Badge tone="green" dot>
              Running
            </Badge>
          </span>
        </div>
      </div>
      <InfoRow label="Version" value={currentApp.version} />
      <InfoRow label="Minimum OS" value={currentApp.minOS} />
      <InfoRow label="Executable" value={currentApp.executable} />
      <InfoRow label="PID" value={currentApp.pid} />
      <InfoRow
        label="Path"
        value={<span className="line-clamp-3">{currentApp.path}</span>}
        action={
          <IconButton label="Reveal in Finder" size="sm" className="-my-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
            <FolderOpen />
          </IconButton>
        }
      />
    </div>
  );
}

const defaultPayload = JSON.stringify({ aps: { alert: { title: "Trail closed", body: "Mt. Tam Ridge is closed for maintenance." } } }, null, 1).replace(/\n\s*/g, " ");

function ActionsSection() {
  const { toast } = useApp();
  const [url, setUrl] = useState("");
  const [bundle, setBundle] = useState(currentApp.bundleId);
  const [payload, setPayload] = useState(defaultPayload);
  const [confirm, setConfirm] = useState(false);
  return (
    <Section title="Actions">
      <div className="row flex flex-col gap-2 px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-body font-medium text-label">
          <Link className="size-[13px] text-label-3" strokeWidth={2} /> Open URL
        </span>
        <div className="flex gap-1.5">
          <TextField mono placeholder="https://… or trails://trail/42" value={url} onChange={(e) => setUrl(e.target.value)} className="flex-1" />
          <Button variant="secondary" disabled={!url} onClick={() => toast({ title: "Opened URL", detail: url })}>
            Open
          </Button>
        </div>
      </div>
      <div className="row flex flex-col gap-2 px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-body font-medium text-label">
          <Send className="size-[13px] text-label-3" strokeWidth={2} /> Push notification
        </span>
        <TextField mono placeholder="com.example.app" value={bundle} onChange={(e) => setBundle(e.target.value)} />
        <TextArea rows={4} value={payload} onChange={(e) => setPayload(e.target.value)} spellCheck={false} />
        <div className="flex justify-end">
          <Button variant="primary" icon={<Send />} onClick={() => toast({ title: "Notification sent", detail: bundle, tone: "success" })}>
            Send
          </Button>
        </div>
      </div>
      <div className="row flex min-h-11 items-center gap-2 px-3 py-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {confirm ? (
            <motion.div
              key="confirm"
              className="flex w-full items-center gap-1.5"
              initial={{ opacity: 0, y: 6, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -6, filter: "blur(3px)" }}
              transition={spring.ui}
            >
              <span className="flex-1 text-footnote text-label-2">Clears every stored credential.</span>
              <Button variant="plain" size="sm" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirm(false);
                  toast({ title: "Keychain reset", detail: "iPhone 17 Pro", tone: "danger" });
                }}
              >
                Reset keychain
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              className="flex w-full items-center gap-2"
              initial={{ opacity: 0, y: -6, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 6, filter: "blur(3px)" }}
              transition={spring.ui}
            >
              <span className="flex flex-1 items-center gap-1.5 text-body font-medium text-label">
                <KeyRound className="size-[13px] text-label-3" strokeWidth={2} /> Keychain
              </span>
              <Button variant="destructive" size="sm" onClick={() => setConfirm(true)}>
                Reset…
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Section>
  );
}

type Perm = "allow" | "deny" | "unset";

function PermissionsSection() {
  const [values, setValues] = useState<Record<string, Perm>>(() => Object.fromEntries(permissions.map((p) => [p.key, p.value as Perm])));
  return (
    <Section
      title="Permissions"
      accessory={
        <Button variant="plain" size="sm" onClick={() => setValues(Object.fromEntries(permissions.map((p) => [p.key, "unset" as Perm])))}>
          Reset all
        </Button>
      }
    >
      {permissions.map((p) => (
        <Row key={p.key} label={p.label} className="min-h-9 py-1.5">
          <Segmented
            aria-label={p.label}
            size="sm"
            className="w-[96px]"
            value={values[p.key]!}
            onChange={(v) => setValues({ ...values, [p.key]: v })}
            items={[
              { value: "allow", icon: <Check />, title: "Allow" },
              { value: "deny", icon: <X />, title: "Deny" },
              { value: "unset", icon: <Minus />, title: "Not set" },
            ]}
          />
        </Row>
      ))}
    </Section>
  );
}

const typeOptions = [
  { value: "string", label: "String" },
  { value: "int", label: "Integer" },
  { value: "float", label: "Float" },
  { value: "bool", label: "Boolean" },
];

function UserDefaultsSection() {
  const [domain, setDomain] = useState(currentApp.bundleId);
  const [rows, setRows] = useState<{ key: string; type: string; value: string | number | boolean }[]>(() => userDefaults.map((d) => ({ ...d })));
  const [draft, setDraft] = useState({ key: "", type: "string", value: "" });
  return (
    <Section title="User defaults" footer="Changes may need a relaunch to take effect.">
      <div className="row flex gap-1.5 px-3 py-2.5">
        <TextField mono placeholder="com.example.app" value={domain} onChange={(e) => setDomain(e.target.value)} className="flex-1" />
        <Button variant="secondary">Load</Button>
      </div>
      <AnimatePresence initial={false}>
        {rows.map((r) => (
          <motion.div
            key={r.key}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring.ui}
            className="row group overflow-hidden"
          >
            <div className="flex min-h-10 items-center gap-2 px-3 py-1.5">
              <span className="w-9 shrink-0 rounded-[5px] bg-fill-2 py-px text-center font-mono text-caption2 font-semibold text-label-2">{r.type}</span>
              <span className="w-[86px] shrink-0 truncate font-mono text-caption text-label" title={r.key}>
                {r.key}
              </span>
              <span className="flex min-w-0 flex-1 justify-end">
                {r.type === "bool" ? (
                  <Switch label={r.key} checked={!!r.value} onChange={(v) => setRows(rows.map((x) => (x.key === r.key ? { ...x, value: v } : x)))} />
                ) : r.type === "json" ? (
                  <span className="line-clamp-2 font-mono text-caption2 break-all text-label-2">{String(r.value)}</span>
                ) : (
                  <TextField
                    mono
                    value={String(r.value)}
                    onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, value: e.target.value } : x)))}
                    className="h-6 text-caption"
                  />
                )}
              </span>
              <IconButton
                label={`Delete ${r.key}`}
                size="sm"
                className="text-label-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red focus-visible:opacity-100"
                onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
              >
                <Trash2 />
              </IconButton>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="row flex flex-col gap-1.5 px-3 py-2.5">
        <span className="text-caption font-semibold text-label-3">Add key</span>
        <div className="flex gap-1.5">
          <TextField mono placeholder="NewKey" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} className="flex-1" />
          <Select label="Type" value={draft.type} onChange={(type) => setDraft({ ...draft, type })} options={typeOptions} className="w-[104px] min-w-0" />
        </div>
        <div className="flex gap-1.5">
          <TextField mono placeholder="Value" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} className="flex-1" />
          <Button
            variant="secondary"
            icon={<Plus />}
            disabled={!draft.key}
            onClick={() => {
              setRows([...rows, { key: draft.key, type: draft.type, value: draft.type === "bool" ? draft.value === "true" : draft.value }]);
              setDraft({ key: "", type: "string", value: "" });
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </Section>
  );
}

function DocumentsSection() {
  const [folder, setFolder] = useState("");
  const files = [
    { name: "trail-guide-2026.pdf", ext: "PDF", status: "importing" as const },
    { name: "gpx-exports.zip", ext: "ZIP", status: "done" as const },
  ];
  return (
    <Section title="Documents" accessory={<Badge>On My iPhone</Badge>}>
      <div className="row flex flex-col gap-2 px-3 py-2.5">
        <TextField leading={<Folder />} placeholder="On My iPhone (top level)" value={folder} onChange={(e) => setFolder(e.target.value)} />
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          transition={spring.snappy}
          className="flex h-[68px] flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-label-4 text-label-2 transition-colors hover:border-label-3 hover:bg-fill-3"
        >
          <Upload className="size-[17px]" strokeWidth={1.75} />
          <span className="text-footnote font-medium">Choose or drop documents</span>
        </motion.button>
      </div>
      {files.map((f) => (
        <div key={f.name} className="row flex min-h-11 items-center gap-2.5 px-3 py-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-fill-2 text-label-2">
            <FileText className="size-[14px]" strokeWidth={1.75} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-footnote font-medium text-label">{f.name}</span>
            {f.status === "importing" ? (
              <span className="relative h-[3px] overflow-hidden rounded-full bg-fill-2">
                <span className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-ink" style={{ animation: "indeterminate 1.3s cubic-bezier(0.4,0,0.2,1) infinite" }} />
              </span>
            ) : (
              <span className="font-mono text-caption2 text-label-3">{f.ext} · 2.4 MB</span>
            )}
          </span>
          {f.status === "done" ? (
            <span className={cn("flex size-5 items-center justify-center rounded-full bg-green/14 text-green")}>
              <Check className="size-3" strokeWidth={3} />
            </span>
          ) : (
            <span className="font-mono text-caption2 text-label-3">…</span>
          )}
        </div>
      ))}
    </Section>
  );
}
