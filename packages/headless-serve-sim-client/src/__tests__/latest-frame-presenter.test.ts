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
