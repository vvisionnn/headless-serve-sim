/**
 * Starting a simulator that already streams only tidies up (orphan helpers,
 * the touch service), yet spawns the CLI and costs half a second. Switch at
 * once and let the start run alongside; wait on it only when the switch
 * finds nothing streaming yet.
 */
export async function switchWhileStarting(
  start: () => Promise<void>,
  switchTo: () => Promise<void>,
): Promise<void> {
  const started = start();
  try {
    await switchTo();
    started.catch(() => {});
  } catch {
    await started;
    await switchTo();
  }
}
