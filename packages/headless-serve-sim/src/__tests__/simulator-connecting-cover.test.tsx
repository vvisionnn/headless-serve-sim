import { describe, expect, test } from "bun:test";
import { SimulatorView } from "headless-serve-sim-client/simulator";
import { renderToStaticMarkup } from "react-dom/server";

describe("simulator connecting cover", () => {
  test("renders exactly one connecting cover", async () => {
    const clientSource = await Bun.file(new URL("../client/client.tsx", import.meta.url)).text();
    const html = renderToStaticMarkup(<SimulatorView url="http://127.0.0.1:3100" />);

    expect(clientSource).not.toContain("<SimulatorConnectingCover");
    expect(html.match(/Connecting\.\.\./g)).toHaveLength(1);
  });
});
