import { AnimatePresence, motion } from "motion/react";
import { Check, FileText, Folder, Upload, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { useOptionalShell } from "../shell/shell-context";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { TextField } from "../ui/field";
import { Section } from "../ui/group";
import { execOnHost, shellEscape } from "../utils/exec";
import { fileExtension, uploadFileToTmp } from "../utils/drop";

type DocStatus = "queued" | "uploading" | "done" | "error";

interface DocEntry {
  id: string;
  name: string;
  ext: string;
  size: number;
  status: DocStatus;
  error?: string;
}

/** Finder-style size: "512 B", "2 KB", "2.4 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${Number(v.toFixed(1))} ${units[i]}`;
}

/** The Files app names its local storage after the device. */
export function localStorageName(deviceType: string | undefined): string {
  return deviceType === "iphone" ? "On My iPhone" : "On My iPad";
}

// Drives the `headless-serve-sim document import` subcommand: stages each file
// to /tmp over /exec, then imports it into the Files app's "On My iPad" local
// storage. The real filename is restored via --name since the staged temp file
// is named with a UUID.
export function ImportDocumentTool({ udid }: { udid: string }) {
  const storage = localStorageName(useOptionalShell()?.device?.type);
  const [folder, setFolder] = useState("");
  const [entries, setEntries] = useState<DocEntry[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragCountRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cliPrefix = useMemo(() => {
    const bin = window.__SIM_PREVIEW__?.serveSimBin;
    if (!bin) return "headless-serve-sim";
    if (/\.ts$/.test(bin)) return `bun ${shellEscape(bin)}`;
    if (/\.js$/.test(bin)) return `node ${shellEscape(bin)}`;
    return shellEscape(bin);
  }, []);

  const setStatus = useCallback((id: string, status: DocStatus, errMsg?: string) => {
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, status, error: errMsg } : e)));
  }, []);

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      const into = folder.trim();
      if (into.startsWith("/")) {
        setError(`Folder must be a relative path under ${storage}.`);
        return;
      }

      const fresh: DocEntry[] = files.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        ext: fileExtension(f),
        size: f.size,
        status: "queued",
      }));
      setEntries((es) => [...fresh, ...es]);

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const { id } = fresh[i]!;
        setStatus(id, "uploading");
        try {
          const tmp = await uploadFileToTmp(
            file,
            "headless-serve-sim-doc",
            fileExtension(file),
            execOnHost,
          );
          const argv = ["document", "import", shellEscape(tmp), "--name", shellEscape(file.name)];
          if (into) argv.push("--into", shellEscape(into));
          argv.push("-d", shellEscape(udid), "--quiet");
          const res = await execOnHost(`${cliPrefix} ${argv.join(" ")}`);
          execOnHost(`bash -c 'rm -f ${shellEscape(tmp)}'`).catch(() => {});
          if (res.exitCode !== 0) {
            setStatus(
              id,
              "error",
              res.stderr.trim() || res.stdout.trim() || `import failed (exit ${res.exitCode})`,
            );
          } else {
            setStatus(id, "done");
          }
        } catch (e: any) {
          setStatus(id, "error", e?.message ?? "Upload failed");
        }
      }
    },
    [folder, udid, cliPrefix, setStatus, storage],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFilePicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      const files = input.files ? Array.from(input.files) : [];
      input.value = "";
      await importFiles(files);
    },
    [importFiles],
  );

  const onDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCountRef.current = 0;
      setIsDragOver(false);
      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      await importFiles(files);
    },
    [importFiles],
  );

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current++;
    if (dragCountRef.current === 1) setIsDragOver(true);
  }, []);
  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, []);
  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const activeCount = entries.filter(
    (e) => e.status === "queued" || e.status === "uploading",
  ).length;
  const doneCount = entries.filter((e) => e.status === "done").length;
  const errorCount = entries.filter((e) => e.status === "error").length;

  return (
    <Section
      title="Documents"
      accessory={
        <span className="flex items-center gap-1.5">
          {entries.length > 0 && activeCount === 0 && (
            <Button variant="plain" size="sm" onClick={() => setEntries([])}>
              Clear
            </Button>
          )}
          <DocStatusBadge
            active={activeCount}
            done={doneCount}
            errors={errorCount}
            storage={storage}
          />
        </span>
      }
    >
      <div
        className="row flex flex-col gap-2 px-3 py-2.5"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <TextField
          leading={<Folder />}
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder={`${storage} (top level)`}
          spellCheck={false}
          aria-label={`Destination folder under ${storage}`}
        />
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFilePicked} />
        <motion.button
          type="button"
          onClick={openFilePicker}
          whileTap={{ scale: 0.98 }}
          transition={spring.snappy}
          className={cn(
            "flex h-[68px] flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed transition-colors",
            isDragOver
              ? "border-solid border-ink bg-fill-3 text-label"
              : "border-label-4 text-label-2 hover:border-label-3 hover:bg-fill-3",
          )}
        >
          <Upload className="size-[17px]" strokeWidth={1.75} />
          <span className="text-footnote font-medium">
            {isDragOver ? "Drop to import" : "Choose or drop documents"}
          </span>
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {entries.map((entry) => (
          <motion.div
            key={entry.id}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring.ui}
            className="row overflow-hidden"
          >
            <DocRow entry={entry} />
          </motion.div>
        ))}
      </AnimatePresence>

      {error && (
        <div className="row px-3 py-2 text-footnote text-red [overflow-wrap:anywhere]" role="alert">
          {error}
        </div>
      )}
    </Section>
  );
}

function DocStatusBadge({
  active,
  done,
  errors,
  storage,
}: {
  active: number;
  done: number;
  errors: number;
  storage: string;
}) {
  if (active > 0) return <Badge>Importing {active}…</Badge>;
  if (errors > 0) return <Badge tone="red">{errors} failed</Badge>;
  if (done > 0) return <Badge tone="green">{done} imported</Badge>;
  return <Badge>{storage}</Badge>;
}

function DocRow({ entry }: { entry: DocEntry }) {
  const uploading = entry.status === "queued" || entry.status === "uploading";
  return (
    <div className="flex min-h-11 items-center gap-2.5 px-3 py-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-fill-2 text-label-2">
        <FileText className="size-[14px]" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-footnote font-medium text-label" title={entry.name}>
          {entry.name}
        </span>
        {uploading ? (
          <span className="relative h-[3px] overflow-hidden rounded-full bg-fill-2">
            <span
              className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-ink"
              style={{ animation: "indeterminate 1.3s cubic-bezier(0.4,0,0.2,1) infinite" }}
            />
          </span>
        ) : entry.status === "error" ? (
          <span className="text-caption2 text-red [overflow-wrap:anywhere]">{entry.error}</span>
        ) : (
          <span className="font-mono text-caption2 text-label-3">
            {(entry.ext || "file").toUpperCase()} · {formatFileSize(entry.size)}
          </span>
        )}
      </span>
      {entry.status === "done" ? (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green/14 text-green"
          aria-label="Imported"
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : entry.status === "error" ? (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-red/12 text-red"
          aria-label="Failed"
        >
          <X className="size-3" strokeWidth={3} />
        </span>
      ) : (
        <span className="shrink-0 font-mono text-caption2 text-label-3">
          {entry.status === "queued" ? "queued" : "…"}
        </span>
      )}
    </div>
  );
}
