import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const udid = process.env.HEADLESS_SERVE_SIM_SYSTEM_TEST_UDID;
const describeWithSim =
  process.env.HEADLESS_SERVE_SIM_SYSTEM_TESTS === "1" && udid ? describe : describe.skip;
const nativeRoot = join(import.meta.dir, "../../../headless-serve-sim-binary");
const build = join(nativeRoot, "Sources/SimDeviceMotion/build.sh");
const output = join(nativeRoot, "dist/simmotion");
const binary = join(output, "headless-serve-sim-device-motion");

function invoke(input: string) {
  return spawnSync("xcrun", ["simctl", "spawn", udid!, binary], {
    input,
    encoding: "utf8",
    timeout: 10_000,
  });
}

function statusAtAngle(angle: number) {
  const deadline = Date.now() + 3000;
  let reply;
  do {
    const status = invoke('{"id":2,"command":"status"}\n');
    expect(status.status).toBe(0);
    reply = JSON.parse(status.stdout.trim());
  } while (Math.abs((reply.observedAngle ?? -1) - angle) > 0.1 && Date.now() < deadline);
  expect(reply.observedAngle).toBeCloseTo(angle, 1);
  return reply;
}

describeWithSim("native motion helper on an explicitly leased Duo simulator", () => {
  let initialAngle: number | undefined;

  beforeAll(() => {
    expect(existsSync(build)).toBe(true);
    const built = spawnSync("bash", [build, output], { encoding: "utf8" });
    expect(built.status).toBe(0);
    const status = invoke('{"id":1,"command":"status"}\n');
    expect(status.status).toBe(0);
    const reply = JSON.parse(status.stdout.trim());
    expect(typeof reply.observedAngle).toBe("number");
    expect(Number.isFinite(reply.observedAngle)).toBe(true);
    expect(reply.observedAngle).toBeGreaterThanOrEqual(0);
    expect(reply.observedAngle).toBeLessThanOrEqual(180);
    initialAngle = reply.observedAngle;
  });

  afterAll(() => {
    if (initialAngle === undefined) return;
    const restored = invoke(
      `${JSON.stringify({ id: 1, command: "angle", angle: initialAngle })}\n`,
    );
    expect(restored.status).toBe(0);
    expect(JSON.parse(restored.stdout.trim()).ok).toBe(true);
    statusAtAngle(initialAngle);
  });

  test("acknowledges independent commands without conflating sensor readback", () => {
    const result = invoke(
      [
        { id: 1, command: "angle", angle: 74.5 },
        { id: 2, command: "angle", angle: 180 },
        { id: 3, command: "status" },
      ]
        .map((command) => JSON.stringify(command))
        .join("\n") + "\n",
    );
    expect(result.status).toBe(0);
    const replies = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      replies.map(({ id, ok, commandedAngle }) => ({
        id,
        ok,
        commandedAngle,
      })),
    ).toEqual([
      { id: 1, ok: true, commandedAngle: 74.5 },
      { id: 2, ok: true, commandedAngle: 180 },
      { id: 3, ok: true, commandedAngle: 180 },
    ]);
    for (const reply of replies) expect(typeof reply.observedAngle).toBe("number");
  });

  test("reads an externally injected angle rather than echoing command memory", () => {
    const set = invoke('{"id":1,"command":"angle","angle":77}\n');
    expect(set.status).toBe(0);
    const reply = statusAtAngle(77);
    expect(reply.commandedAngle).toBeNull();
    expect(reply.observedAgeMs).toBeGreaterThanOrEqual(0);
    expect(reply.observedAgeMs).toBeLessThan(4000);
  });

  test("rejects out-of-range angles without dispatching", () => {
    const result = invoke(`${JSON.stringify({ id: 1, command: "angle", angle: 181 })}\n`);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      id: 1,
      ok: false,
      error: "angle must be a finite number between 0 and 180",
    });
  });
});
