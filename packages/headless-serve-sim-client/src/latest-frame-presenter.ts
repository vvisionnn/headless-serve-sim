export interface ClosableFrame {
  close(): void;
}

type Schedule = (callback: () => void) => number;
type Cancel = (handle: number) => void;

/**
 * Bounded presentation mailbox: at most one decoded frame waits for the next
 * display opportunity. A newer frame replaces and closes the older one, so a
 * network/decode burst cannot turn into invisible canvas work or GPU pressure.
 */
export class LatestFramePresenter<Frame extends ClosableFrame, Metadata> {
  private pending: { frame: Frame; metadata: Metadata } | null = null;
  private scheduled: number | null = null;
  private stopped = false;
  private lastPresentedAt = -Infinity;

  constructor(
    private readonly schedule: Schedule,
    private readonly cancel: Cancel,
    private readonly present: (frame: Frame, metadata: Metadata) => void,
    private readonly onDiscard: () => void = () => {},
    private readonly now: () => number = () => 0,
    private readonly immediateIntervalMs = Infinity,
  ) {}

  enqueue(frame: Frame, metadata: Metadata): void {
    if (this.stopped) {
      frame.close();
      return;
    }
    if (
      !this.pending &&
      this.scheduled == null &&
      Number.isFinite(this.immediateIntervalMs) &&
      this.now() - this.lastPresentedAt >= this.immediateIntervalMs
    ) {
      this.presentAndClose(frame, metadata);
      return;
    }
    if (this.pending) {
      this.pending.frame.close();
      this.onDiscard();
    }
    this.pending = { frame, metadata };
    if (this.scheduled == null) this.scheduled = this.schedule(this.flush);
  }

  clear(): void {
    if (this.pending) {
      this.pending.frame.close();
      this.pending = null;
    }
    if (this.scheduled != null) {
      this.cancel(this.scheduled);
      this.scheduled = null;
    }
  }

  close(): void {
    this.stopped = true;
    this.clear();
  }

  private readonly flush = () => {
    this.scheduled = null;
    const current = this.pending;
    this.pending = null;
    if (!current || this.stopped) return;
    this.presentAndClose(current.frame, current.metadata);
  };

  private presentAndClose(frame: Frame, metadata: Metadata): void {
    try {
      this.present(frame, metadata);
      this.lastPresentedAt = this.now();
    } finally {
      frame.close();
    }
  }
}
