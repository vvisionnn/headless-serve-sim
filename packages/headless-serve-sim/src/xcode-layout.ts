import { existsSync } from "fs";
import { resolve } from "path";

type PathExists = (path: string) => boolean;

/**
 * Xcode 27 moved SimulatorKit out of `Developer/Library/PrivateFrameworks` into
 * `Contents/SharedFrameworks`, and dropped `Simulator.app` in favour of
 * `DeviceHub.app` (which also moved up to `Contents/Applications`). Neither
 * layout can be assumed: release helper binaries bake an `@rpath` for whichever
 * Xcode the build machine had, so both candidates are offered at runtime.
 */
export function simulatorFrameworkDirs(developerDir: string): string[] {
  return [
    resolve(developerDir, "Library/PrivateFrameworks"),
    resolve(developerDir, "../SharedFrameworks"),
  ];
}

export function withSimulatorFrameworkPath(
  env: NodeJS.ProcessEnv,
  developerDir: string,
): NodeJS.ProcessEnv {
  const dirs = simulatorFrameworkDirs(developerDir);
  if (env.DYLD_FRAMEWORK_PATH) dirs.push(env.DYLD_FRAMEWORK_PATH);
  return { ...env, DYLD_FRAMEWORK_PATH: dirs.join(":") };
}

/** Path to the GUI simulator window app, or null when the toolchain has none. */
export function resolveSimulatorApp(
  developerDir: string,
  pathExists: PathExists = existsSync,
): string | null {
  const candidates = [
    resolve(developerDir, "Applications/Simulator.app"),
    resolve(developerDir, "../Applications/DeviceHub.app"),
  ];
  return candidates.find(pathExists) ?? null;
}
