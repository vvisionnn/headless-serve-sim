import type { HostCommands } from "./runtime/host-commands";
import type { DeviceClipboard } from "./device-clipboard";
import {
  getSimulatorControlState,
  setSimulatorControlSetting,
  validateSimulatorControlDevice,
  type SimulatorControlOption,
} from "./simulator-controls";

export async function handleSimulatorControlRequest(
  commands: HostCommands,
  payload: unknown,
  clipboard?: DeviceClipboard,
) {
  const p = (payload ?? {}) as { device: string; option?: SimulatorControlOption; value?: unknown };
  validateSimulatorControlDevice(p.device);
  if (
    p.option === "clipboard-send" ||
    p.option === "clipboard-get" ||
    p.option === "shared-clipboard"
  ) {
    if (!clipboard) throw new Error("Clipboard controls are unavailable");
    if (p.option === "shared-clipboard") {
      if (typeof p.value !== "boolean") throw new Error("Clipboard sharing must be boolean");
      clipboard.setSharing(p.device, p.value);
    } else {
      await clipboard.transfer(p.device, p.option === "clipboard-send" ? "to" : "from");
    }
  } else if (p.option !== undefined) {
    await setSimulatorControlSetting(commands, p.device, p.option, p.value);
  }
  const state = await getSimulatorControlState(commands, p.device);
  if (clipboard) state.sharedClipboard = clipboard.sharing(p.device);
  return { state };
}
