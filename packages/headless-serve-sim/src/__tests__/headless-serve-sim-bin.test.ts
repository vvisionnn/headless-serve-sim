import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { existsSync, readFileSync, statSync } from "fs";

const BIN_PATH = resolve(__dirname, "../../bin/headless-serve-sim-bin");

const isDarwin = process.platform === "darwin";
const describeIfDarwin = isDarwin ? describe : describe.skip;

const FAT_MAGIC = 0xcafebabe;
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;

function fatArchitectures(path: string): number[] {
  const bytes = readFileSync(path);
  expect(bytes.readUInt32BE(0)).toBe(FAT_MAGIC);
  const count = bytes.readUInt32BE(4);
  const architectures: number[] = [];
  for (let index = 0; index < count; index++) {
    architectures.push(bytes.readUInt32BE(8 + index * 20));
  }
  return architectures;
}

describeIfDarwin("headless-serve-sim-bin binary", () => {
  test("exists on disk", () => {
    expect(existsSync(BIN_PATH)).toBe(true);
  });

  test("is a universal Mach-O binary (arm64 + x86_64)", () => {
    expect(fatArchitectures(BIN_PATH).sort()).toEqual([CPU_TYPE_X86_64, CPU_TYPE_ARM64].sort());
  });

  test("is executable (has user execute bit)", () => {
    const stats = statSync(BIN_PATH);
    // 0o111 is any execute bit; on our shipped bins we set 0o755
    expect(stats.mode & 0o111).not.toBe(0);
  });
});
