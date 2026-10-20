import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import {
  deviceConfig,
  keepDeviceConfigsWarm,
  prefetchDeviceConfig,
  switchWhileStarting,
} from "../client/utils/device-switch";

test("a simulator that already streams switches without waiting on its start", async () => {
  const order: string[] = [];
  await switchWhileStarting(
    () => new Promise<void>(() => order.push("start")),
    async () => {
      order.push("switch");
    },
  );
  expect(order).toEqual(["start", "switch"]);
});

test("a simulator that isn't streaming yet switches once its start lands", async () => {
  const order: string[] = [];
  let attempts = 0;
  await switchWhileStarting(
    async () => {
      await Promise.resolve();
      order.push("started");
    },
    async () => {
      attempts++;
      if (attempts === 1) throw new Error("The simulator isn't streaming yet");
      order.push("switch");
    },
  );
  expect(order).toEqual(["started", "switch"]);
});

test("a failed start fails the switch", async () => {
  const failed = switchWhileStarting(
    () => Promise.reject(new Error("boot failed")),
    () => Promise.reject(new Error("The simulator isn't streaming yet")),
  );
  expect(failed).rejects.toThrow("boot failed");
});

test("a start that fails after a failed switch reaches the caller with its reason", async () => {
  const failed = switchWhileStarting(
    () => new Promise<void>((_, reject) => setTimeout(() => reject(new Error("CLI not found")), 5)),
    () => Promise.reject(new Error("The simulator isn't streaming yet")),
  );
  expect(failed).rejects.toThrow("CLI not found");
});

describe("device config prefetch", () => {
  afterEach(() => setSystemTime());

  test("a fresh prefetch is reused by the switch", async () => {
    setSystemTime(new Date(1_000_000));
    const load = mock(async (udid: string) => ({ device: udid }));
    void prefetchDeviceConfig("fresh", load);
    setSystemTime(new Date(1_000_000 + 2_000));
    expect(await deviceConfig("fresh", load)).toEqual({ device: "fresh" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("a stale prefetch is fetched again", async () => {
    setSystemTime(new Date(2_000_000));
    let calls = 0;
    const load = async (udid: string) => ({ device: udid, call: ++calls });
    void prefetchDeviceConfig("stale", load);
    setSystemTime(new Date(2_000_000 + 3_500));
    expect(await deviceConfig("stale", load)).toEqual({ device: "stale", call: 2 });
  });

  test("a failed prefetch isn't reused", async () => {
    let calls = 0;
    const load = async (udid: string) => {
      if (++calls === 1) throw new Error("The simulator isn't streaming yet");
      return { device: udid };
    };
    await expect(prefetchDeviceConfig("failed", load)).rejects.toThrow("isn't streaming yet");
    expect(await deviceConfig("failed", load)).toEqual({ device: "failed" });
    expect(calls).toBe(2);
  });

  test("a refresh still in flight doesn't hold up the fresh answer in hand", async () => {
    let calls = 0;
    const load = (udid: string) =>
      ++calls === 1 ? Promise.resolve({ device: udid, call: 1 }) : new Promise<never>(() => {});
    await prefetchDeviceConfig("held", load);
    void prefetchDeviceConfig("held", load);
    expect(await deviceConfig("held", load)).toEqual({ device: "held", call: 1 });
    expect(calls).toBe(2);
  });

  test("a device kept warm is fetched at once, then again until it's let go", async () => {
    const asked: string[] = [];
    const load = async (udid: string) => {
      asked.push(udid);
      return { device: udid };
    };
    const stop = keepDeviceConfigsWarm(["a", "b"], load, 10, () => {});
    expect(asked).toEqual(["a", "b"]);
    await new Promise((r) => setTimeout(r, 25));
    stop();
    const warmed = asked.length;
    expect(warmed).toBeGreaterThanOrEqual(4);
    await new Promise((r) => setTimeout(r, 25));
    expect(asked.length).toBe(warmed);
  });

  test("a device kept warm has its settings warmed once its config is in hand", async () => {
    const warmed: string[] = [];
    const load = async (udid: string) => {
      if (udid === "down") throw new Error("The simulator isn't streaming yet");
      return { device: udid };
    };
    const stop = keepDeviceConfigsWarm(["up", "down"], load, 60_000, (udid) => {
      warmed.push(udid);
    });
    expect(warmed).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(warmed).toEqual(["up"]);
  });
});
