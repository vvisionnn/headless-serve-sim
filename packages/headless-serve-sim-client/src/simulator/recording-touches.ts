export interface RecordingTouchPoint {
  x: number;
  y: number;
  kind: "single" | "multi";
  opacity?: number;
}

type TimerHandle = unknown;

export interface RecordingTouchTrackerOptions {
  holdMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export class RecordingTouchTracker {
  readonly #holdMs: number;
  readonly #setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  readonly #clearTimer: (handle: TimerHandle) => void;
  #touches: RecordingTouchPoint[] = [];
  #endedAt: number | null = null;
  #timer: TimerHandle | null = null;
  #timerToken: object | null = null;

  constructor({
    holdMs = 180,
    setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }: RecordingTouchTrackerOptions = {}) {
    this.#holdMs = holdMs;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  setActive(touches: readonly RecordingTouchPoint[]): void {
    this.#cancelTimer();
    this.#endedAt = null;
    this.#touches = touches.map(({ x, y, kind }) => ({ x, y, kind }));
  }

  end(touches: readonly RecordingTouchPoint[] = this.#touches, nowMs = performance.now()): void {
    this.#cancelTimer();
    this.#touches = touches.map(({ x, y, kind }) => ({ x, y, kind }));
    this.#endedAt = nowMs;
    const token = {};
    this.#timerToken = token;
    this.#timer = this.#setTimer(() => {
      if (this.#timerToken !== token) return;
      this.#timer = null;
      this.#timerToken = null;
      this.#endedAt = null;
      this.#touches = [];
    }, this.#holdMs);
  }

  snapshot(nowMs = performance.now()): RecordingTouchPoint[] {
    if (this.#endedAt == null) return this.#touches.map((touch) => ({ ...touch }));
    const opacity = Math.max(0, 1 - (nowMs - this.#endedAt) / this.#holdMs);
    return this.#touches.map((touch) => ({ ...touch, opacity }));
  }

  dispose(): void {
    this.#cancelTimer();
    this.#endedAt = null;
    this.#touches = [];
  }

  #cancelTimer(): void {
    if (this.#timer != null) this.#clearTimer(this.#timer);
    this.#timer = null;
    this.#timerToken = null;
  }
}
