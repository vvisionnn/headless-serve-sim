import { describe, expect, test } from "bun:test";
import { FramePresenter } from "../frame-presenter";

class Frame {
  closed = 0;
  constructor(readonly id: number) {}
  close() {
    this.closed++;
  }
}

/** A fake display: `tick()` runs the pending animation-frame callback. */
function display() {
  const painted: number[] = [];
  let callback: (() => void) | null = null;
  let discarded = 0;
  const presenter = new FramePresenter<Frame, null>(
    (next) => {
      callback = next;
      return 1;
    },
    () => (callback = null),
    (frame) => painted.push(frame.id),
    () => discarded++,
  );
  return {
    presenter,
    painted,
    discarded: () => discarded,
    scheduled: () => callback !== null,
    tick() {
      const current = callback;
      callback = null;
      current?.();
    },
  };
}

describe("FramePresenter", () => {
  test("draws a frame immediately when nothing was drawn this display tick", () => {
    const d = display();
    d.presenter.enqueue(new Frame(1), null);
    expect(d.painted).toEqual([1]);
  });

  test("never draws two frames into one display tick", () => {
    const d = display();
    d.presenter.enqueue(new Frame(1), null);
    d.presenter.enqueue(new Frame(2), null);
    expect(d.painted).toEqual([1]);
    d.tick(); // Frame 1 is shown by this tick; 2 must wait for the next one.
    expect(d.painted).toEqual([1]);
    d.tick();
    expect(d.painted).toEqual([1, 2]);
  });

  test("a jittered 60 fps source on a 60 Hz display shows every frame", () => {
    const d = display();
    // Two frames land between the same pair of ticks, then cadence resumes.
    d.presenter.enqueue(new Frame(1), null);
    d.presenter.enqueue(new Frame(2), null);
    for (let id = 3; id <= 6; id++) {
      d.tick();
      d.presenter.enqueue(new Frame(id), null);
    }
    for (let i = 0; i < 4; i++) d.tick();
    expect(d.painted).toEqual([1, 2, 3, 4, 5, 6]);
    expect(d.discarded()).toBe(0);
  });

  test("bounds latency by dropping the oldest waiting frame", () => {
    const d = display();
    const frames = [1, 2, 3, 4].map((id) => new Frame(id));
    for (const frame of frames) d.presenter.enqueue(frame, null);
    expect(frames[1]!.closed).toBe(1);
    expect(d.discarded()).toBe(1);
    d.tick();
    d.tick();
    d.tick();
    expect(d.painted).toEqual([1, 3, 4]);
    expect(frames.every((frame) => frame.closed === 1)).toBe(true);
  });

  test("stops scheduling once idle", () => {
    const d = display();
    d.presenter.enqueue(new Frame(1), null);
    d.tick();
    expect(d.scheduled()).toBe(false);
    d.presenter.enqueue(new Frame(2), null);
    expect(d.painted).toEqual([1, 2]);
  });

  test("close cancels presentation and releases waiting frames", () => {
    const d = display();
    d.presenter.enqueue(new Frame(1), null);
    const waiting = new Frame(2);
    d.presenter.enqueue(waiting, null);
    d.presenter.close();
    expect(d.scheduled()).toBe(false);
    expect(waiting.closed).toBe(1);
    d.presenter.enqueue(new Frame(3), null);
    expect(d.painted).toEqual([1]);
  });

  test("recovery counts waiting frames once while ordinary teardown does not", () => {
    const d = display();
    d.presenter.enqueue(new Frame(1), null);
    d.presenter.enqueue(new Frame(2), null);
    d.presenter.clear(true);
    d.presenter.clear(true);
    expect(d.discarded()).toBe(1);
    d.presenter.enqueue(new Frame(3), null);
    d.presenter.close();
    expect(d.discarded()).toBe(1);
  });
});
