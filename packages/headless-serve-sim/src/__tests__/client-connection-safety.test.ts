import { describe, expect, test } from "bun:test";

describe("selected simulator connection safety", () => {
  test("the passive client connection lifecycle cannot start a simulator", async () => {
    const source = await Bun.file(new URL("../client/client.tsx", import.meta.url)).text();

    expect(source).not.toContain("requestSelectedSimulatorConnection");
    expect(source).not.toContain('simEndpoint("grid/api/start")');
  });
});
