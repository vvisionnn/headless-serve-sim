/**
 * One toast for a run of the same failure. Each report shows (or re-shows)
 * the toast under one id with the latest detail and restarts its timer, so a
 * failing drag — a report per move — reads as one message, not a stack.
 */
export function createCoalescedToast<Timer>(options: {
  holdMs: number;
  nextId: () => number;
  /** Add the toast, or update it in place when `id` is already shown. */
  show: (id: number, detail: string) => void;
  dismiss: (id: number) => void;
  setTimer: (run: () => void, ms: number) => Timer;
  clearTimer: (timer: Timer) => void;
}) {
  let current: { id: number; timer: Timer } | null = null;
  return (detail: string) => {
    if (current) options.clearTimer(current.timer);
    const id = current?.id ?? options.nextId();
    options.show(id, detail);
    current = {
      id,
      timer: options.setTimer(() => {
        current = null;
        options.dismiss(id);
      }, options.holdMs),
    };
  };
}
