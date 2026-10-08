import { describe, expect, test } from "bun:test";
import { handleDeviceMotionRequest } from "../device-motion-request";

const state = { commanded: { hingeAngle: 90 }, observed: { hingeAngle: 90, displays: [] } };

test("routes hinge updates without a shell or extra device lookup", async () => {
  const calls: Array<[string, number]> = [];
  const motion = {
    status: async () => {
      throw new Error("unexpected state query during slider write");
    },
    setAngle: async (udid: string, angle: number) => {
      calls.push([udid, angle]);
    },
  };
  await expect(
    handleDeviceMotionRequest(motion, {
      device: "1F725059-290B-4622-AC77-698FC660DA11",
      command: "angle",
      angle: 90,
    }),
  ).resolves.toEqual({ ok: true });
  expect(calls).toEqual([["1F725059-290B-4622-AC77-698FC660DA11", 90]]);
});

test("routes physical rotation through the native motion session", async () => {
  const calls: Array<[string, string]> = [];
  const motion = {
    setAngle: async () => {},
    status: async () => state,
    setOrientation: async (device: string, orientation: string) => {
      calls.push([device, orientation]);
    },
  };
  await expect(
    handleDeviceMotionRequest(motion, {
      device: "DEVICE",
      command: "orientation",
      orientation: "landscapeRight",
    }),
  ).resolves.toEqual({ ok: true });
  expect(calls).toEqual([["DEVICE", "landscapeRight"]]);
});

test("routes tablet touch coordinates through the native session", async () => {
  const calls: unknown[] = [];
  const motion = {
    setAngle: async () => {},
    status: async () => state,
    sendTouch: async (...args: unknown[]) => {
      calls.push(args);
    },
  };
  for (const phase of ["begin", "move", "end"]) {
    await expect(
      handleDeviceMotionRequest(motion, {
        device: "DEVICE",
        command: "touch",
        x: 0.493,
        y: 0.256,
        phase,
      }),
    ).resolves.toEqual({ ok: true });
  }
  expect(calls).toEqual(["begin", "move", "end"].map((phase) => ["DEVICE", 0.493, 0.256, phase]));
  for (const change of [{ x: true }, { x: -0.1 }, { y: 1.1 }, { y: NaN }, { phase: "press" }]) {
    await expect(
      handleDeviceMotionRequest(motion, {
        device: "DEVICE",
        command: "touch",
        x: 0.5,
        y: 0.5,
        phase: "begin",
        ...change,
      }),
    ).rejects.toThrow("Invalid touchscreen HID event");
  }
  expect(calls).toHaveLength(3);
});

test("touch reply preserves inactive guest routing for browser fallback", async () => {
  const motion = {
    setAngle: async () => {},
    status: async () => state,
    sendTouch: async () => false,
  };
  await expect(
    handleDeviceMotionRequest(motion, {
      device: "DEVICE",
      command: "touch",
      x: 0.493,
      y: 0.256,
      phase: "begin",
    }),
  ).resolves.toEqual({ ok: true, touchHandled: false });
});

test("routes native typing and software keyboard toggle without a state query", async () => {
  const calls: unknown[] = [];
  const motion = {
    setAngle: async () => {},
    status: async () => {
      throw new Error("unexpected readback");
    },
    sendKey: async (...args: unknown[]) => {
      calls.push(args);
    },
    sendConsumer: async (...args: unknown[]) => {
      calls.push(args);
    },
  };
  await expect(
    handleDeviceMotionRequest(motion, {
      device: "DEVICE",
      command: "key",
      usage: 4,
      phase: "down",
    }),
  ).resolves.toEqual({ ok: true });
  await expect(
    handleDeviceMotionRequest(motion, { device: "DEVICE", command: "software-keyboard" }),
  ).resolves.toEqual({ ok: true });
  expect(calls).toEqual([
    ["DEVICE", 4, "down"],
    ["DEVICE", 12, 0xb8, "press"],
  ]);
  for (const usage of [-1, 256, true, 0.5])
    await expect(
      handleDeviceMotionRequest(motion, { device: "DEVICE", command: "key", usage, phase: "down" }),
    ).rejects.toThrow("Invalid keyboard HID event");
  expect(calls).toHaveLength(2);
});

