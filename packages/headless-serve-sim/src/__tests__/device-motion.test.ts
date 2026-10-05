import { expect, spyOn, test } from "bun:test";
import { PassThrough } from "node:stream";
import type { CommandRequest, CommandResult, HostCommands } from "../runtime/host-commands";
import { createDeviceMotion } from "../device-motion";

function motionHost(observedAgeMs = 250) {
  const calls: CommandRequest[] = [];
  const input = new PassThrough();
  const output = new PassThrough();
  const commands: {
    id: number;
    command: string;
    angle?: number;
    orientation?: string;
    usagePage?: number;
    usage?: number;
    phase?: string;
  }[] = [];
  let autoStatus = true;
  let finish: () => void = () => {};
  const result = new Promise<any>((resolve) => {
    finish = () =>
      resolve({
        exitCode: 0,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        timedOut: false,
      });
  });
  input.on("data", (chunk) => {
    const command = JSON.parse(chunk.toString().trim());
    commands.push(command);
    if (autoStatus && command.command === "status")
      queueMicrotask(() =>
        output.write(
          `${JSON.stringify({ id: command.id, ok: true, commandedAngle: null, observedAngle: 77, observedAgeMs })}\n`,
        ),
      );
  });
  const host: HostCommands = {
    run: (() => {
      throw new Error("Unexpected run");
    }) as HostCommands["run"],
    start(request) {
      calls.push(request);
      return {
        pid: 123,
        stdin: input,
        stdout: output,
        stderr: null,
        result,
        stop: finish,
        unref() {},
      };
    },
    signal: () => false,
  };
  return {
    host,
    calls,
    commands,
    holdStatus() {
      autoStatus = false;
    },
    exit: () => finish(),
    reject(index: number, error: string) {
      output.write(`${JSON.stringify({ id: commands[index]!.id, ok: false, error })}\n`);
    },
    acknowledge(index: number) {
      const command = commands[index]!;
      output.write(
        `${JSON.stringify({ id: command.id, ok: true, commandedAngle: command.angle ?? null, observedAngle: null })}\n`,
      );
    },
  };
}

test("serializes keyboard down and up on the existing persistent guest helper", async () => {
  const transport = motionHost();
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  try {
    const down = motion.sendKey("DEVICE", 4, "down");
    const up = motion.sendKey("DEVICE", 4, "up");
    await Bun.sleep(0);
    expect(transport.commands).toEqual([{ id: 1, command: "key", usage: 4, phase: "down" }]);
    transport.acknowledge(0);
    await down;
    await Bun.sleep(0);
    expect(transport.commands).toEqual([
      { id: 1, command: "key", usage: 4, phase: "down" },
      { id: 2, command: "key", usage: 4, phase: "up" },
    ]);
    transport.acknowledge(1);
    await up;
    expect(transport.calls).toHaveLength(1);
  } finally {
    motion.dispose();
  }
});

test("restarts the helper after the simulator closes its process", async () => {
  const transport = motionHost();
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  const first = motion.setAngle("DEVICE", 10);
  await Bun.sleep(0);
  transport.acknowledge(0);
  await first;
  transport.exit();
  await Bun.sleep(0);
  const second = motion.setAngle("DEVICE", 20).catch((error) => error as Error);
  await Bun.sleep(0);
  expect(transport.calls).toHaveLength(2);
  motion.dispose();
  await second;
});

test("serializes an angle arriving during a state read", async () => {
  const transport = motionHost();
  transport.holdStatus();
  transport.host.run = (async (_request: CommandRequest) => ({
    exitCode: 0,
    signal: null,
    stdout: Buffer.from('{"result":{}}'),
    stderr: Buffer.alloc(0),
    timedOut: false,
  })) as HostCommands["run"];
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  const status = motion.status("DEVICE");
  await Bun.sleep(0);
  expect(transport.commands).toEqual([{ id: 1, command: "status" }]);
  const angle = motion.setAngle("DEVICE", 15);
  const result = angle.then(
    () => null,
    (error) => error as Error,
  );
  transport.acknowledge(0);
  await Bun.sleep(0);
  expect(transport.commands[1]).toEqual({ id: 2, command: "angle", angle: 15 });
  transport.acknowledge(1);
  await status;
  expect(await result).toBeNull();
  motion.dispose();
});

