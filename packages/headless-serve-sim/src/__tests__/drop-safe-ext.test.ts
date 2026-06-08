import { describe, expect, test } from "bun:test";
import { safeTmpExt } from "../client/utils/drop";

describe("safeTmpExt", () => {
  test("keeps a normal extension (lowercased)", () => {
    expect(safeTmpExt("pdf")).toBe("pdf");
    expect(safeTmpExt("PNG")).toBe("png");
    expect(safeTmpExt("epub")).toBe("epub");
  });

  test("strips shell metacharacters — the injection guard", () => {
    // A file named `evil.';touch pwned;'` yields this extension.
    expect(safeTmpExt("';touch pwned;'")).toBe("touchpwned");
    expect(safeTmpExt("$(touch pwn)")).toBe("touchpwn");
    expect(safeTmpExt("a b;c")).toBe("abc");
  });

  test("falls back to 'bin' when nothing safe remains", () => {
    expect(safeTmpExt("")).toBe("bin");
    expect(safeTmpExt("';'")).toBe("bin");
    expect(safeTmpExt("...")).toBe("bin");
  });

  test("caps length at 16", () => {
    expect(safeTmpExt("a".repeat(40))).toHaveLength(16);
  });
});
