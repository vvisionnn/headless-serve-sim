import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { Chevron } from "../icons";
import { execOnHost, shellEscape } from "../utils/exec";
import { fileExtension, uploadFileToTmp } from "../utils/drop";

type DocStatus = "queued" | "uploading" | "done" | "error";

interface DocEntry {
  id: string;
  name: string;
  ext: string;
  status: DocStatus;
  error?: string;
}

// Drives the `headless-serve-sim document import` subcommand: stages each file
// to /tmp over /exec, then imports it into the Files app's "On My iPad" local
// storage. The real filename is restored via --name since the staged temp file
// is named with a UUID.
export function ImportDocumentTool({ udid }: { udid: string }) {
  const [open, setOpen] = useState(false);
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
        setError("Folder must be a relative path under On My iPad.");
        return;
      }

      const fresh: DocEntry[] = files.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        ext: fileExtension(f),
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
    [folder, udid, cliPrefix, setStatus],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFilePicked = useCallback(
    async (e: Event) => {
      const input = e.target as HTMLInputElement;
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
  const destLabel = folder.trim() ? `On My iPad/${folder.trim()}` : "On My iPad";

  return (
    <div className="bg-panel border border-divider rounded-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lem-toggle flex items-center justify-between gap-2.5 px-3.5 min-h-[44px] w-full bg-transparent border-none text-left cursor-pointer select-none [transition:background_0.2s_cubic-bezier(0.4,0,0.6,1)] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--color-accent-solid)]"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-fg-2">
          Documents
        </span>
        <span className="flex items-center gap-2.5">
          <DocStatusPill
            active={activeCount}
            done={doneCount}
            errors={errorCount}
            destLabel={destLabel}
          />
          <Chevron open={open} />
        </span>
      </button>

      {open && (
        <div
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className="border-t border-divider px-3.5 py-3 flex flex-col gap-2"
        >
          <p className="m-0 text-[12px] leading-[1.5] text-fg-3">
            Imports files straight into the Files app under{" "}
            <span className="text-fg">On My iPad</span> — open the document picker's local tab and
            they're already there, no in-app prompt.
          </p>

          <label className="flex items-center gap-2 bg-surface-3 border border-divider rounded-card px-3 h-9 focus-within:border-transparent focus-within:[box-shadow:0_0_0_2px_var(--color-accent-solid)] [transition:border-color_0.3s_cubic-bezier(0.4,0,0.6,1),box-shadow_0.3s_cubic-bezier(0.4,0,0.6,1)]">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-fg-2"
            >
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
            </svg>
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder((e.target as HTMLInputElement).value)}
              placeholder="On My iPad (top level)"
              spellCheck={false}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-fg font-mono placeholder:text-fg-3"
              aria-label="Destination folder under On My iPad"
            />
          </label>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFilePicked as any}
          />

          <button
            type="button"
            onClick={openFilePicker}
            className={[
              "relative min-h-[80px] flex flex-col items-center justify-center gap-1.5 px-3 py-4 cursor-pointer text-center rounded-card [transition:border-color_0.3s_cubic-bezier(0.4,0,0.6,1),background_0.3s_cubic-bezier(0.4,0,0.6,1)]",
              "bg-surface-3 border border-dashed border-divider hover:border-fg-3",
              "focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]",
              isDragOver ? "!bg-accent-tint !border-accent !border-solid" : "",
            ].join(" ")}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={isDragOver ? "text-accent" : "text-fg-2"}
            >
              <path d="M14 3v4a1 1 0 0 0 1 1h4" />
              <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
              <path d="M12 18v-6" />
              <path d="m9.5 14.5 2.5-2.5 2.5 2.5" />
            </svg>
            <span className="text-[13px] text-fg font-medium tracking-[-0.01em]">
              {isDragOver ? "Drop to import" : "Select or drop documents"}
            </span>
            <span className="text-[11px] text-fg-3">{destLabel}</span>
          </button>

          {entries.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {entries.map((e) => (
                <DocRow key={e.id} entry={e} />
              ))}
            </div>
          )}

          {entries.length > 0 && activeCount === 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setEntries([])}
                className="bg-transparent border border-divider rounded-pill text-fg-2 text-[11px] px-3 py-1 cursor-pointer uppercase tracking-[0.04em] hover:text-fg hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)] [transition:background_0.3s_cubic-bezier(0.4,0,0.6,1),color_0.3s_cubic-bezier(0.4,0,0.6,1)]"
              >
                Clear
              </button>
            </div>
          )}

          {error && (
            <div
              className="bg-surface-3 border border-divider rounded-card text-danger-soft text-[11px] px-3 py-2 break-words"
              role="alert"
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocStatusPill({
  active,
  done,
  errors,
  destLabel,
}: {
  active: number;
  done: number;
  errors: number;
  destLabel: string;
}) {
  if (active > 0) {
    return (
      <span className="text-[11px] text-fg-2 font-mono inline-flex items-center gap-1.5 leading-none">
        <span className="size-1.5 rounded-full bg-accent" />
        Importing {active}…
      </span>
    );
  }
  if (errors > 0) {
    return (
      <span className="text-[11px] text-danger-soft font-mono leading-none">{errors} failed</span>
    );
  }
  if (done > 0) {
    return (
      <span className="text-[11px] text-success-emerald font-mono leading-none">
        {done} imported
      </span>
    );
  }
  return (
    <span className="text-[11px] text-fg-3 leading-none truncate max-w-[160px]">{destLabel}</span>
  );
}

function DocRow({ entry }: { entry: DocEntry }) {
  const uploading = entry.status === "queued" || entry.status === "uploading";
  return (
    <div className="doc-row-in flex flex-col gap-1.5 bg-surface-3 rounded-card border border-divider px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[9px] tracking-[0.08em] uppercase text-fg-2 bg-surface-2 rounded-pill border border-divider px-2 py-[2px] font-mono">
          {entry.ext || "file"}
        </span>
        <span className="flex-1 min-w-0 truncate text-[13px] text-fg font-mono">{entry.name}</span>
        <DocRowStatusIcon status={entry.status} />
      </div>
      {uploading && (
        <div className="h-[2px] w-full overflow-hidden rounded-pill bg-surface-2">
          <div className="headless-serve-sim-toast-indeterminate h-full w-1/3 rounded-pill bg-accent" />
        </div>
      )}
      {entry.status === "error" && entry.error && (
        <span className="text-[11px] text-danger-soft break-words leading-[1.4]">
          {entry.error}
        </span>
      )}
    </div>
  );
}

function DocRowStatusIcon({ status }: { status: DocStatus }) {
  if (status === "done") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-success-emerald"
        aria-label="Imported"
      >
        <polyline points="5 12 10 17 19 7" />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-danger-soft"
        aria-label="Failed"
      >
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    );
  }
  return (
    <span className="shrink-0 text-[11px] text-fg-3 font-mono">
      {status === "queued" ? "queued" : "…"}
    </span>
  );
}