test("surfaces helper failures without reporting rejected angles as commanded state", async () => {
  const transport = motionHost();
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  const result = motion.setAngle("DEVICE", 90);
  await Bun.sleep(0);
  transport.reject(0, "sensor unavailable");
  await expect(result).rejects.toThrow("sensor unavailable");
  motion.dispose();
});

test.each([
  "portrait",
  "portraitUpsideDown",
  "landscapeLeft",
  "landscapeRight",
  "faceUp",
  "faceDown",
] as const)(
  "sets physical orientation %s through the persistent guest HID session",
  async (orientation) => {
    const transport = motionHost();
    const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
    const result = motion.setOrientation("DEVICE", orientation);
    await Bun.sleep(0);
    expect(transport.commands).toEqual([{ id: 1, command: "orientation", orientation }]);
    transport.acknowledge(0);
    await result;
    motion.dispose();
  },
);

test("sends consumer phases on the same persistent native helper", async () => {
  const transport = motionHost();
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  for (const [index, phase] of (["down", "up", "press"] as const).entries()) {
    const sent = motion.sendConsumer("DEVICE", 12, 0xe9, phase);
    await Bun.sleep(0);
    expect(transport.commands[index]).toEqual({
      id: index + 1,
      command: "consumer",
      usagePage: 12,
      usage: 0xe9,
      phase,
    });
    transport.acknowledge(index);
    await sent;
  }
  expect(transport.calls).toHaveLength(1);
  motion.dispose();
});

test("serializes consumer events with an in-flight state read and queued angle", async () => {
  const transport = motionHost();
  transport.holdStatus();
  transport.host.run = (async (_request: CommandRequest) => ({
    exitCode: 0,
    signal: null,
    stdout: Buffer.from('{"result":{}}'),
    stderr: Buffer.alloc(0),
    timedOut: false,
  })) as HostCommands["run"];
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  const status = motion.status("DEVICE");
  await Bun.sleep(0);
  const down = motion.sendConsumer("DEVICE", 12, 0x30, "down");
  const up = motion.sendConsumer("DEVICE", 12, 0x30, "up");
  const angle = motion.setAngle("DEVICE", 130);
  await Bun.sleep(0);
  expect(transport.commands).toEqual([{ id: 1, command: "status" }]);
  for (let index = 0; index < 4; index++) {
    transport.acknowledge(index);
    await Bun.sleep(0);
  }
  await Promise.all([status, down, up, angle]);
  expect(
    transport.commands
      .filter((command) => command.command === "consumer")
      .map((command) => command.phase),
  ).toEqual(["down", "up"]);
  expect(transport.commands.find((command) => command.command === "angle")?.angle).toBe(130);
  motion.dispose();
});

test("rejects invalid consumer events before launching native tooling", async () => {
  const transport = motionHost();
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  for (const [page, usage] of [
    [7, 0x30],
    [12, -1],
    [12, 65536],
    [12, NaN],
    [12, 0.5],
  ]) {
    await expect(motion.sendConsumer("DEVICE", page!, usage!, "press")).rejects.toThrow(
      "Invalid consumer HID event",
    );
  }
  expect(transport.calls).toHaveLength(0);
  motion.dispose();
});

