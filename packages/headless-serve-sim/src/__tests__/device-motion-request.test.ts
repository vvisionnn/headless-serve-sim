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
