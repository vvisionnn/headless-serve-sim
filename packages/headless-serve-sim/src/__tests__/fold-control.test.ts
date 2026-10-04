import { expect, test } from "bun:test";
import { createFoldControl } from "../client/utils/fold-control";

test("coalesces slider updates while preserving final angle", async () => {
  const calls: number[] = [];
  const finish: Array<() => void> = [];
  const control = createFoldControl((angle) => {
    calls.push(angle);
    return new Promise<void>((resolve) => finish.push(resolve));
  });
  void control.set(10);
  void control.set(40);
  void control.set(90);
  expect(calls).toEqual([10]);
  finish.shift()!();
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual([10, 90]);
  finish.shift()!();
  await control.flush();
});

test("reports the newest write failure to shared callers and allows a later edit", async () => {
  const calls: number[] = [];
  const reject: Array<(error: Error) => void> = [];
  const control = createFoldControl((angle) => {
    calls.push(angle);
    if (angle === 180) return Promise.resolve();
    return new Promise<void>((_resolve, fail) => reject.push(fail));
  });
  const first = control.set(10).then(
    () => null,
    (error: unknown) => error,
  );
  const latest = control.set(90).then(
    () => null,
    (error: unknown) => error,
  );
  const flushed = control.flush().then(
    () => null,
    (error: unknown) => error,
  );
  reject.shift()!(new Error("old failure"));
  await Promise.resolve();
  await Promise.resolve();
  const error = new Error("newest failure");
  reject.shift()!(error);
  expect(await Promise.all([first, latest, flushed])).toEqual([error, error, error]);
  await control.set(180);
  await control.flush();
  expect(calls).toEqual([10, 90, 180]);
});

test("dispatches an angle queued while the previous drain is settling", async () => {
  const calls: number[] = [];
  const control = createFoldControl(async (angle) => {
    calls.push(angle);
  });
  const first = control.set(10);
  let latest: Promise<void> | undefined;
  queueMicrotask(() => {
    latest = control.set(90);
  });
  await first;
  await latest;
  await control.flush();
  expect(calls).toEqual([10, 90]);
});

test("dispatches newest pending angle after an older write rejects without retrying it", async () => {
  const calls: number[] = [];
  let rejectFirst!: (error: Error) => void;
  let finishLatest!: () => void;
  const control = createFoldControl((angle) => {
    calls.push(angle);
    return new Promise<void>((resolve, reject) => {
      if (angle === 10) rejectFirst = reject;
      else finishLatest = resolve;
    });
  });
  const first = control.set(10).then(
    () => null,
    (error: unknown) => error,
  );
  const middle = control.set(40).then(
    () => null,
    (error: unknown) => error,
  );
  const latest = control.set(90).then(
    () => null,
    (error: unknown) => error,
  );
  rejectFirst(new Error("old write rejected"));
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual([10, 90]);
  finishLatest();
  expect(await Promise.all([first, middle, latest])).toEqual([null, null, null]);
  await control.flush();
});