test("starts independent motion status probes before any host query settles", async () => {
  const transport = motionHost();
  const queries: CommandRequest[] = [];
  const releases: Array<() => void> = [];
  transport.host.run = (async (request: CommandRequest) => {
    queries.push(request);
    await new Promise<void>((resolve) => releases.push(resolve));
    return {
      exitCode: 0,
      signal: null,
      stdout: Buffer.from('{"result":{}}'),
      stderr: Buffer.alloc(0),
      timedOut: false,
    };
  }) as HostCommands["run"];
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  const status = motion.status("DEVICE");
  try {
    await Bun.sleep(0);
    expect(queries).toHaveLength(2);
    expect(transport.commands).toEqual([{ id: 1, command: "status" }]);
  } finally {
    for (let i = 0; i < 3; i++) {
      releases.splice(0).forEach((release) => release());
      await Bun.sleep(0);
    }
    await status;
    motion.dispose();
  }
});

test("keeps display, orientation, hinge errors ordered despite reverse probe completion", async () => {
  const transport = motionHost();
  transport.holdStatus();
  let rejectDisplays: () => void = () => {};
  transport.host.run = (async (request: CommandRequest) => {
    if (request.args?.includes("get")) throw new Error("orientation failed");
    return new Promise<CommandResult>((_resolve, reject) => {
      rejectDisplays = () => reject(new Error("displays failed"));
    });
  }) as HostCommands["run"];
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  try {
    const status = motion.status("DEVICE");
    await Bun.sleep(0);
    transport.reject(0, "hinge failed");
    await Bun.sleep(0);
    rejectDisplays();
    expect((await status).observed.errors).toEqual([
      "displays failed",
      "orientation failed",
      "hinge failed",
    ]);
  } finally {
    motion.dispose();
  }
});

test("keeps unavailable sensor error after host probe errors", async () => {
  const transport = motionHost();
  transport.holdStatus();
  transport.host.run = (async (request: CommandRequest): Promise<CommandResult> => {
    throw new Error(request.args?.includes("get") ? "orientation failed" : "displays failed");
  }) as HostCommands["run"];
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  try {
    const status = motion.status("DEVICE");
    await Bun.sleep(0);
    transport.acknowledge(0);
    const state = await status;
    expect(state.observed.hingeAngle).toBeNull();
    expect(state.observed.errors).toEqual([
      "displays failed",
      "orientation failed",
      "Hinge angle sensor readback is unavailable; commanded angle is not observed state.",
    ]);
  } finally {
    motion.dispose();
  }
});

test("reads orientation and active displays from simulator state rather than commanded angle", async () => {
  const response = {
    result: {
      displays: [
        { displayId: 1, active: true, nativeSize: [1398, 2034], currentOrientation: "rot0" },
      ],
      orientation: {
        currentDeviceOrientation: "faceUp",
        currentDeviceNonFlatOrientation: "portrait",
        currentDeviceOrientationLocked: false,
      },
    },
  };
  const transport = motionHost();
  const calls: CommandRequest[] = [];
  transport.host.run = (async (request: CommandRequest) => {
    calls.push(request);
    const actual = request.args?.includes("get")
      ? {
          result: {
            deviceOrientation: "faceDown",
            deviceOrientationNonFlat: "portrait",
            deviceIsOrientationLocked: false,
          },
        }
      : response;
    return {
      exitCode: 0,
      signal: null,
      stdout: Buffer.from(JSON.stringify(actual)),
      stderr: Buffer.alloc(0),
      timedOut: false,
    };
  }) as HostCommands["run"];
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  const state = await motion.status("DEVICE");
  expect(state).toMatchObject({
    commanded: { hingeAngle: null, orientation: null, pose: null },
    observed: {
      hingeAngle: 77,
      hingeAngleAgeMs: 250,
      orientation: "faceDown",
      nonFlatOrientation: "portrait",
      orientationLocked: false,
      displays: response.result.displays,
    },
  });
  expect(calls[0]).toMatchObject({
    executable: "xcrun",
    args: [
      "devicectl",
      "device",
      "info",
      "displays",
      "--device",
      "DEVICE",
      "--quiet",
      "--json-output",
      "-",
      "--timeout",
      "5",
    ],
  });
  expect(transport.calls).toHaveLength(1);
  expect(state.observed.errors).toEqual([]);
  motion.dispose();
});

