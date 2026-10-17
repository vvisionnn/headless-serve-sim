import { describe, expect, test } from "bun:test";

describe("selected simulator connection safety", () => {
  test("the passive client connection lifecycle cannot start a simulator", async () => {
    const source = await Bun.file(new URL("../client/client.tsx", import.meta.url)).text();

    expect(source).not.toContain("requestSelectedSimulatorConnection");
    expect(source).not.toContain('simEndpoint("grid/api/start")');
  });

  test("device start UI reuses the installed CLI instead of a registry package", async () => {
    const client = await Bun.file(new URL("../client/client.tsx", import.meta.url)).text();

    expect(client).not.toContain("bunx headless-serve-sim");
    expect(client).toContain("config.gridStartEndpoint");
    const emptyScene = await Bun.file(
      new URL("../client/scenes/empty-scene.tsx", import.meta.url),
    ).text();

    expect(emptyScene).not.toContain("bunx headless-serve-sim");
  });
});
