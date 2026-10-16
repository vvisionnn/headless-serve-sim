/**
 * Resolves as soon as `condition` holds. The deadline is only a hang guard,
 * never a timing assumption, so it is far longer than any healthy run needs.
 */
export async function waitFor(condition: () => boolean, hangGuardMs = 60_000): Promise<void> {
  const deadline = Date.now() + hangGuardMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
