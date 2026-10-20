/**
 * Sets queued latest-wins per key: one set in flight per key at a time, and
 * a value asked for meanwhile is sent once it finishes — unless a later one
 * replaced it, or it's the value just sent. Out-of-order completions can't
 * leave the target on a stale value, and no click is lost.
 */
export function latestWins<V>(
  send: (key: string, value: V) => Promise<void>,
): (key: string, value: V) => void {
  const queues = new Map<string, { next: { value: V } | null }>();
  return (key, value) => {
    const running = queues.get(key);
    if (running) {
      running.next = { value };
      return;
    }
    const queue = { next: { value } as { value: V } | null };
    queues.set(key, queue);
    void (async () => {
      let sent: { value: V } | null = null;
      while (queue.next && (!sent || !Object.is(queue.next.value, sent.value))) {
        sent = queue.next;
        queue.next = null;
        await send(key, sent.value).catch(() => {});
      }
      queues.delete(key);
    })();
  };
}
