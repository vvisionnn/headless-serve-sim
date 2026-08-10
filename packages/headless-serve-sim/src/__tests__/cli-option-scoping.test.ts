import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SOURCE = readFileSync(resolve(__dirname, "../index.ts"), "utf8");

describe("CLI option scoping", () => {
  // The root command owns `-p, --port`, and so does `events`. Without
  // positional options, commander binds a post-subcommand `--port` to the root
  // and the subcommand silently falls back to its default — `events --port
  // 3399` read port 3200 and reported "no preview server".
  test("positional options are enabled so subcommand flags aren't shadowed", () => {
    expect(SOURCE).toContain(".enablePositionalOptions()");
  });

  test("the root and events commands both declare --port, which is why it matters", () => {
    const portOptions = [...SOURCE.matchAll(/\.option\(\s*"-p, --port <port>"/g)];
    expect(portOptions.length).toBeGreaterThanOrEqual(2);
  });
});
