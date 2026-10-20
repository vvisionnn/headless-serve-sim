import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { prefetchFrameSpec, useFrameSpecState } from "../client/hooks/use-frame-spec";

const spies: { mockRestore(): void }[] = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  delete (globalThis as { window?: unknown }).window;
});

function serve(deviceFrameSpec: Partial<DeviceFrameSpec> | null) {
  (globalThis as { window?: unknown }).window = {
    __SIM_PREVIEW__: { basePath: "/" },
    location: { pathname: "/" },
  };
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    (async () => new Response(JSON.stringify({ deviceFrameSpec }))) as unknown as typeof fetch,
  );
  spies.push(spy);
  return spy;
}

function Probe({ udid }: { udid: string }) {
  const { spec, loaded } = useFrameSpecState(udid);
  return <>{loaded ? (spec?.modelName ?? "none") : "loading"}</>;
}

test("a prefetched spec is there on a tile's first render", async () => {
  expect(renderToStaticMarkup(<Probe udid="SPEC-A" />)).toBe("loading");
  const spy = serve({ modelName: "iPhone Air" });
  await prefetchFrameSpec("SPEC-A");
  expect(renderToStaticMarkup(<Probe udid="SPEC-A" />)).toBe("iPhone Air");
  // Fetched once for the life of the page.
  await prefetchFrameSpec("SPEC-A");
  expect(spy).toHaveBeenCalledTimes(1);
});

test("a device with no profile is retried, not remembered", async () => {
  const spy = serve(null);
  expect(await prefetchFrameSpec("SPEC-NONE")).toBeNull();
  expect(renderToStaticMarkup(<Probe udid="SPEC-NONE" />)).toBe("loading");
  await prefetchFrameSpec("SPEC-NONE");
  expect(spy).toHaveBeenCalledTimes(2);
});
