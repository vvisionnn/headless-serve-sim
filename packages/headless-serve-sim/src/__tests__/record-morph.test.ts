import { describe, expect, test } from "bun:test";
import { recordMorphed } from "../client/utils/record-morph";

describe("recordMorphed", () => {
  test("the capsule opens the moment a start is asked for, and stays through finishing", () => {
    expect(recordMorphed("preparing")).toBe(true);
    expect(recordMorphed("recording")).toBe(true);
    expect(recordMorphed("finishing")).toBe(true);
  });

  test("idle (including a failed start falling back) is the round button", () => {
    expect(recordMorphed("idle")).toBe(false);
  });
});
