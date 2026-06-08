import { describe, expect, test } from "bun:test";
import { parseStatusBarArgs } from "../status-bar";

describe("parseStatusBarArgs", () => {
  test("override with --time 9:41", () => {
    expect(parseStatusBarArgs(["override", "--time", "9:41"])).toEqual({
      verb: "override",
      device: undefined,
      quiet: false,
      time: "9:41",
    });
  });

  test("override with the full keynote set parses numbers as numbers", () => {
    expect(
      parseStatusBarArgs([
        "override",
        "--time", "9:41",
        "--battery-level", "100",
        "--battery-state", "charged",
        "--data-network", "5g",
        "--cellular-bars", "4",
      ]),
    ).toMatchObject({
      verb: "override",
      time: "9:41",
      batteryLevel: 100,
      batteryState: "charged",
      dataNetwork: "5g",
      cellularBars: 4,
    });
  });

  test("override --data-network=5g (=-form) is parsed", () => {
    expect(parseStatusBarArgs(["override", "--data-network=5g"])).toMatchObject({
      dataNetwork: "5g",
    });
  });

  test("override --wifi-bars boundaries 0 and 3 are accepted", () => {
    expect(parseStatusBarArgs(["override", "--wifi-bars", "3"])).toMatchObject({ wifiBars: 3 });
    expect(parseStatusBarArgs(["override", "--wifi-bars", "0"])).toMatchObject({ wifiBars: 0 });
  });

  test("override --cellular-bars boundaries 0 and 4 are accepted", () => {
    expect(parseStatusBarArgs(["override", "--cellular-bars", "0"])).toMatchObject({ cellularBars: 0 });
    expect(parseStatusBarArgs(["override", "--cellular-bars", "4"])).toMatchObject({ cellularBars: 4 });
  });

  test("override --battery-level boundaries 0 and 100 are accepted", () => {
    expect(parseStatusBarArgs(["override", "--battery-level", "0"])).toMatchObject({ batteryLevel: 0 });
    expect(parseStatusBarArgs(["override", "--battery-level", "100"])).toMatchObject({ batteryLevel: 100 });
  });

  test("override --operator-name keeps a value with a space", () => {
    expect(parseStatusBarArgs(["override", "--operator-name", "Test Net"])).toMatchObject({
      operatorName: "Test Net",
    });
  });

  test("clear parses with no fields", () => {
    expect(parseStatusBarArgs(["clear"])).toEqual({
      verb: "clear",
      device: undefined,
      quiet: false,
    });
  });

  test("clear with any override flag is an error", () => {
    expect(parseStatusBarArgs(["clear", "--time", "9:41"])).toEqual({
      error: expect.stringContaining("clear"),
    });
  });

  test("override --cellular-bars 9 is rejected with the 0-4 range", () => {
    const res = parseStatusBarArgs(["override", "--cellular-bars", "9"]);
    expect(res).toEqual({ error: expect.stringContaining("0-4") });
  });

  test("override --wifi-bars 4 is rejected with the 0-3 range", () => {
    expect(parseStatusBarArgs(["override", "--wifi-bars", "4"])).toEqual({
      error: expect.stringContaining("0-3"),
    });
  });

  test("override --battery-level 101 is rejected with the 0-100 range", () => {
    expect(parseStatusBarArgs(["override", "--battery-level", "101"])).toEqual({
      error: expect.stringContaining("0-100"),
    });
  });

  test("override --battery-level -5 is rejected (leading minus)", () => {
    expect(parseStatusBarArgs(["override", "--battery-level", "-5"])).toHaveProperty("error");
  });

  test("override --data-network 6g lists the allowed values", () => {
    expect(parseStatusBarArgs(["override", "--data-network", "6g"])).toEqual({
      error: expect.stringContaining("5g"),
    });
  });

  test("override --wifi-mode bogus lists the allowed values", () => {
    expect(parseStatusBarArgs(["override", "--wifi-mode", "bogus"])).toEqual({
      error: expect.stringContaining("active"),
    });
  });

  test("override --cellular-mode bogus lists the allowed values", () => {
    expect(parseStatusBarArgs(["override", "--cellular-mode", "bogus"])).toEqual({
      error: expect.stringContaining("notSupported"),
    });
  });

  test("override --battery-state full lists the allowed values", () => {
    expect(parseStatusBarArgs(["override", "--battery-state", "full"])).toEqual({
      error: expect.stringContaining("charging"),
    });
  });

  test("override --cellular-bars abc is rejected (non-numeric)", () => {
    expect(parseStatusBarArgs(["override", "--cellular-bars", "abc"])).toHaveProperty("error");
  });

  test("override with no flags is an error", () => {
    expect(parseStatusBarArgs(["override"])).toEqual({
      error: expect.stringContaining("at least one field"),
    });
  });

  test("missing subcommand is an error", () => {
    expect(parseStatusBarArgs([])).toEqual({
      error: expect.stringContaining("Missing subcommand"),
    });
  });

  test("unknown subcommand is an error", () => {
    expect(parseStatusBarArgs(["toggle"])).toEqual({
      error: expect.stringContaining("Unknown subcommand"),
    });
  });

  test("unknown flag is rejected", () => {
    expect(parseStatusBarArgs(["override", "--bogus"])).toEqual({
      error: expect.stringContaining("Unknown flag"),
    });
  });

  test("missing value for -d is an error", () => {
    expect(parseStatusBarArgs(["override", "--time", "9:41", "-d"])).toEqual({
      error: expect.stringContaining("Missing value for -d"),
    });
  });

  test("missing value for --battery-level is an error", () => {
    expect(parseStatusBarArgs(["override", "--battery-level"])).toEqual({
      error: expect.stringContaining("Missing value for --battery-level"),
    });
  });

  test("-d/--device is captured; -q/--quiet is captured and stripped from fields", () => {
    expect(
      parseStatusBarArgs(["override", "--time", "9:41", "-d", "iPhone 15"]),
    ).toMatchObject({ device: "iPhone 15", time: "9:41" });
    expect(parseStatusBarArgs(["override", "--time", "9:41", "-q"])).toMatchObject({
      quiet: true,
      time: "9:41",
    });
  });
});
