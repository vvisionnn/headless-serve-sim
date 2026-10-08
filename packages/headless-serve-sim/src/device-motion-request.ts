import {
  DEVICE_ORIENTATIONS,
  isConsumerHIDEvent,
  isKeyboardHIDEvent,
  isTouchHIDEvent,
  type ConsumerHIDPhase,
  type DeviceOrientation,
} from "./device-motion";
import { validateSimulatorControlDevice } from "./simulator-controls";
import type { DeviceClipboard } from "./device-clipboard";

interface DeviceMotionCommands {
  setOrientation?(device: string, orientation: DeviceOrientation): Promise<void>;
  sendKey?(device: string, usage: number, phase: "down" | "up"): Promise<void>;
  sendTouch?(
    device: string,
    x: number,
    y: number,
    phase: "begin" | "move" | "end",
  ): Promise<boolean | void>;
  setAngle(device: string, angle: number): Promise<void>;
  sendConsumer?(
    device: string,
    usagePage: number,
    usage: number,
    phase: ConsumerHIDPhase,
  ): Promise<void>;
  status(device: string): Promise<unknown>;
}

export async function handleDeviceMotionRequest(
  motion: DeviceMotionCommands,
  payload: unknown,
  clipboard?: Pick<DeviceClipboard, "shortcut">,
): Promise<Record<string, unknown>> {
  const p = (payload ?? {}) as {
    device: string;
    command?: string;
    angle: number;
    orientation?: string;
    usagePage?: number;
    usage?: number;
    phase?: string;
    clipboardAction?: string;
    x?: number;
    y?: number;
  };
  validateSimulatorControlDevice(p.device);
  if (p.command === "state") return { motion: await motion.status(p.device) };
  if (p.command === "clipboard") {
    if (
      p.clipboardAction !== "copy" &&
      p.clipboardAction !== "cut" &&
      p.clipboardAction !== "paste"
    )
      throw new Error("Invalid clipboard shortcut");
    if (!clipboard || !motion.sendKey)
      throw new Error("Native clipboard shortcuts are unavailable");
    const usage = { copy: 0x06, cut: 0x1b, paste: 0x19 }[p.clipboardAction];
    await clipboard.shortcut(p.device, p.clipboardAction, async () => {
      await motion.sendKey!(p.device, 0xe3, "down");
      try {
        await motion.sendKey!(p.device, usage, "down");
        await motion.sendKey!(p.device, usage, "up");
      } finally {
        await motion.sendKey!(p.device, 0xe3, "up");
      }
    });
    return { ok: true };
  }
  if (p.command === "touch") {
    if (!isTouchHIDEvent(p.x, p.y, p.phase)) throw new Error("Invalid touchscreen HID event");
    if (!motion.sendTouch) throw new Error("Native touchscreen input is unavailable");
    const handled = await motion.sendTouch(
      p.device,
      p.x!,
      p.y!,
      p.phase as "begin" | "move" | "end",
    );
    return handled === false ? { ok: true, touchHandled: false } : { ok: true };
  }
  if (p.command === "key") {
    if (!isKeyboardHIDEvent(p.usage, p.phase)) throw new Error("Invalid keyboard HID event");
    if (!motion.sendKey) throw new Error("Native keyboard input is unavailable");
    await motion.sendKey(p.device, p.usage!, p.phase as "down" | "up");
    return { ok: true };
  }
  if (p.command === "software-keyboard") {
    if (!motion.sendConsumer) throw new Error("Native keyboard toggle is unavailable");
    await motion.sendConsumer(p.device, 12, 0xb8, "press");
    return { ok: true };
  }
  if (p.command === "orientation") {
    if (!DEVICE_ORIENTATIONS.includes(p.orientation as DeviceOrientation))
      throw new Error("Invalid device orientation");
    if (!motion.setOrientation) throw new Error("Native orientation is unavailable");
    await motion.setOrientation(p.device, p.orientation as DeviceOrientation);
    return { ok: true };
  }
  if (p.command === "consumer") {
    if (!isConsumerHIDEvent(p.usagePage, p.usage, p.phase))
      throw new Error("Invalid consumer HID event");
    if (!motion.sendConsumer) throw new Error("Native consumer input is unavailable");
    await motion.sendConsumer(p.device, p.usagePage!, p.usage!, p.phase as ConsumerHIDPhase);
    return { ok: true };
  }
  if (p.command !== "angle") throw new Error("Unknown device motion command");
  if (typeof p.angle !== "number" || !Number.isFinite(p.angle) || p.angle < 0 || p.angle > 180) {
    throw new Error("Hinge angle must be between 0 and 180 degrees");
  }
  await motion.setAngle(p.device, p.angle);
  return { ok: true };
}
