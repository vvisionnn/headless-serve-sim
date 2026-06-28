/**
 * Read a boolean UI flag from localStorage. A missing key (or any storage
 * error) yields the fallback; the stored "1" decodes to true and anything
 * else to false.
 */
export function readPersistedFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

/**
 * Persist a boolean UI flag to localStorage as "1"/"0". Storage errors are
 * swallowed so a write can never throw into the render path.
 */
export function writePersistedFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {}
}
