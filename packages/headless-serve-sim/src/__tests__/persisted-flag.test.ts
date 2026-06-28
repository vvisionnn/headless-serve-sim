import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readPersistedFlag, writePersistedFlag } from "../client/utils/persisted-flag";

// Minimal Map-backed localStorage stub. Bun has no DOM, so the util's
// localStorage reference resolves to whatever we install on globalThis.
function installStorage(impl: Partial<Storage>) {
  (globalThis as { localStorage?: unknown }).localStorage = impl;
}

function mapStorage() {
  const m = new Map<string, string>();
  return {
    store: m,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as unknown as Storage & { store: Map<string, string> };
}

let storage: ReturnType<typeof mapStorage>;

beforeEach(() => {
  storage = mapStorage();
  installStorage(storage);
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("readPersistedFlag", () => {
  test("missing key returns the fallback (both polarities)", () => {
    expect(readPersistedFlag("absent", true)).toBe(true);
    expect(readPersistedFlag("absent", false)).toBe(false);
  });

  test('"1" decodes to true', () => {
    storage.store.set("k", "1");
    expect(readPersistedFlag("k", false)).toBe(true);
  });

  test('"0" decodes to false', () => {
    storage.store.set("k", "0");
    expect(readPersistedFlag("k", true)).toBe(false);
  });

  test("any non-\"1\" value decodes to false (not the fallback)", () => {
    storage.store.set("k", "true");
    expect(readPersistedFlag("k", true)).toBe(false);
    storage.store.set("k", "");
    expect(readPersistedFlag("k", true)).toBe(false);
  });

  test("a throwing localStorage falls back without throwing", () => {
    installStorage({
      getItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage);
    expect(() => readPersistedFlag("k", true)).not.toThrow();
    expect(readPersistedFlag("k", true)).toBe(true);
    expect(readPersistedFlag("k", false)).toBe(false);
  });
});

describe("writePersistedFlag", () => {
  test("writes \"1\" for true and \"0\" for false", () => {
    writePersistedFlag("k", true);
    expect(storage.store.get("k")).toBe("1");
    writePersistedFlag("k", false);
    expect(storage.store.get("k")).toBe("0");
  });

  test("a throwing localStorage swallows the error", () => {
    installStorage({
      setItem: () => {
        throw new Error("quota");
      },
    } as unknown as Storage);
    expect(() => writePersistedFlag("k", true)).not.toThrow();
  });
});

describe("round-trip", () => {
  test("write then read recovers the value", () => {
    writePersistedFlag("flag", true);
    expect(readPersistedFlag("flag", false)).toBe(true);
    writePersistedFlag("flag", false);
    expect(readPersistedFlag("flag", true)).toBe(false);
  });
});
