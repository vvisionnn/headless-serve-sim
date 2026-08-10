import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// __tests__ → src → headless-serve-sim → packages → repo root
const REPO_ROOT = resolve(__dirname, "../../../..");
const MARKETPLACE = resolve(REPO_ROOT, ".claude-plugin/marketplace.json");
const PLUGIN = resolve(REPO_ROOT, ".claude-plugin/plugin.json");
const PACKAGE = resolve(REPO_ROOT, "packages/headless-serve-sim/package.json");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("claude plugin manifest", () => {
  test("both manifests exist", () => {
    // `/plugin marketplace add vvisionnn/headless-serve-sim` fails outright if
    // either file is missing, so their presence is the feature.
    expect(existsSync(MARKETPLACE)).toBe(true);
    expect(existsSync(PLUGIN)).toBe(true);
  });

  test("the marketplace lists the plugin by its manifest name", () => {
    const marketplace = readJson(MARKETPLACE);
    const plugin = readJson(PLUGIN);
    const listed = marketplace.plugins as Array<Record<string, unknown>>;
    expect(listed.length).toBeGreaterThan(0);
    // A name mismatch installs nothing while still validating, so pin it.
    expect(listed.map((entry) => entry.name)).toContain(plugin.name);
  });

  test("the plugin source resolves to a directory holding the skill", () => {
    const listed = (readJson(MARKETPLACE).plugins as Array<Record<string, unknown>>)[0]!;
    const source = resolve(REPO_ROOT, listed.source as string);
    expect(existsSync(resolve(source, "skills/headless-serve-sim/SKILL.md"))).toBe(true);
  });

  test("the plugin version tracks the package version", () => {
    expect(readJson(PLUGIN).version).toBe(readJson(PACKAGE).version);
  });

  test("the plugin points at this fork, not upstream", () => {
    const plugin = readJson(PLUGIN);
    for (const field of ["homepage", "repository"] as const) {
      expect(plugin[field]).toContain("vvisionnn/headless-serve-sim");
    }
  });
});
