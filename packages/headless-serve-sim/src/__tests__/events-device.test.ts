import { describe, expect, test } from "bun:test";
import { resolveEventsDevice } from "../client/utils/events-device";

// `resolveEventsDevice` decides which udid the /api/events SSE pins to. The
// server falls back to "the first booted helper" for an unpinned subscription
// (selectServeSimState → states[0]); that fallback is what makes the page hop
// to a *different* simulator when the selected one shuts down. Pinning the
// committed device makes the server return null for a gone device instead of a
// different one, so we only ever reconnect to the same simulator.
describe("resolveEventsDevice", () => {
  test("an explicit URL device always wins, regardless of auto-connect", () => {
    expect(
      resolveEventsDevice({ autoConnect: true, urlDevice: "URL-UDID", initialDevice: "INIT" }),
    ).toBe("URL-UDID");
    expect(
      resolveEventsDevice({ autoConnect: false, urlDevice: "URL-UDID", initialDevice: "INIT" }),
    ).toBe("URL-UDID");
  });

  test("auto-connect ON with no URL device stays unpinned (legacy: may hop)", () => {
    expect(
      resolveEventsDevice({ autoConnect: true, urlDevice: null, initialDevice: "INIT" }),
    ).toBeNull();
  });

  test("auto-connect OFF pins the initially-committed device (no hop)", () => {
    expect(
      resolveEventsDevice({ autoConnect: false, urlDevice: null, initialDevice: "INIT" }),
    ).toBe("INIT");
  });

  test("auto-connect OFF with nothing committed yet stays unpinned", () => {
    expect(
      resolveEventsDevice({ autoConnect: false, urlDevice: null, initialDevice: null }),
    ).toBeNull();
  });

  test("blank / whitespace devices are treated as absent", () => {
    expect(
      resolveEventsDevice({ autoConnect: false, urlDevice: "   ", initialDevice: "INIT" }),
    ).toBe("INIT");
    expect(
      resolveEventsDevice({ autoConnect: false, urlDevice: "", initialDevice: "  " }),
    ).toBeNull();
  });
});
