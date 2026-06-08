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

  const setStatus = useCallback(
    (id: string, status: DocStatus, errMsg?: string) => {
      setEntries((es) =>
        es.map((e) => (e.id === id ? { ...e, status, error: errMsg } : e)),
      );
    },
    [],
  );

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
    <div className="bg-panel border border-white/8 rounded-[10px] flex flex-col gap-2.5 px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lem-toggle grid [grid-template-columns:auto_1fr_auto] items-center gap-2 bg-transparent border-none text-white/90 py-2.5 px-1 -my-2 -mx-1 cursor-pointer w-[calc(100%+8px)] text-left min-h-[36px] leading-none"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold text-white/50 uppercase tracking-[0.08em] leading-none inline-flex items-center">
          Documents
        </span>
        <DocStatusPill
          active={activeCount}
          done={doneCount}
          errors={errorCount}
          destLabel={destLabel}
        />
        <Chevron open={open} />
      </button>

      {open && (
        <div
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className="flex flex-col gap-2.5"
        >
          <p className="m-0 text-[10px] leading-[1.5] text-white/45">
            Imports files straight into the Files app under <span className="text-white/70">On My iPad</span> —
            open the document picker's local tab and they're already there, no in-app prompt.
          </p>

          <label className="flex items-center gap-2 bg-white/[0.04] border border-white/8 rounded-[7px] px-2.5 h-9 focus-within:border-accent/60 transition-colors">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-white/55"
            >
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
            </svg>
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder((e.target as HTMLInputElement).value)}
              placeholder="On My iPad (top level)"
              spellCheck={false}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12px] text-white/90 font-mono placeholder:text-white/35"
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
              "relative min-h-[64px] flex flex-col items-center justify-center gap-1 px-3.5 py-3 rounded-[8px] cursor-pointer text-center transition-[border-color,background] duration-150",
              "bg-white/[0.04] border border-dashed border-white/15 hover:border-white/25",
              isDragOver
                ? "!bg-[rgba(10,132,255,0.1)] !border-[rgba(10,132,255,0.65)] !border-solid"
                : "",
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
              className={isDragOver ? "text-[#4aa3ff]" : "text-white/70"}
            >
              <path d="M14 3v4a1 1 0 0 0 1 1h4" />
              <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
              <path d="M12 18v-6" />
              <path d="m9.5 14.5 2.5-2.5 2.5 2.5" />
            </svg>
            <span className="text-[12px] text-white/85 font-medium">
              {isDragOver ? "Drop to import" : "Select or drop documents"}
            </span>
            <span className="text-[10px] text-white/45">
              {destLabel}
            </span>
          </button>

          {entries.length > 0 && (
            <div className="flex flex-col gap-1">
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
                className="bg-transparent border border-white/12 text-white/70 text-[10px] px-2 py-[3px] rounded-[5px] cursor-pointer uppercase tracking-[0.04em] hover:text-white/90"
              >
                Clear
              </button>
            </div>
          )}

          {error && (
            <div className="bg-danger/10 border border-danger/20 text-danger-soft text-[11px] px-2 py-1.5 rounded-md break-words" role="alert">
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
      <span className="text-[11px] text-white/55 font-mono inline-flex items-center gap-1.5 justify-self-end leading-none">
        <span className="size-1.5 rounded-full bg-accent [box-shadow:0_0_6px_rgba(165,180,252,0.7)]" />
        Importing {active}…
      </span>
    );
  }
  if (errors > 0) {
    return (
      <span className="text-[11px] text-danger-soft font-mono justify-self-end leading-none">
        {errors} failed
      </span>
    );
  }
  if (done > 0) {
    return (
      <span className="text-[11px] text-success-emerald font-mono justify-self-end leading-none">
        {done} imported
      </span>
    );
  }
  return (
    <span className="text-[11px] text-white/45 font-mono justify-self-end leading-none truncate max-w-[160px]">
      {destLabel}
    </span>
  );
}

function DocRow({ entry }: { entry: DocEntry }) {
  const uploading = entry.status === "queued" || entry.status === "uploading";
  return (
    <div className="doc-row-in flex flex-col gap-1 bg-white/[0.03] border border-white/8 rounded-[7px] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[9px] tracking-[0.08em] uppercase text-white/55 bg-white/[0.06] border border-white/8 px-[6px] py-[2px] rounded-full font-mono">
          {entry.ext || "file"}
        </span>
        <span className="flex-1 min-w-0 truncate text-[12px] text-white/90 font-mono">
          {entry.name}
        </span>
        <DocRowStatusIcon status={entry.status} />
      </div>
      {uploading && (
        <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div className="headless-serve-sim-toast-indeterminate h-full w-1/3 bg-accent rounded-full" />
        </div>
      )}
      {entry.status === "error" && entry.error && (
        <span className="text-[10px] text-danger-soft break-words leading-[1.4]">
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
    <span className="shrink-0 text-[10px] text-white/45 font-mono">
      {status === "queued" ? "queued" : "…"}
    </span>
  );
}
