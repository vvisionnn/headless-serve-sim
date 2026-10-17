import { describe, expect, test } from "bun:test";
import { filterCommands, type PaletteCommand } from "../client/shell/command-palette";

const Icon = () => null;
const cmd = (id: string, group: string, label: string, caption?: string): PaletteCommand => ({
  id,
  group,
  label,
  caption,
  icon: Icon,
  run: () => {},
});

const commands = [
  cmd("sim", "Simulators", "iPhone Air", "iOS 26.0 · Booted"),
  cmd("home", "Device", "Home"),
  cmd("dark", "Theme", "Dark"),
  cmd("shot", "Capture", "Take screenshot"),
];

const ids = (list: PaletteCommand[]) => list.map((c) => c.id);

describe("filterCommands", () => {
  test("an empty query keeps every command in order", () => {
    expect(ids(filterCommands(commands, "  "))).toEqual(["sim", "home", "dark", "shot"]);
  });

  test("matches case-insensitively across label, caption and group", () => {
    expect(ids(filterCommands(commands, "SCREEN"))).toEqual(["shot"]);
    expect(ids(filterCommands(commands, "booted"))).toEqual(["sim"]);
    expect(ids(filterCommands(commands, "theme"))).toEqual(["dark"]);
  });

  test("every word must match, in any order", () => {
    expect(ids(filterCommands(commands, "air iphone"))).toEqual(["sim"]);
    expect(ids(filterCommands(commands, "iphone home"))).toEqual([]);
  });
});

test("search-only commands stay hidden until the user types", () => {
  const noop = () => {};
  const list: PaletteCommand[] = [
    { id: "live", group: "Simulators", label: "iPhone Air", icon: () => null, run: noop },
    {
      id: "off",
      group: "Simulators",
      label: "iPad Pro",
      icon: () => null,
      run: noop,
      searchOnly: true,
    },
  ];
  expect(filterCommands(list, "").map((c) => c.id)).toEqual(["live"]);
  expect(filterCommands(list, "ipad").map((c) => c.id)).toEqual(["off"]);
});
