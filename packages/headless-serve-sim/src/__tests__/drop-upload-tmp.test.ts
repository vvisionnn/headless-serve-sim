import { describe, expect, test } from "bun:test";
import type { ExecResult } from "../client/utils/exec";
import { uploadFileToTmp } from "../client/utils/drop";

function mockFile(bytes: Uint8Array): File {
  return {
    size: bytes.byteLength,
    name: "x.txt",
    type: "text/plain",
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

function recordingExec() {
  const calls: string[] = [];
  const exec = async (command: string): Promise<ExecResult> => {
    calls.push(command);
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  return { calls, exec };
}

describe("uploadFileToTmp", () => {
  test("creates a real (empty) temp file for a 0-byte upload", async () => {
    const { calls, exec } = recordingExec();
    const tmp = await uploadFileToTmp(mockFile(new Uint8Array(0)), "headless-serve-sim-doc", "txt", exec);
    expect(tmp).toMatch(/^\/tmp\/headless-serve-sim-doc-.*\.txt$/);
    // Exactly one call: the truncate-create. No base64 chunk writes.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`bash -c '> ${tmp}'`);
  });

  test("truncates up front, then appends chunks for non-empty content", async () => {
    const { calls, exec } = recordingExec();
    const tmp = await uploadFileToTmp(mockFile(new Uint8Array([1, 2, 3])), "p", "bin", exec);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(`bash -c '> ${tmp}'`);
    expect(calls[1]).toContain(`base64 -d >> ${tmp}`);
  });

  test("throws when the truncate-create fails", async () => {
    const exec = async (): Promise<ExecResult> => ({ stdout: "", stderr: "disk full", exitCode: 1 });
    await expect(
      uploadFileToTmp(mockFile(new Uint8Array(0)), "p", "txt", exec),
    ).rejects.toThrow("disk full");
  });
});
