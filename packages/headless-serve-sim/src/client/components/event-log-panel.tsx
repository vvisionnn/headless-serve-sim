import { useEffect, useRef, useState } from "react";
import { formatEventTime, type EventLogEntry } from "../../event-log";
import { simEndpoint } from "../utils/sim-endpoint";

/** Rows kept in the DOM. The server keeps more; this bounds render cost. */
const MAX_ROWS = 200;

export function EventLogPanel({ open }: { open: boolean }) {
  const [entries, setEntries] = useState<EventLogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    if (!open) return;
    const source = new EventSource(simEndpoint("events/log/stream"));
    source.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as EventLogEntry;
        setEntries((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next;
        });
      } catch {}
    };
    return () => source.close();
  }, [open]);

  // Follow the tail only while the user is already at the bottom; scrolling up
  // to read history must not be yanked back by the next event.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const el = event.currentTarget;
        pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="flex-1 min-h-0 overflow-y-auto font-mono text-[11px] leading-[1.6]"
    >
      {entries.length === 0 ? (
        <div className="px-3 py-4 text-fg-3">No input yet.</div>
      ) : (
        entries.map((entry) => (
          <div key={entry.id} className="flex gap-2 px-3 py-0.5 hover:bg-hover">
            <span className="shrink-0 text-fg-3 tabular-nums">
              {formatEventTime(entry.timestamp)}
            </span>
            <span className={entry.status === "error" ? "text-danger" : undefined}>
              {entry.msg}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
