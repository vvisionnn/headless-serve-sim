export function createFoldControl(send: (angle: number) => Promise<void>) {
  let pending: number | null = null;
  let running: Promise<void> | null = null;

  const drain = async () => {
    try {
      while (pending !== null) {
        const angle = pending;
        pending = null;
        try {
          await send(angle);
        } catch (error) {
          if (pending === null) throw error;
        }
      }
    } finally {
      running = null;
    }
  };
  return {
    set(angle: number) {
      pending = angle;
      if (!running) running = drain();
      return running;
    },
    async flush() {
      await running;
    },
  };
}