test("orientation ACK does not let lagging guest readback reverse a new rotation", async () => {
  let now = 1000,
    physical = "portrait";
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const transport = motionHost();
  transport.host.run = (async (request: CommandRequest) => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stderr: Buffer.alloc(0),
    stdout: Buffer.from(
      JSON.stringify({
        result: request.args?.includes("get") ? { deviceOrientation: physical } : {},
      }),
    ),
  })) as HostCommands["run"];
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  try {
    const rotation = motion.setOrientation("DEVICE", "landscapeRight");
    await Bun.sleep(0);
    transport.acknowledge(0);
    await rotation;
    expect((await motion.status("DEVICE")).commanded.orientation).toBe("landscapeRight");
    now += 500;
    expect((await motion.status("DEVICE")).commanded.orientation).toBe("landscapeRight");
    physical = "landscapeRight";
    expect((await motion.status("DEVICE")).commanded.orientation).toBeNull();
    physical = "portrait";
    expect((await motion.status("DEVICE")).commanded.orientation).toBeNull();
  } finally {
    motion.dispose();
    clock.mockRestore();
  }
});

test("expires historical orientation commands after fresh guest readback", async () => {
  const transport = motionHost();
  transport.host.run = (async (request: CommandRequest) => ({
    exitCode: 0,
    signal: null,
    stdout: Buffer.from(
      JSON.stringify({
        result: request.args?.includes("get") ? { deviceOrientation: "portrait" } : {},
      }),
    ),
    stderr: Buffer.alloc(0),
    timedOut: false,
  })) as HostCommands["run"];
  let now = 1000;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  try {
    const orientation = motion.setOrientation("DEVICE", "landscapeRight");
    await Bun.sleep(0);
    transport.acknowledge(0);
    await orientation;
    now += 2001;
    const state = await motion.status("DEVICE");
    expect(state.observed.orientation).toBe("portrait");
    expect(state.commanded.orientation).toBeNull();
  } finally {
    motion.dispose();
    clock.mockRestore();
  }
});

test.each([true, false])(
  "does not expire a newer orientation using an overlapping read (pending at start: %s)",
  async (pendingAtStart) => {
    const transport = motionHost();
    let releaseOrientation: () => void = () => {};
    let holdOrientation = true;
    transport.host.run = (async (request: CommandRequest) => {
      if (request.args?.includes("get") && holdOrientation)
        await new Promise<void>((resolve) => {
          releaseOrientation = resolve;
        });
      return {
        exitCode: 0,
        signal: null,
        stdout: Buffer.from(
          JSON.stringify({
            result: request.args?.includes("get") ? { deviceOrientation: "landscapeRight" } : {},
          }),
        ),
        stderr: Buffer.alloc(0),
        timedOut: false,
      };
    }) as HostCommands["run"];
    const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
    try {
      const first = motion.setOrientation("DEVICE", "landscapeRight");
      await Bun.sleep(0);
      transport.acknowledge(0);
      await first;
      const next = pendingAtStart ? motion.setOrientation("DEVICE", "landscapeRight") : null;
      const status = motion.status("DEVICE");
      await Bun.sleep(0);
      const latest = next ?? motion.setOrientation("DEVICE", "landscapeRight");
      await Bun.sleep(0);
      const commandIndex = transport.commands.findIndex(
        (command, index) => index > 0 && command.command === "orientation",
      );
      expect(commandIndex).toBeGreaterThan(0);
      transport.acknowledge(commandIndex);
      await latest;
      holdOrientation = false;
      releaseOrientation();
      expect((await status).commanded.orientation).toBe("landscapeRight");
      expect((await motion.status("DEVICE")).commanded.orientation).toBeNull();
    } finally {
      motion.dispose();
    }
  },
);

