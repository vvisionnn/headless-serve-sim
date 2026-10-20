import { describe, expect, test } from "bun:test";
import { formatRecordTimer, recordTimerSecs } from "../client/utils/record-timer";

describe("recordTimerSecs", () => {
  test("counts while recording", () => {
    expect(recordTimerSecs(0, "recording", 1_000, 63_500)).toBe(62);
  });

  test("holds the last value from the stop until the capsule has closed", () => {
    const shown = recordTimerSecs(0, "recording", 1_000, 13_000);
    expect(recordTimerSecs(shown, "finishing", null, 20_000)).toBe(12);
    expect(recordTimerSecs(shown, "idle", null, 30_000)).toBe(12);
  });

  test("goes back to zero only when the next recording starts", () => {
    expect(recordTimerSecs(12, "preparing", null, 40_000)).toBe(0);
  });
});

test("formats as m:ss", () => {
  expect(formatRecordTimer(0)).toBe("0:00");
  expect(formatRecordTimer(62)).toBe("1:02");
});
