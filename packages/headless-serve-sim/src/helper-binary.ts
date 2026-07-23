import { accessSync, constants } from "fs";
import { resolve } from "path";

type IsExecutable = (path: string) => boolean;

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveUnembeddedHelperBinary(
  runtimeDir: string,
  canExecute: IsExecutable = isExecutable,
): string | null {
  const candidates = [
    resolve(runtimeDir, "headless-serve-sim-bin"),
    resolve(runtimeDir, "../../headless-serve-sim-binary/bin/headless-serve-sim-bin"),
  ];
  return candidates.find(canExecute) ?? null;
}
