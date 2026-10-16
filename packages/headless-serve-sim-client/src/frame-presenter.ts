export interface ClosableFrame {
  close(): void;
}

type Schedule = (callback: () => void) => number;
type Cancel = (handle: number) => void;

/** Frames that may wait for a display tick; more would only add latency. */
const MAX_WAITING = 2;

/**
 * Vsync-paced presentation: at most one frame is drawn per display tick.
 *
 * A stream and the display are not phase-locked, so a steady 60 fps source
 * regularly delivers two frames between the same pair of ticks. Drawing both
 * hides the first one — visible judder — so the second waits for the next
 * tick instead. A frame that arrives when nothing was drawn this tick is drawn
 * immediately, keeping input response at zero added latency. The tick, not a
 * time threshold, is the boundary, so this holds at 60 Hz and 120 Hz alike.
 */
export class FramePresenter<Frame extends ClosableFrame, Metadata> {
  private waiting: { frame: Frame; metadata: Metadata }[] = [];
  private scheduled: number | null = null;
  private drawnThisTick = false;
  private stopped = false;

  constructor(
    private readonly schedule: Schedule,
    private readonly cancel: Cancel,
    private readonly present: (frame: Frame, metadata: Metadata) => void,
    private readonly onDiscard: () => void = () => {},
  ) {}

  enqueue(frame: Frame, metadata: Metadata): void {
    if (this.stopped) {
      frame.close();
      return;
    }
    if (!this.drawnThisTick && this.waiting.length === 0) {
      this.draw(frame, metadata);
    } else {
      if (this.waiting.length === MAX_WAITING) {
        this.waiting.shift()!.frame.close();
        this.onDiscard();
      }
      this.waiting.push({ frame, metadata });
    }
    this.scheduled ??= this.schedule(this.tick);
  }

  /** Drops waiting frames; the current tick still bounds the next draw. */
  clear(countDiscard = false): void {
    if (this.waiting.length > 0 && countDiscard) this.onDiscard();
    for (const { frame } of this.waiting) frame.close();
    this.waiting = [];
  }

  close(): void {
    this.stopped = true;
    this.clear();
    if (this.scheduled != null) this.cancel(this.scheduled);
    this.scheduled = null;
  }

  private readonly tick = () => {
    this.scheduled = null;
    if (this.stopped) return;
    if (this.drawnThisTick) {
      // The frame drawn since the last tick is on screen now.
      this.drawnThisTick = false;
    } else {
      const next = this.waiting.shift();
      if (next) this.draw(next.frame, next.metadata);
      // Drawn inside the tick, it shows in this same frame.
      this.drawnThisTick = false;
    }
    if (this.waiting.length > 0) this.scheduled = this.schedule(this.tick);
  };

  private draw(frame: Frame, metadata: Metadata): void {
    this.drawnThisTick = true;
    try {
      this.present(frame, metadata);
    } finally {
      frame.close();
    }
  }
}
