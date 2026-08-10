import { describe, expect, test } from "bun:test";
import { parseGridPaging } from "../middleware";

describe("parseGridPaging", () => {
  test("no query means no paging at all", () => {
    // Back-compat: an embedded mount with no paging params must keep getting
    // the whole device list in one response.
    expect(parseGridPaging("/grid/api")).toEqual({ limit: null, offset: 0 });
  });

  test("a query without limit still means no paging", () => {
    expect(parseGridPaging("/grid/api?device=ABC")).toEqual({ limit: null, offset: 0 });
  });

  test("reads limit and offset", () => {
    expect(parseGridPaging("/grid/api?limit=24&offset=48")).toEqual({ limit: 24, offset: 48 });
  });

  test("offset defaults to zero when only a limit is given", () => {
    expect(parseGridPaging("/grid/api?limit=10")).toEqual({ limit: 10, offset: 0 });
  });

  test("caps limit so one request can't ask the server to annotate everything", () => {
    expect(parseGridPaging("/grid/api?limit=999999").limit).toBe(1000);
  });

  test("raises a zero or negative limit to one rather than returning nothing", () => {
    expect(parseGridPaging("/grid/api?limit=0").limit).toBe(1);
    // "-5" isn't all digits, so it's treated as absent — unpaged, not empty.
    expect(parseGridPaging("/grid/api?limit=-5").limit).toBeNull();
  });

  test("ignores non-numeric input instead of erroring", () => {
    // A malformed page request should still render devices.
    expect(parseGridPaging("/grid/api?limit=abc&offset=xyz")).toEqual({ limit: null, offset: 0 });
  });

  test("ignores a negative offset", () => {
    expect(parseGridPaging("/grid/api?limit=10&offset=-3").offset).toBe(0);
  });

  test("handles a float limit as non-numeric", () => {
    expect(parseGridPaging("/grid/api?limit=1.5").limit).toBeNull();
  });
});
