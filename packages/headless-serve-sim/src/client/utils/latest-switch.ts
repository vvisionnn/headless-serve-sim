/**
 * Switches can overlap — a click, then Back before its config is in — and
 * their configs land in any order. Only the latest switch may apply what it
 * loaded, so the device shown and the URL always agree. Resolves whether
 * this switch applied; a superseded one neither applies nor fails.
 */
export function latestSwitch<T>() {
  let latest = 0;
  return async (load: () => Promise<T>, apply: (value: T) => void): Promise<boolean> => {
    const id = ++latest;
    let value: T;
    try {
      value = await load();
    } catch (err) {
      if (id !== latest) return false;
      throw err;
    }
    if (id !== latest) return false;
    apply(value);
    return true;
  };
}
