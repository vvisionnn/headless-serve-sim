import { expect, test } from "bun:test";

const source = () => Bun.file(new URL("../client/client.tsx", import.meta.url)).text();

test("Duo gestures use the same input history reporters as ordinary simulators", async () => {
  const client = await source();
  expect(client).toContain("onTouch={onStreamTouch}");
  expect(client).toContain("onMultiTouch={onStreamMultiTouch}");
});

test("native composition is selected by helper capability, not device identity alone", async () => {
  const client = await source();
  expect(client).toContain("activeStreamConfig.deviceComposition === true");
  expect(client).toContain("{nativeComposition ? (");
});

test("Duo scale changes remain local and control reconnect replays pending view changes", async () => {
  const client = await source();
  const viewEffect = client.slice(
    client.indexOf("if (!nativeComposition)"),
    client.indexOf("const currentOrientation"),
  );
  expect(viewEffect.includes("deviceScale")).toBe(false);
  expect(client).toContain("sendDeviceView(ws, deviceViewRef.current)");
});

test("Duo uses stream error feedback rather than hiding all connection status", async () => {
  const client = await source();
  expect(client).toContain("onStreamError={setStreamError}");
  expect(client).toContain('streamError ?? "Connecting..."');
});

test("screen clicks remove stale control focus without blurring controls being pressed", async () => {
  const client = await source();
  expect(client).toContain("!isPreviewControlTarget(e.target)");
  expect(client).toContain("document.activeElement as HTMLElement");
  expect(client).toContain(".blur()");
});

test("page startup does not command portrait before reading the actual Duo orientation", async () => {
  const client = await source();
  expect(client.includes("useState<SimulatorOrientation | null>(null)")).toBe(true);
  expect(client.includes("if (!duoOrientation) return;")).toBe(true);
});

test("browser typing and Cmd+K use the persistent native keyboard route", async () => {
  const client = await source();
  expect(client.includes('command: "key"')).toBe(true);
  expect(client.includes('command: "software-keyboard"')).toBe(true);
  expect(client.includes("sendWs(0x06, { type, usage })")).toBe(false);
});

test("ordinary bezel changes keep one stream ancestor mounted", async () => {
  const client = await source();
  expect(client).toContain("showFrame={showBezels}");
  expect(client).not.toContain("{showBezels && bezelGeom && bezelSpec ? (");
});
