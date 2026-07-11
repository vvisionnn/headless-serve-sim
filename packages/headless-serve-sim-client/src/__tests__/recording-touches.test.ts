import { describe, expect, test } from "bun:test";
import { RecordingTouchTracker } from "../simulator/recording-touches";

describe("RecordingTouchTracker", () => {
  test("retains ended touches briefly so a quick tap reaches a video frame", () => {
    const timers: Array<() => void> = [];
    const tracker = new RecordingTouchTracker({
      holdMs: 180,
      setTimer: (callback, delay) => {
        expect(delay).toBe(180);
        timers.push(callback);
        return timers.length;
      },
      clearTimer: () => {},
    });

    tracker.setActive([{ x: 0.25, y: 0.75, kind: "single" }]);
    tracker.end([{ x: 0.3, y: 0.7, kind: "single" }], 100);
    expect(tracker.snapshot(100)).toEqual([{ x: 0.3, y: 0.7, kind: "single", opacity: 1 }]);
    expect(tracker.snapshot(190)).toEqual([{ x: 0.3, y: 0.7, kind: "single", opacity: 0.5 }]);
    timers[0]!();
    expect(tracker.snapshot()).toEqual([]);
  });

  test("a new gesture cancels pending removal and dispose clears everything", () => {
    const cleared: number[] = [];
    let timer = 0;
    const tracker = new RecordingTouchTracker({
      setTimer: () => ++timer,
      clearTimer: (id) => cleared.push(id as number),
    });

    tracker.end([{ x: 0.1, y: 0.2, kind: "single" }]);
    tracker.setActive([
      { x: 0.8, y: 0.9, kind: "multi" },
      { x: 0.2, y: 0.1, kind: "multi" },
    ]);
    expect(cleared).toEqual([1]);
    expect(tracker.snapshot()).toEqual([
      { x: 0.8, y: 0.9, kind: "multi" },
      { x: 0.2, y: 0.1, kind: "multi" },
    ]);

    tracker.dispose();
    expect(tracker.snapshot()).toEqual([]);
  });
});
