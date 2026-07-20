import { createHash } from "node:crypto";

// Darwin rejects POSIX shared-memory names longer than 31 characters,
// including the leading slash.
export const POSIX_SHM_NAME_MAX_LENGTH = 31;
const CAMERA_SHM_PREFIX = "/serve-sim-camera-";
const CAMERA_SHM_HASH_LENGTH = 12;

export function cameraShmNameForUdid(udid: string): string {
  return `${CAMERA_SHM_PREFIX}${createHash("sha1").update(udid).digest("hex").slice(0, CAMERA_SHM_HASH_LENGTH)}`;
}
