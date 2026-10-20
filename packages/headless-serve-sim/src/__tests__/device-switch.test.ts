import { expect, test } from "bun:test";
import { switchWhileStarting } from "../client/utils/device-switch";

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
