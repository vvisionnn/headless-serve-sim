import type { HostCommands } from "./runtime/host-commands";
import type { createDeviceMotion, DeviceOrientation } from "./device-motion";
import { duoHardwareCommands } from "./client/utils/duo-hardware";

export async function routeNativeDeviceInput(
  host: HostCommands,
  device: string,
  input: { orientation?: string; button?: string },
  motion: Pick<ReturnType<typeof createDeviceMotion>, "setOrientation" | "sendConsumer">,
): Promise<boolean> {
  const result = await host.run({
    executable: "xcrun",
    args: ["simctl", "list", "devices", "-j"],
    timeoutMs: 3000,
  });
  if (result.exitCode !== 0) return false;
  const devices = JSON.parse(result.stdout.toString()) as {
    devices: Record<string, { udid: string; deviceTypeIdentifier?: string }[]>;
  };
  const selected = Object.values(devices.devices)
    .flat()
    .find((value) => value.udid === device);
  if (selected?.deviceTypeIdentifier !== "com.apple.CoreSimulator.SimDeviceType.iPhone-Duo")
    return false;
  if (input.orientation) {
    const orientation: Record<string, DeviceOrientation> = {
      portrait: "portrait",
      portrait_upside_down: "portraitUpsideDown",
      landscape_left: "landscapeRight",
      landscape_right: "landscapeLeft",
    };
    if (!orientation[input.orientation])
      throw new Error(`unknown orientation: ${input.orientation}`);
    await motion.setOrientation(device, orientation[input.orientation]!);
    return true;
  }
  const commands = duoHardwareCommands(input);
  if (!commands) return false;
  for (const [index, command] of commands.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 150));
    await motion.sendConsumer(device, command.usagePage, command.usage, command.phase);
  }
  return true;
}
