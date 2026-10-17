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
  expect(client).toContain("const device = nativeComposition ? (");
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
  expect(client).toContain("{streamError && <ScreenStatus");
  // The same overlays sit over the Duo's composited screen, not only the bezel.
  expect(client).toContain("{screenOverlays}");
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

test("a new preview releases native modifier state left by an unloaded page", async () => {
  const client = await source();
  expect(client).toContain('for (let usage = 0xe0; usage <= 0xe7; usage++) sendKey("up", usage)');
});

test("window and tab focus loss release guest keys even with keyboard capture enabled", async () => {
  const client = await source();
  expect(client.includes('window.addEventListener("blur", release)')).toBe(true);
  expect(client.includes('window.addEventListener("pagehide", release)')).toBe(true);
  expect(client.includes('document.addEventListener("visibilitychange", visibility)')).toBe(true);
});

test("Command arrow keys reach guest text editing instead of rotating the device", async () => {
  const client = await source();
  const keyboard = client.slice(
    client.indexOf("const onKey ="),
    client.indexOf("const switchToDevice"),
  );
  expect(keyboard.includes("rotateBy")).toBe(false);
  expect(keyboard.includes("sendKey(type, usage)")).toBe(true);
});

test("guest keyboard synchronizes browser shortcut flags before forwarding keys", async () => {
  const client = await source();
  const keyboard = client.slice(
    client.indexOf("const onKey ="),
    client.indexOf("const switchToDevice"),
  );
  expect(keyboard.includes("syncKeyboardModifiers(e, pressedKeysRef.current, sendKey)")).toBe(true);
  expect(keyboard.indexOf("syncKeyboardModifiers")).toBeLessThan(
    keyboard.indexOf("sendKey(type, usage)"),
  );
});

test("clipboard shortcuts transfer between Mac and guest without Inspector sharing", async () => {
  const client = await source();
  expect(client.includes("clipboardShortcut(e)")).toBe(true);
  expect(client.includes('command: "clipboard"')).toBe(true);
  expect(client.includes("clipboardAction: action")).toBe(true);
});

test("tablet screen clicks preserve legacy input when guest virtual touchscreen is inactive", async () => {
  const client = await source();
  const touch = client.slice(
    client.indexOf("const onStreamTouch"),
    client.indexOf("const onStreamMultiTouch"),
  );
  expect(touch).toContain('deviceType === "ipad"');
  expect(touch).toContain("queueKeyboard");
  expect(touch).toContain("await hostDeviceTouchRequest(");
  expect(touch).toContain("phase: data.type");
  expect(touch).toContain("if (!handled) sendWs(0x03, data)");
});

test("ordinary bezel changes keep one stream ancestor mounted", async () => {
  const client = await source();
  expect(client).toContain("showFrame={showBezels}");
  expect(client).not.toContain("{showBezels && bezelGeom && bezelSpec ? (");
});
