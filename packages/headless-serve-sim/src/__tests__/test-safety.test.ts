import { describe, expect, test } from "bun:test";
import { findUnsafeTests, unsafeTestReason } from "../../../../scripts/check-test-safety";

describe("hermetic test safety", () => {
  test("rejects direct simulator commands", () => {
    const nodeCall = ["execFileSync", `("xcrun", ["simctl", "list"]);`].join("");
    const bunCall = ["Bun.spawn", `(["simctl", "boot", udid]);`].join("");
    expect(unsafeTestReason(nodeCall)).toContain("directly");
    expect(unsafeTestReason(bunCall)).toContain("directly");
  });

  test("rejects ambient simulator selection", () => {
    const discovery = ["const udid = first", "BootedIosSim();"].join("");
    const legacyEnvironment = ["process.env.HEADLESS_SERVE_SIM_", "E2E_UDID"].join("");
    expect(unsafeTestReason(discovery)).toContain("ambient");
    expect(unsafeTestReason(legacyEnvironment)).toContain("ambient");
  });

  test("allows fake executable fixtures that are never invoked directly", () => {
    expect(unsafeTestReason(`writeFileSync(fake, "#!/bin/sh\\n# fake xcrun");`)).toBeNull();
  });

  test("the ordinary test suite has no unsafe files", () => {
    expect(findUnsafeTests(process.cwd())).toEqual([]);
  });
});