test("clipboard shortcuts run ordered key presses through the native clipboard transfer", async () => {
  const calls: unknown[] = [];
  const motion = {
    setAngle: async () => {},
    status: async () => {
      throw new Error("unexpected readback");
    },
    sendKey: async (device: string, usage: number, phase: string) => {
      calls.push([device, usage, phase]);
    },
  };
  const clipboard = {
    shortcut: async (device: string, action: string, press: () => Promise<void>) => {
      calls.push([device, action]);
      await press();
    },
  };
  await expect(
    handleDeviceMotionRequest(
      motion,
      { device: "DEVICE", command: "clipboard", clipboardAction: "paste" },
      clipboard,
    ),
  ).resolves.toEqual({ ok: true });
  expect(calls).toEqual([
    ["DEVICE", "paste"],
    ["DEVICE", 0xe3, "down"],
    ["DEVICE", 0x19, "down"],
    ["DEVICE", 0x19, "up"],
    ["DEVICE", 0xe3, "up"],
  ]);
  await expect(
    handleDeviceMotionRequest(
      motion,
      { device: "DEVICE", command: "clipboard", clipboardAction: "share" },
      clipboard,
    ),
  ).rejects.toThrow("Invalid clipboard shortcut");
  expect(calls).toHaveLength(5);
});

test("routes consumer button phases through the native motion session", async () => {
  const calls: Array<[string, number, number, string]> = [];
  const motion = {
    setAngle: async () => {},
    status: async () => state,
    sendConsumer: async (device: string, usagePage: number, usage: number, phase: string) => {
      calls.push([device, usagePage, usage, phase]);
    },
  };
  for (const phase of ["down", "up", "press"] as const) {
    await expect(
      handleDeviceMotionRequest(motion, {
        device: "DEVICE",
        command: "consumer",
        usagePage: 12,
        usage: 0x30,
        phase,
      }),
    ).resolves.toEqual({ ok: true });
  }
  expect(calls).toEqual([
    ["DEVICE", 12, 0x30, "down"],
    ["DEVICE", 12, 0x30, "up"],
    ["DEVICE", 12, 0x30, "press"],
  ]);
});

test("rejects malformed consumer events before native device access", async () => {
  let calls = 0;
  const motion = {
    setAngle: async () => {},
    status: async () => state,
    sendConsumer: async () => {
      calls++;
    },
  };
  const valid = {
    device: "DEVICE",
    command: "consumer",
    usagePage: 12,
    usage: 0x30,
    phase: "press",
  };
  for (const value of [
    { usagePage: 7 },
    { usagePage: NaN },
    { usagePage: "12" },
    { usage: -1 },
    { usage: 65536 },
    { usage: 1.5 },
    { usage: Infinity },
    { usage: "48" },
    { phase: "hold" },
    { phase: null },
    { phase: undefined },
  ]) {
    await expect(handleDeviceMotionRequest(motion, { ...valid, ...value })).rejects.toThrow(
      "Invalid consumer HID event",
    );
  }
  expect(calls).toBe(0);
});

test("reads observed device motion without issuing an angle command", async () => {
  const motion = {
    setAngle: async () => {
      throw new Error("unexpected set");
    },
    status: async () => state,
  };
  await expect(
    handleDeviceMotionRequest(motion, {
      device: "1F725059-290B-4622-AC77-698FC660DA11",
      command: "state",
    }),
  ).resolves.toEqual({ motion: state });
});

test("rejects unknown motion commands before any angle update", async () => {
  const motion = { setAngle: async () => {}, status: async () => state };
  await expect(
    handleDeviceMotionRequest(motion, { device: "DEVICE", command: "bogus", angle: 90 }),
  ).rejects.toThrow("Unknown device motion command");
});

test.each(["bad/device", "-", "--help", "-DEVICE", "", null])(
  "rejects invalid device identity %s before any device access",
  async (device) => {
    let calls = 0;
    const motion = {
      setAngle: async () => {
        calls++;
      },
      status: async () => {
        calls++;
        return state;
      },
      setOrientation: async () => {
        calls++;
      },
      sendConsumer: async () => {
        calls++;
      },
    };
    await expect(handleDeviceMotionRequest(motion, { device, command: "state" })).rejects.toThrow(
      "missing or invalid device udid",
    );
    expect(calls).toBe(0);
  },
);

describe("motion request validation", () => {
  test.each([NaN, Infinity, -1, 181, "90", null])(
    "rejects invalid hinge angle %s before device access",
    async (angle) => {
      let calls = 0;
      const motion = {
        setAngle: async () => {
          calls++;
        },
        status: async () => state,
      };
      await expect(
        handleDeviceMotionRequest(motion, {
          device: "1F725059-290B-4622-AC77-698FC660DA11",
          command: "angle",
          angle,
        }),
      ).rejects.toThrow("Hinge angle must be between 0 and 180 degrees");
      expect(calls).toBe(0);
    },
  );
});
