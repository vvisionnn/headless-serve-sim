import { existsSync } from "fs";
import { resolve } from "path";

type PathExists = (path: string) => boolean;

export function resolveNativeSourceRoot(
  runtimeDir: string,
  pathExists: PathExists = existsSync,
): string | null {
  const candidates = [
    resolve(runtimeDir, "../../headless-serve-sim-binary/Sources"),
    resolve(runtimeDir, "../dist/native-sources"),
  ];
  return candidates.find(pathExists) ?? null;
}
