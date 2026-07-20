import { describe, expect, test } from "bun:test";
import { resolveEventsDevice } from "../client/utils/events-device";

// `resolveEventsDevice` decides which user-selected udid the /api/events SSE
// pins to. With no explicit or committed selection it returns null.
describe("resolveEventsDevice", () => {
  test("an explicit URL device always wins", () => {
    expect(
      resolveEventsDevice({ urlDevice: "URL-UDID", initialDevice: "INIT" }),
    ).toBe("URL-UDID");
  });

  test("a committed selection stays pinned when there is no URL device", () => {
    expect(
      resolveEventsDevice({ urlDevice: null, initialDevice: "INIT" }),
    ).toBe("INIT");
  });

  test("nothing committed means no selection", () => {
    expect(
      resolveEventsDevice({ urlDevice: null, initialDevice: null }),
    ).toBeNull();
  });

  test("blank / whitespace devices are treated as absent", () => {
    expect(
      resolveEventsDevice({ urlDevice: "   ", initialDevice: "INIT" }),
    ).toBe("INIT");
    expect(
      resolveEventsDevice({ urlDevice: "", initialDevice: "  " }),
    ).toBeNull();
  });
});
