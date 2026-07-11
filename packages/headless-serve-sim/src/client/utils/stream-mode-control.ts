export type StreamMode = "perf" | "quality";
export interface PendingStreamMode {
  mode: StreamMode;
  mismatches: number;
}

interface StreamModeSocket {
  readyState: number;
  send(data: ArrayBuffer): void;
}

export function sendStreamMode(
  socket: StreamModeSocket | null,
  mode: StreamMode,
): boolean {
  if (!socket || socket.readyState !== 1) return false;
  const payload = new TextEncoder().encode(JSON.stringify({ mode }));
  const message = new Uint8Array(new ArrayBuffer(payload.length + 1));
  message[0] = 0x0c;
  message.set(payload, 1);
  socket.send(message.buffer);
  return true;
}

export function reconcileStreamMode(
  pending: PendingStreamMode | null,
  reported: StreamMode,
): { mode: StreamMode; pending: PendingStreamMode | null } {
  if (!pending || pending.mode === reported) {
    return { mode: reported, pending: null };
  }
  const mismatches = pending.mismatches + 1;
  if (mismatches >= 2) return { mode: reported, pending: null };
  return {
    mode: pending.mode,
    pending: { ...pending, mismatches },
  };
}
