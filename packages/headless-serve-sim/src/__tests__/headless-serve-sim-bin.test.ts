import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { existsSync, readFileSync, statSync } from "fs";

const BIN_PATH = resolve(
  __dirname,
  "../../../headless-serve-sim-binary/bin/headless-serve-sim-bin",
);

const isDarwin = process.platform === "darwin";
const describeIfDarwin = isDarwin ? describe : describe.skip;

const MH_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE_ARM64 = 0x0100000c;
const LC_LOAD_DYLIB = 0x0c;
const LC_LOAD_WEAK_DYLIB = 0x80000018;

function thinArchitecture(path: string): { magic: number; cpuType: number } {
  const bytes = readFileSync(path);
  return { magic: bytes.readUInt32LE(0), cpuType: bytes.readUInt32LE(4) };
}

/** Install names of every dylib/framework the binary links at load time. */
function linkedDylibs(path: string): string[] {
  const bytes = readFileSync(path);
  const commandCount = bytes.readUInt32LE(16);
  const names: string[] = [];
  let offset = 32; // sizeof(mach_header_64)
  for (let index = 0; index < commandCount; index++) {
    const command = bytes.readUInt32LE(offset);
    const size = bytes.readUInt32LE(offset + 4);
    if (command === LC_LOAD_DYLIB || command === LC_LOAD_WEAK_DYLIB) {
      const nameOffset = bytes.readUInt32LE(offset + 8);
      const raw = bytes.subarray(offset + nameOffset, offset + size);
      const end = raw.indexOf(0);
      names.push(raw.subarray(0, end === -1 ? raw.length : end).toString());
    }
    offset += size;
  }
  return names;
}

describeIfDarwin("headless-serve-sim-bin binary", () => {
  test("exists on disk", () => {
    expect(existsSync(BIN_PATH)).toBe(true);
  });

  // arm64 only: Xcode 26+ requires Apple Silicon, and Xcode 27 ships SimulatorKit
  // and CoreSimulator as arm64e-only, so an x86_64 slice links neither framework.
  test("is a thin arm64 Mach-O binary", () => {
    expect(thinArchitecture(BIN_PATH)).toEqual({
      magic: MH_MAGIC_64,
      cpuType: CPU_TYPE_ARM64,
    });
  });

  // The simulator frameworks are dlopen'd at runtime by SimFrameworks, never
  // linked. Linking them bakes an `@rpath/SimulatorKit.framework` load command
  // pointing at the build machine's Xcode, and that path moved in Xcode 27
  // (Developer/Library/PrivateFrameworks → Contents/SharedFrameworks), so a
  // release binary would die at launch with "Library not loaded".
  test("links no simulator framework at load time", () => {
    const simulatorFrameworks = linkedDylibs(BIN_PATH).filter((name) =>
      /SimulatorKit|CoreSimulator/.test(name),
    );
    expect(simulatorFrameworks).toEqual([]);
  });

  test("is executable (has user execute bit)", () => {
    const stats = statSync(BIN_PATH);
    // 0o111 is any execute bit; on our shipped bins we set 0o755
    expect(stats.mode & 0o111).not.toBe(0);
  });
});
