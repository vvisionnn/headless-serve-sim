export function duoHardwareCommands(press: {
  button?: string;
  usagePage?: number;
  usage?: number;
  phase?: "down" | "up" | "press";
}): { usagePage: number; usage: number; phase: "down" | "up" | "press" }[] | null {
  const phase = press.phase ?? "press";
  if (press.usagePage === 12 && press.usage !== undefined)
    return [{ usagePage: 12, usage: press.usage, phase }];
  const usage = {
    lock: 0x30,
    side_button: 0x30,
    siri: 0xcf,
    volume_up: 0xe9,
    volume_down: 0xea,
    app_switcher: 0x40,
  }[press.button ?? ""];
  if (usage === undefined) return null;
  const command = { usagePage: 12, usage, phase };
  return press.button === "app_switcher" ? [command, command] : [command];
}
