import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INDEX = join(import.meta.dir, "..", "index.ts");
const RUNTIME = join(import.meta.dir, "..", "runtime.ts");
const MIDDLEWARE = join(import.meta.dir, "..", "middleware.ts");

test.each(["SIGINT", "SIGTERM", "exit"] as const)(
  "standalone preview stops its owned server exactly once on %s",
  async (shutdown) => {
    const dir = mkdtempSync(join(tmpdir(), "preview-shutdown-"));
    const marker = join(dir, "stopped");
    writeFileSync(marker, "");
    const preload = join(dir, "preload.ts");
    writeFileSync(
      preload,
      `import { mock } from "bun:test";
import { appendFileSync } from "node:fs";
import * as runtime from ${JSON.stringify(RUNTIME)};
mock.module(${JSON.stringify(MIDDLEWARE)}, () => ({ simMiddleware: () => () => {} }));
mock.module(${JSON.stringify(RUNTIME)}, () => ({
  ...runtime,
  servePreview: async () => {
    const keepAlive = setInterval(() => {}, 1000);
    ${shutdown === "exit" ? "setTimeout(() => process.exit(7), 200);" : ""}
    return { stop: () => {
      appendFileSync(${JSON.stringify(marker)}, "stop\\n");
      clearInterval(keepAlive);
    } };
  },
}));
`,
    );
    const child = spawn(
      process.execPath,
      ["--preload", preload, INDEX, "--port", "0", "--host", "127.0.0.1"],
      {
        env: { ...process.env, HEADLESS_SERVE_SIM_HOST_COMMANDS: "deny", TMPDIR: dir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let signalled = false;
    child.stdout!.on("data", (chunk) => {
      output += String(chunk);
      if (shutdown !== "exit" && !signalled && output.includes("- Local:")) {
        signalled = true;
        child.kill(shutdown);
      }
    });
    child.stderr!.on("data", (chunk) => {
      output += String(chunk);
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`preview did not exit:\n${output}`)), 5000);
        child.once("error", reject);
        child.once("close", resolve);
      });
      expect(code, output).toBe(shutdown === "exit" ? 7 : 0);
      expect(readFileSync(marker, "utf8")).toBe("stop\n");
    } finally {
      clearTimeout(timeout);
      child.kill("SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  },
  10_000,
);
