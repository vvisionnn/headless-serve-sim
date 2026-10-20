import { expect, test } from "bun:test";
import { createCoalescedToast } from "../client/utils/coalesced-toast";

function harness() {
  const shown = new Map<number, string>();
  const timers = new Map<number, () => void>();
  let timerSeq = 0;
  let idSeq = 0;
  const report = createCoalescedToast({
    holdMs: 6000,
    nextId: () => ++idSeq,
    show: (id, detail) => shown.set(id, detail),
    dismiss: (id) => shown.delete(id),
    setTimer: (run) => {
      const handle = ++timerSeq;
      timers.set(handle, run);
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle as number),
  });
  const elapse = () => {
    for (const [handle, run] of [...timers]) {
      timers.delete(handle);
      run();
    }
  };
  return { report, shown, timers, elapse };
}

test("a burst of failures shows one toast with the latest detail", () => {
  const { report, shown, timers } = harness();
  for (let i = 0; i < 40; i++) report(`move ${i} failed`);
  expect([...shown.values()]).toEqual(["move 39 failed"]);
  // Each failure restarts the one timer rather than stacking another.
  expect(timers.size).toBe(1);
});

test("the toast leaves once failures stop, and a later one starts fresh", () => {
  const { report, shown, elapse } = harness();
  report("first");
  elapse();
  expect(shown.size).toBe(0);
  report("again");
  expect([...shown.entries()]).toEqual([[2, "again"]]);
});
