import { describe, expect, test } from "bun:test";
import { LatestFramePresenter } from "../latest-frame-presenter";

class Frame {
  closed = 0;
  constructor(readonly id: number) {}
  close() {
    this.closed++;
  }
}

describe("LatestFramePresenter", () => {
  test("presents only the newest frame from one display interval", () => {
    const callbacks = new Map<number, () => void>();
    let nextHandle = 0;
    const painted: number[] = [];
    let discarded = 0;
    const presenter = new LatestFramePresenter<Frame, null>(
      (callback) => {
        const handle = ++nextHandle;
        callbacks.set(handle, callback);
        return handle;
      },
      (handle) => callbacks.delete(handle),
      (frame) => painted.push(frame.id),
      () => discarded++,
    );
    const first = new Frame(1);
    const second = new Frame(2);
    const third = new Frame(3);

    presenter.enqueue(first, null);
    presenter.enqueue(second, null);
    presenter.enqueue(third, null);
    expect(callbacks.size).toBe(1);
    expect(first.closed).toBe(1);
    expect(second.closed).toBe(1);
    expect(discarded).toBe(2);

    callbacks.values().next().value?.();
    expect(painted).toEqual([3]);
    expect(third.closed).toBe(1);
  });

  test("close cancels presentation and releases the retained frame", () => {
    const callbacks = new Map<number, () => void>();
    const frame = new Frame(1);
    const presenter = new LatestFramePresenter<Frame, null>(
      (callback) => {
        callbacks.set(1, callback);
        return 1;
      },
      (handle) => callbacks.delete(handle),
      () => {
        throw new Error("must not paint");
      },
    );
    presenter.enqueue(frame, null);
    presenter.close();
    expect(callbacks.size).toBe(0);
    expect(frame.closed).toBe(1);
  });

  test("recovery counts a pending frame once while ordinary teardown does not", () => {
    let discarded = 0;
    const presenter = new LatestFramePresenter<Frame, null>(
      () => 1,
      () => {},
      () => {},
      () => discarded++,
    );
    const recovery = new Frame(1);
    presenter.enqueue(recovery, null);
    presenter.clear(true);
    presenter.clear(true);
    const teardown = new Frame(2);
    presenter.enqueue(teardown, null);
    presenter.close();
    expect(discarded).toBe(1);
    expect(recovery.closed).toBe(1);
    expect(teardown.closed).toBe(1);
  });

  test("does not wait another display tick after a newer paced frame is ready", () => {
    const callbacks = new Map<number, () => void>();
    const painted: number[] = [];
    let now = 20;
    let discarded = 0;
    const presenter = new LatestFramePresenter<Frame, null>(
      (callback) => {
        callbacks.set(1, callback);
        return 1;
      },
      (handle) => callbacks.delete(handle),
      (frame) => painted.push(frame.id),
      () => discarded++,
      () => now,
      12,
    );
    presenter.enqueue(new Frame(1), null);
    now = 25;
    const pending = new Frame(2);
    presenter.enqueue(pending, null);
    now = 33;
    presenter.enqueue(new Frame(3), null);
    expect(painted).toEqual([1, 3]);
    expect(pending.closed).toBe(1);
    expect(discarded).toBe(1);
    expect(callbacks.size).toBe(0);
  });

  test("paint cost does not lower spaced 60 Hz source presentation cadence", () => {
    const callbacks = new Map<number, () => void>();
    const painted: number[] = [];
    let now = 0;
    const presenter = new LatestFramePresenter<Frame, null>(
      (callback) => {
        callbacks.set(1, callback);
        return 1;
      },
      (handle) => callbacks.delete(handle),
      (frame) => {
        painted.push(frame.id);
        now += 12; // Large source blit plus visible composition/recording work.
      },
      () => {},
      () => now,
      1000 / 120,
    );
    for (let id = 1; id <= 3; id++) {
      now = ((id - 1) * 1000) / 60;
      presenter.enqueue(new Frame(id), null);
    }
    expect(painted).toEqual([1, 2, 3]);
    expect(callbacks.size).toBe(0);
    presenter.close();
  });

  test("presents normally paced frames immediately while coalescing a burst", () => {
    const callbacks = new Map<number, () => void>();
    const painted: number[] = [];
    let now = 20;
    const presenter = new LatestFramePresenter<Frame, null>(
      (callback) => {
        callbacks.set(1, callback);
        return 1;
      },
      (handle) => callbacks.delete(handle),
      (frame) => painted.push(frame.id),
      () => {},
      () => now,
      12,
    );

    const first = new Frame(1);
    presenter.enqueue(first, null);
    expect(painted).toEqual([1]);
    expect(callbacks.size).toBe(0);

    now = 25;
    const second = new Frame(2);
    const third = new Frame(3);
    presenter.enqueue(second, null);
    presenter.enqueue(third, null);
    expect(callbacks.size).toBe(1);
    expect(second.closed).toBe(1);

    now = 32;
    callbacks.get(1)?.();
    expect(painted).toEqual([1, 3]);
    expect(first.closed).toBe(1);
    expect(third.closed).toBe(1);
  });
});
