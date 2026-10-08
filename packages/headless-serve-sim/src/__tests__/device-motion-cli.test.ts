import { expect, test } from "bun:test";
import { deviceMotionCli, parseDeviceMotionArgs } from "../device-motion-cli";

test("CLI writes an angle then returns actual state and disposes its helper", async () => {
  const calls: unknown[] = [];
  const output: string[] = [];
  const observed = {
    commanded: { hingeAngle: 90 },
    observed: { hingeAngle: null, orientation: "faceUp", displays: [] },
  };
  await deviceMotionCli(["angle", "90", "--json"], {
    resolveDevice: () => "DEVICE",
    motion: {
      async setAngle(device, angle) {
        calls.push([device, angle]);
      },
      async setOrientation() {},
      async sendConsumer() {},
      async sendKey() {},
      async sendTouch() {
        return true;
      },
      async status() {
        return observed as any;
      },
      dispose() {
        calls.push("disposed");
      },
    },
    output: (text) => output.push(text),
  });
  expect(calls).toEqual([["DEVICE", 90], "disposed"]);
  expect(JSON.parse(output[0]!)).toEqual(observed);
});

test("parses six physical orientations and rejects ambiguous commands", () => {
  for (const orientation of [
    "portrait",
    "portraitUpsideDown",
    "landscapeLeft",
    "landscapeRight",
    "faceUp",
    "faceDown",
  ] as const) {
    expect(parseDeviceMotionArgs(["orientation", orientation])).toEqual({
      command: "orientation",
      orientation,
      json: false,
    });
  }
  expect(parseDeviceMotionArgs([])).toEqual({ command: "status", json: false });
  for (const args of [
    ["angle", "90", "extra"],
    ["status", "extra"],
    ["unknown"],
    ["orientation", "sideways"],
    ["--wat"],
  ]) {
    expect(parseDeviceMotionArgs(args).error).toBeDefined();
  }
});

test("parses angle commands with strict finite bounds", () => {
  expect(parseDeviceMotionArgs(["angle", "74.5", "-d", "Duo", "--json"])).toEqual({
    command: "angle",
    angle: 74.5,
    device: "Duo",
    json: true,
  });
  for (const value of ["", "181", "-1", "NaN", "Infinity", "12deg"]) {
    expect(parseDeviceMotionArgs(["angle", value]).error).toContain("between 0 and 180");
  }
});
