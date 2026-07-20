import { describe, expect, test } from "bun:test";
import { cameraShmNameForUdid, POSIX_SHM_NAME_MAX_LENGTH } from "../camera-shm-name";

describe("camera shared-memory name", () => {
  test("fits macOS's POSIX shared-memory name limit", () => {
    const name = cameraShmNameForUdid("C638CB35-DCD9-4625-8323-ED9495A5723E");

    expect(name).toStartWith("/serve-sim-camera-");
    expect(name.length).toBeLessThanOrEqual(POSIX_SHM_NAME_MAX_LENGTH);
  });

  test("is deterministic and device-specific", () => {
    const first = cameraShmNameForUdid("DEVICE-A");

    expect(cameraShmNameForUdid("DEVICE-A")).toBe(first);
    expect(cameraShmNameForUdid("DEVICE-B")).not.toBe(first);
  });
});