test("preserves old sensor samples and exposes their age without substituting commanded state", async () => {
  const transport = motionHost(60_000);
  transport.host.run = (async (_request: CommandRequest) => ({
    exitCode: 0,
    signal: null,
    stdout: Buffer.from('{"result":{}}'),
    stderr: Buffer.alloc(0),
    timedOut: false,
  })) as HostCommands["run"];
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  const angle = motion.setAngle("DEVICE", 180);
  await Bun.sleep(0);
  transport.acknowledge(0);
  await angle;
  const state = await motion.status("DEVICE");
  expect(state.commanded.hingeAngle).toBe(180);
  expect(state.observed.hingeAngle).toBe(77);
  expect(state.observed.hingeAngleAgeMs).toBe(60_000);
  motion.dispose();
});

test("coalesces slider bursts onto one persistent helper with at most one queued angle", async () => {
  const transport = motionHost();
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  const first = motion.setAngle("DEVICE", 10);
  await Bun.sleep(0);
  expect(transport.commands).toEqual([{ id: 1, command: "angle", angle: 10 }]);
  const middle = motion.setAngle("DEVICE", 20);
  const latest = motion.setAngle("DEVICE", 35.5);
  await Bun.sleep(0);
  expect(transport.commands).toHaveLength(1);
  transport.acknowledge(0);
  await Bun.sleep(0);
  expect(transport.commands).toEqual([
    { id: 1, command: "angle", angle: 10 },
    { id: 2, command: "angle", angle: 35.5 },
  ]);
  transport.acknowledge(1);
  await Promise.all([first, middle, latest]);
  expect(transport.calls).toHaveLength(1);
  expect(transport.calls[0]).toMatchObject({
    executable: "xcrun",
    args: ["simctl", "spawn", "DEVICE", "/fixtures/motion"],
    interactive: true,
  });
  motion.dispose();
});

test("dispatches the latest queued angle after an earlier native command rejection", async () => {
  const transport = motionHost();
  transport.host.run = (async (_request: CommandRequest) => ({
    exitCode: 0,
    signal: null,
    stdout: Buffer.from('{"result":{}}'),
    stderr: Buffer.alloc(0),
    timedOut: false,
  })) as HostCommands["run"];
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  const first = motion.setAngle("DEVICE", 10).catch((error) => error as Error);
  await Bun.sleep(0);
  const middle = motion.setAngle("DEVICE", 20);
  const latest = motion.setAngle("DEVICE", 90);
  transport.reject(0, "first write rejected");
  expect(await first).toMatchObject({ message: "first write rejected" });
  await Bun.sleep(0);
  expect(transport.commands).toEqual([
    { id: 1, command: "angle", angle: 10 },
    { id: 2, command: "angle", angle: 90 },
  ]);
  transport.acknowledge(1);
  await Promise.all([middle, latest]);
  const state = await motion.status("DEVICE");
  expect(state.commanded.hingeAngle).toBe(90);
  expect(state.observed.hingeAngle).toBe(77);
  motion.dispose();
});

test("disposes in-flight and queued writes without dispatching the queued angle", async () => {
  const transport = motionHost();
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  const first = motion.setAngle("DEVICE", 10).catch((error) => error as Error);
  await Bun.sleep(0);
  const queued = motion.setAngle("DEVICE", 90).catch((error) => error as Error);
  await Bun.sleep(0);
  motion.dispose();
  const results = await Promise.all([first, queued]);
  expect(results).toEqual([
    expect.objectContaining({ message: "device-motion disposed" }),
    expect.objectContaining({ message: "device-motion disposed" }),
  ]);
  expect(transport.commands).toEqual([{ id: 1, command: "angle", angle: 10 }]);
  expect(transport.calls).toHaveLength(1);
});

test("rejects invalid angles before launching host tooling", async () => {
  const transport = motionHost();
  const motion = createDeviceMotion(transport.host, { locateTool: () => "/fixtures/motion" });
  for (const angle of [-1, 181, NaN, Infinity]) {
    await expect(motion.setAngle("DEVICE", angle)).rejects.toThrow("between 0 and 180");
  }
  expect(transport.calls).toHaveLength(0);
  motion.dispose();
});
