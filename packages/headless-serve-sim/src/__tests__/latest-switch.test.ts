import { expect, test } from "bun:test";
import { latestSwitch } from "../client/utils/latest-switch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

test("a switch whose config lands after a newer switch's is dropped", async () => {
  const run = latestSwitch<string>();
  const applied: string[] = [];
  const first = deferred<string>();
  const second = deferred<string>();
  const a = run(
    () => first.promise,
    (v) => applied.push(v),
  );
  const b = run(
    () => second.promise,
    (v) => applied.push(v),
  );
  second.resolve("B");
  first.resolve("A");
  expect(await b).toBe(true);
  expect(await a).toBe(false);
  // The shown device and the URL follow the latest switch, not the slowest.
  expect(applied).toEqual(["B"]);
});

test("switches that land in order each apply", async () => {
  const run = latestSwitch<string>();
  const applied: string[] = [];
  expect(
    await run(
      async () => "A",
      (v) => applied.push(v),
    ),
  ).toBe(true);
  expect(
    await run(
      async () => "B",
      (v) => applied.push(v),
    ),
  ).toBe(true);
  expect(applied).toEqual(["A", "B"]);
});

test("a superseded switch that fails is no error; the latest one's failure is", async () => {
  const run = latestSwitch<string>();
  const first = deferred<string>();
  const a = run(
    () => first.promise,
    () => {},
  );
  const b = run(
    () => Promise.reject(new Error("gone")),
    () => {},
  );
  first.reject(new Error("stale"));
  expect(await a).toBe(false);
  await expect(b).rejects.toThrow("gone");
});
