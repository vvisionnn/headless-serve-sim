import { afterEach, expect, test } from "bun:test";
import { startDeviceResize } from "../client/utils/device-resize";

const originalRequest = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequest;
  globalThis.cancelAnimationFrame = originalCancel;
});

class ResizeTarget extends EventTarget {
  captured: number | null = null;
  releases = 0;
  listeners = new Set<string>();

  setPointerCapture(id: number) {
    this.captured = id;
  }
  hasPointerCapture(id: number) {
    return this.captured === id;
  }
  releasePointerCapture(id: number) {
    if (this.captured === id) this.captured = null;
    this.releases++;
  }
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    this.listeners.add(type);
    super.addEventListener(type, listener);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    this.listeners.delete(type);
    super.removeEventListener(type, listener);
  }
  pointer(type: string, x: number, y: number, pointerId = 7) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { clientX: x, clientY: y, pointerId });
    this.dispatchEvent(event);
    return event;
  }
}

function setup(button = 0) {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    callbacks.delete(id);
  };
  const target = new ResizeTarget();
  const scales: number[] = [];
  let prevented = false;
  let stopped = false;
  const dispose = startDeviceResize(
    {
      button,
      pointerId: 7,
      clientX: 100,
      clientY: 100,
      currentTarget: target as unknown as HTMLElement,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
    },
    {
      handle: "e",
      fittedSize: { width: 300, height: 600 },
      availableSize: { width: 600, height: 900 },
      scale: 0.6,
      onScaleChange: (scale) => scales.push(scale),
    },
  );
  return {
    target,
    scales,
    callbacks,
    dispose,
    get prevented() {
      return prevented;
    },
    get stopped() {
      return stopped;
    },
    frame() {
      const current = [...callbacks.values()];
      callbacks.clear();
      for (const callback of current) callback(0);
    },
  };
}

test("pointer samples are captured and coalesced into one latest scale per animation frame", () => {
  const drag = setup();
  expect(drag.target.captured).toBe(7);
  expect(drag.prevented).toBe(true);
  expect(drag.stopped).toBe(true);
  const first = drag.target.pointer("pointermove", 115, 100);
  drag.target.pointer("pointermove", 130, 100);
  expect(first.defaultPrevented).toBe(true);
  expect(drag.scales).toEqual([]);
  expect(drag.callbacks.size).toBe(1);
  drag.frame();
  expect(drag.scales).toEqual([0.8]);
  drag.dispose();
});

test("pointer up flushes its final coordinates and releases every drag resource", () => {
  const drag = setup();
  drag.target.pointer("pointermove", 115, 100);
  const up = drag.target.pointer("pointerup", 145, 100);
  expect(up.defaultPrevented).toBe(true);
  expect(drag.scales).toHaveLength(1);
  expect(drag.scales[0]).toBeCloseTo(0.9);
  expect(drag.callbacks.size).toBe(0);
  expect(drag.target.captured).toBeNull();
  expect(drag.target.listeners.size).toBe(0);
  drag.frame();
  drag.target.pointer("pointermove", 160, 100);
  expect(drag.scales).toHaveLength(1);
  drag.dispose();
});

test("pointer cancellation, capture loss, and unmount discard pending samples", () => {
  for (const ending of ["pointercancel", "lostpointercapture", "dispose"]) {
    const drag = setup();
    drag.target.pointer("pointermove", 130, 100);
    if (ending === "dispose") drag.dispose();
    else drag.target.pointer(ending, 0, 0);
    expect(drag.scales).toEqual([]);
    expect(drag.callbacks.size).toBe(0);
    expect(drag.target.captured).toBeNull();
    expect(drag.target.listeners.size).toBe(0);
    drag.frame();
    expect(drag.scales).toEqual([]);
    drag.dispose();
    expect(drag.target.releases).toBe(1);
  }
});

test("another pointer cannot move or end the captured drag", () => {
  const drag = setup();
  drag.target.pointer("pointermove", 160, 100, 9);
  drag.target.pointer("pointerup", 160, 100, 9);
  drag.target.pointer("pointercancel", 0, 0, 9);
  expect(drag.callbacks.size).toBe(0);
  expect(drag.scales).toEqual([]);
  expect(drag.target.captured).toBe(7);
  drag.target.pointer("pointermove", 130, 100);
  drag.frame();
  expect(drag.scales).toEqual([0.8]);
  drag.dispose();
});

test("secondary mouse buttons do not start a resize", () => {
  const drag = setup(2);
  expect(drag.target.captured).toBeNull();
  expect(drag.target.listeners.size).toBe(0);
  drag.dispose();
});

test("repeated or clamped pointer samples do not publish redundant size updates", () => {
  const drag = setup();
  drag.target.pointer("pointermove", 130, 100);
  drag.frame();
  drag.target.pointer("pointermove", 130, 200);
  drag.frame();
  expect(drag.scales).toEqual([0.8]);
  drag.target.pointer("pointermove", 1000, 100);
  drag.frame();
  drag.target.pointer("pointermove", 2000, 100);
  drag.frame();
  expect(drag.scales).toEqual([0.8, 1.5]);
  drag.target.pointer("pointerup", 2000, 100);
  expect(drag.scales).toEqual([0.8, 1.5]);
});
