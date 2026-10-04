import { HIDUsage } from "./hid-usage";

export function duoHardwareCommands(press: {
  button?: string;
  usagePage?: number;
  usage?: number;
  phase?: "down" | "up" | "press";
}): { usagePage: number; usage: number; phase: "down" | "up" | "press" }[] | null {
  const phase = press.phase ?? "press";
  if (press.usagePage === HIDUsage.consumerPage && press.usage !== undefined)
    return [{ usagePage: HIDUsage.consumerPage, usage: press.usage, phase }];
  const usage = {
    lock: HIDUsage.power,
    side_button: HIDUsage.power,
    siri: HIDUsage.voiceCommand,
    volume_up: HIDUsage.volumeUp,
    volume_down: HIDUsage.volumeDown,
    app_switcher: HIDUsage.menu,
  }[press.button ?? ""];
  if (usage === undefined) return null;
  const command = { usagePage: HIDUsage.consumerPage, usage, phase };
  return press.button === "app_switcher" ? [command, command] : [command];
}
