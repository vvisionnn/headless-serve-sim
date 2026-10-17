import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { formatEventTime, type EventLogEntry } from "../../event-log";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import { simEndpoint } from "../utils/sim-endpoint";

/** Rows kept in the DOM. The server keeps more; this bounds render cost. */
const MAX_ROWS = 200;

/** Input events reported for the simulator, newest first. */
export function InputView() {
  const [entries, setEntries] = useState<EventLogEntry[]>([]);
  // The server replays its history on every subscription; those rows appear
  // at once, and only events arriving afterwards slide in.
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    const source = new EventSource(
      window.__SIM_PREVIEW__?.eventLogStreamEndpoint ?? simEndpoint("events/log/stream"),
    );
    source.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as EventLogEntry;
        setEntries((prev) => {
          // A reconnect replays the retained history; skip what we already have.
          if (prev.some((row) => row.id === entry.id)) return prev;
          const next = [entry, ...prev];
          return next.length > MAX_ROWS ? next.slice(0, MAX_ROWS) : next;
        });
      } catch {}
    };
    return () => source.close();
  }, []);

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-footnote text-label-3">
        No input yet. Tap the simulator to see events here.
      </div>
    );
  }
  return (
    <div
      role="log"
      aria-label="Input events"
      className="thin-scrollbar scroll-fade h-full overflow-y-auto px-1.5 py-2"
    >
      {entries.map((entry) => (
        <motion.div
          key={entry.id}
          initial={Date.parse(entry.timestamp) > mountedAt.current ? { opacity: 0, y: -6 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.ui}
          data-status={entry.status ?? "ok"}
          className={cn(
            "grid min-h-7 grid-cols-[104px_minmax(0,1fr)] items-center gap-2 rounded-[7px] px-1.5 transition-colors hover:bg-fill-3",
            entry.status === "error" && "bg-red/5 hover:bg-red/8",
          )}
        >
          <span className="font-mono text-caption text-label-3 tabular-nums">
            {formatEventTime(entry.timestamp)}
          </span>
          <span
            className={cn(
              "truncate font-mono text-[11.5px]/4",
              entry.status === "error" ? "text-red" : "text-label",
            )}
            title={entry.msg}
          >
            {entry.msg}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
