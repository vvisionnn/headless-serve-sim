import { useCallback, useEffect, useRef } from "react";
import type { EventLogDraft } from "../../event-log";
import { simEndpoint } from "../utils/sim-endpoint";

/**
 * How long reported events are held before being flushed to the server.
 *
 * Input can run at frame rate, so a request per event would put a burst of
 * ~60/s on the preview server just to record history. One request per window
 * bounds that while keeping the panel and CLI within a frame or two of live.
 */
const FLUSH_INTERVAL_MS = 250;

/**
 * Cap on events buffered between flushes. A wedged or slow server must not let
 * the page accumulate input forever; past this the oldest are dropped, which
 * is the right trade for a bounded history view.
 */
const MAX_PENDING = 500;

/**
 * Reports simulator input events to the server's event log.
 *
 * The events are reported rather than observed because input goes from the
 * browser straight to the helper's WebSocket — the preview server is not on
 * that path and cannot see them.
 */
export function useEventLogReporter(execToken: string | undefined, device: string | undefined) {
  const pendingRef = useRef<EventLogDraft[]>([]);
  const tokenRef = useRef(execToken);
  tokenRef.current = execToken;
  const deviceRef = useRef(device);
  deviceRef.current = device;

  const flush = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || pendingRef.current.length === 0) return;
    const events = pendingRef.current;
    pendingRef.current = [];
    try {
      await fetch(simEndpoint("events/log"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ events }),
      });
    } catch {
      // The log is diagnostic; a failed flush drops those events rather than
      // retrying, so a down server can't build an unbounded backlog.
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      void flush();
    };
  }, [flush]);

  return useCallback(
    (draft: Omit<EventLogDraft, "source"> & { source?: EventLogDraft["source"] }) => {
      const pending = pendingRef.current;
      if (pending.length >= MAX_PENDING) pending.shift();
      pending.push({
        source: draft.source ?? "hid",
        kind: draft.kind,
        ...(deviceRef.current ? { device: deviceRef.current } : {}),
        ...(draft.status ? { status: draft.status } : {}),
        ...(draft.details ? { details: draft.details } : {}),
        ...(draft.msg ? { msg: draft.msg } : {}),
      });
    },
    [],
  );
}
