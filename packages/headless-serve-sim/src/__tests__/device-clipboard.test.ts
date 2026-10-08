import { expect, test } from "bun:test";
import { createDeviceClipboard } from "../device-clipboard";
import { createScriptedHostCommands } from "../test-support/scripted-host-commands";

test("transfers clipboard only on explicit user actions without returning contents", async () => {
  const host = createScriptedHostCommands([
    { result: { stdout: "private clipboard contents" } },
    {},
  ]);
  const clipboard = createDeviceClipboard(host);
  expect(host.calls).toHaveLength(0);
  expect(clipboard.sharing("DUO")).toBe(false);
  expect(await clipboard.transfer("DUO", "to")).toBeUndefined();
  expect(await clipboard.transfer("DUO", "from")).toBeUndefined();
  expect(host.calls.map(({ request }) => request.args)).toEqual(
    ["to", "from"].map((direction) => [
      "devicectl",
      "device",
      "pasteboard",
      "transfer",
      direction,
      "--device",
      "DUO",
      "--data-policy",
      "all-resolved",
      "--quiet",
      "--json-output",
      "-",
    ]),
  );
  expect(
    host.calls.every(
      ({ request }) => request.executable === "xcrun" && request.shell === undefined,
    ),
  ).toBe(true);
  clipboard.dispose();
});

test("Paste transfers the Mac clipboard before the guest shortcut", async () => {
  const host = createScriptedHostCommands([{}]);
  const clipboard = createDeviceClipboard(host);
  let pressed = false;
  await clipboard.shortcut("DUO", "paste", async () => {
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]?.request.args).toContain("to");
    pressed = true;
  });
  expect(pressed).toBe(true);
  expect(clipboard.sharing("DUO")).toBe(false);
  clipboard.dispose();
});

test("Copy waits for a new guest clipboard revision before transferring to the Mac", async () => {
  const host = createScriptedHostCommands([
    { result: { stdout: '{"result":{"changeCount":10}}' } },
    { result: { stdout: '{"result":{"changeCount":10}}' } },
    { result: { stdout: '{"result":{"changeCount":11}}' } },
    {},
  ]);
  const clipboard = createDeviceClipboard(host);
  await clipboard.shortcut("DUO", "copy", async () => {
    expect(host.calls).toHaveLength(1);
  });
  expect(host.calls.map(({ request }) => request.args?.[3])).toEqual([
    "info",
    "info",
    "info",
    "transfer",
  ]);
  expect(host.calls.at(-1)?.request.args).toContain("from");
  clipboard.dispose();
});

test("Copy with no guest selection does not overwrite the Mac clipboard", async () => {
  const host = createScriptedHostCommands(
    Array.from({ length: 9 }, () => ({ result: { stdout: '{"result":{"changeCount":10}}' } })),
  );
  const clipboard = createDeviceClipboard(host);
  await clipboard.shortcut("DUO", "copy", async () => {});
  expect(host.calls).toHaveLength(9);
  expect(host.calls.every(({ request }) => request.args?.[3] === "info")).toBe(true);
  clipboard.dispose();
});

test("failed clipboard transfer never pastes stale guest contents", async () => {
  const host = createScriptedHostCommands([{ result: { exitCode: 1 } }]);
  const clipboard = createDeviceClipboard(host);
  let pressed = false;
  await expect(
    clipboard.shortcut("DUO", "paste", async () => {
      pressed = true;
    }),
  ).rejects.toThrow("Clipboard transfer failed");
  expect(pressed).toBe(false);
  clipboard.dispose();
});

test("failed guest copy never overwrites the Mac clipboard", async () => {
  const host = createScriptedHostCommands([
    { result: { stdout: '{"result":{"changeCount":10}}' } },
  ]);
  const clipboard = createDeviceClipboard(host);
  await expect(
    clipboard.shortcut("DUO", "cut", async () => {
      throw new Error("key dispatch failed");
    }),
  ).rejects.toThrow("key dispatch failed");
  expect(host.calls).toHaveLength(1);
  clipboard.dispose();
});

test("rejects invalid and disposed clipboard operations before host commands", async () => {
  const host = createScriptedHostCommands();
  const clipboard = createDeviceClipboard(host);
  await expect(clipboard.transfer("--help", "to")).rejects.toThrow();
  await expect(clipboard.transfer("DUO", "sideways" as "to")).rejects.toThrow();
  expect(() => clipboard.setSharing("DUO;bad", true)).toThrow();
  expect(() => clipboard.setSharing("DUO", "on" as unknown as boolean)).toThrow();
  clipboard.dispose();
  await expect(clipboard.transfer("DUO", "to")).rejects.toThrow("disposed");
  expect(() => clipboard.setSharing("DUO", true)).toThrow("disposed");
  expect(host.calls).toHaveLength(0);
});

test("starts sharing only when enabled and stops it without renewing when disabled", async () => {
  const host = createScriptedHostCommands([{ pid: 101, holdUntilStopped: true }]);
  const clipboard = createDeviceClipboard(host);
  clipboard.setSharing("DUO", false);
  expect(host.calls).toHaveLength(0);
  clipboard.setSharing("DUO", true);
  clipboard.setSharing("DUO", true);
  expect(clipboard.sharing("DUO")).toBe(true);
  expect(host.calls).toHaveLength(1);
  expect(host.calls[0]?.request).toEqual({
    executable: "xcrun",
    args: [
      "devicectl",
      "device",
      "pasteboard",
      "sync-with-host",
      "--device",
      "DUO",
      "--session-timeout",
      "300",
      "--timeout",
      "315",
      "--quiet",
      "--json-output",
      "-",
    ],
    stdio: "capture",
    timeoutMs: 320_000,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  await Promise.resolve();
  clipboard.setSharing("DUO", false);
  await Promise.resolve();
  expect(clipboard.sharing("DUO")).toBe(false);
  expect(host.signals).toEqual([{ pid: 101, signal: "SIGTERM" }]);
  expect(host.calls).toHaveLength(1);
  clipboard.dispose();
});

test("renews an opted-in session after its native timeout and stops it on dispose", async () => {
  const host = createScriptedHostCommands([{}, { pid: 102, holdUntilStopped: true }]);
  const clipboard = createDeviceClipboard(host);
  clipboard.setSharing("DUO", true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(host.calls).toHaveLength(2);
  expect(clipboard.sharing("DUO")).toBe(true);
  clipboard.dispose();
  await Promise.resolve();
  expect(host.signals).toEqual([{ pid: 102, signal: "SIGTERM" }]);
  expect(clipboard.sharing("DUO")).toBe(false);
  expect(host.calls).toHaveLength(2);
});

test("a failed native sync session stops sharing instead of silently renewing", async () => {
  const host = createScriptedHostCommands([{ result: { exitCode: 1, stderr: "Unavailable" } }]);
  const clipboard = createDeviceClipboard(host);
  clipboard.setSharing("DUO", true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(clipboard.sharing("DUO")).toBe(false);
  expect(host.calls).toHaveLength(1);
  clipboard.dispose();
});
