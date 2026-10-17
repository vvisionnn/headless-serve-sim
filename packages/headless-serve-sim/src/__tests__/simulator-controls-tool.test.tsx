import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SimulatorControlsTool } from "../client/components/simulator-controls-tool";
import type { SimulatorControlState } from "../simulator-controls";
import * as exec from "../client/utils/exec";
import * as select from "../client/ui/select";

function renderWithState(state: SimulatorControlState) {
  const useState = React.useState;
  let hydrated = false;
  const spy = spyOn(React, "useState").mockImplementation((<S,>(initial?: S | (() => S)) => {
    if (!hydrated && initial === null) {
      hydrated = true;
      return useState(state as S);
    }
    return useState(initial);
  }) as typeof React.useState);
  try {
    return renderToStaticMarkup(<SimulatorControlsTool udid="DUO" defaultOpen />);
  } finally {
    spy.mockRestore();
  }
}

test("disabled selector icons remain fully opaque", () => {
  const html = renderToStaticMarkup(<SimulatorControlsTool udid="DUO" defaultOpen />);
  const trigger = html.match(/<button[^>]*aria-label="Physical Orientation"[^>]*>/)?.[0];
  expect(trigger).toBeDefined();
  expect(trigger).not.toContain("disabled:opacity-");
});

test("allows one bounded read stage for refresh and two for mutation with fresh readback", async () => {
  const state: SimulatorControlState = {
    audio: null,
    biometrics: null,
    orientation: "portrait",
    errors: {},
  };
  const budgets: number[] = [];
  const effects: React.EffectCallback[] = [];
  let changeOrientation: ((value: string) => void) | undefined;
  const Select = select.Select;
  const spies = [
    spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      budgets.push(milliseconds);
      return new AbortController().signal;
    }),
    spyOn(React, "useEffect").mockImplementation((effect) => {
      effects.push(effect);
    }),
    spyOn(exec, "hostSimulatorControlRequest").mockResolvedValue(state),
    spyOn(exec, "hostDeviceMotionRequest").mockResolvedValue(null),
    spyOn(select, "Select").mockImplementation(((props: Parameters<typeof Select>[0]) => {
      if (props.label === "Physical Orientation")
        changeOrientation = props.onChange as (value: string) => void;
      return Select(props);
    }) as typeof Select),
  ];
  try {
    renderWithState(state);
    effects[0]?.();
    await Promise.resolve();
    expect(changeOrientation).toBeDefined();
    changeOrientation?.("landscapeLeft");
    await Promise.resolve();
    expect(budgets).toEqual([20_000, 35_000]);
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

test("warns when the simulator window owns input without offering disruptive automatic recovery", () => {
  const html = renderWithState({
    audio: null,
    biometrics: null,
    orientation: null,
    inputAttachment: { appleWindowActive: true },
    errors: {},
  });
  expect(html).toContain('role="alert"');
  expect(html).toContain("Simulator input is owned by Apple’s window.");
  expect(html).toContain(
    "Headless touches, buttons, and keyboard input may be dropped even when delivery succeeds.",
  );
  expect(html).toContain(
    "Reclaiming input requires restarting SpringBoard and closes running simulator apps.",
  );
  expect(html).not.toContain("are unavailable until input ownership is reclaimed");
  expect(html).not.toContain("backboardd");
  expect(html).toContain("No automatic repair is performed");
  expect(html).not.toMatch(/<button[^>]*>\s*(?:Repair|Reclaim|Restart)/);
});

test("does not claim input is owned when attachment is inactive or unknown", () => {
  for (const inputAttachment of [undefined, null, { appleWindowActive: false }]) {
    const html = renderWithState({
      audio: null,
      biometrics: null,
      orientation: null,
      inputAttachment,
      errors: {},
    });
    expect(html).not.toContain("Simulator input is owned by Apple’s window.");
    expect(html).not.toContain("input is available");
  }
});

test("renders an unknown input attachment query separately from ownership warning", () => {
  const html = renderWithState({
    audio: null,
    biometrics: null,
    orientation: null,
    inputAttachment: null,
    errors: { inputAttachment: "Device is unavailable" },
  });
  expect(html).toContain("Input ownership unavailable: Device is unavailable");
  expect(html).not.toContain("Simulator input is owned by Apple’s window.");
});

test("renders native Sound, biometrics and six-orientation controls disabled until state loads", () => {
  const html = renderToStaticMarkup(<SimulatorControlsTool udid="DUO" defaultOpen />);
  expect(html).toContain("Sound");
  expect(html).toMatch(
    /aria-disabled="true"[^>]*><div[^>]*><div role="slider" aria-label="Volume" aria-valuemin="0" aria-valuemax="1"/,
  );
  expect(html).toContain('aria-label="Input Device"');
  expect(html).toContain('aria-label="Output Device"');
  expect(html).toContain('aria-label="Biometrics Enrolled"');
  expect(html).toContain("Matching Touch");
  expect(html).toContain("Non-matching Touch");
  expect(html).toContain('aria-label="Physical Orientation"');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Action Button"/);
  expect(html).not.toContain('role="switch" aria-checked="false" aria-label="Action Button"');
  expect(html).toContain("Not supported by this device");
  expect(html.match(/disabled=""|aria-disabled="true"/g)?.length).toBeGreaterThanOrEqual(8);
});

test("renders continuous Liquid Glass opacity disabled until native state loads", () => {
  const html = renderToStaticMarkup(<SimulatorControlsTool udid="DUO" defaultOpen />);
  expect(html).toMatch(
    /aria-disabled="true"[^>]*><div[^>]*><div role="slider" aria-label="Liquid Glass opacity" aria-valuemin="0" aria-valuemax="1"/,
  );
});

test("clipboard controls begin disabled with sharing off and explain the host destination", () => {
  const html = renderToStaticMarkup(<SimulatorControlsTool udid="DUO" defaultOpen />);
  expect(html).toContain("Clipboard");
  expect(html).toContain(
    'role="switch" aria-checked="false" aria-label="Use Shared Clipboard" disabled=""',
  );
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Send Clipboard"/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Get Clipboard"/);
  expect(html).toContain("Mac host");
  expect(html).toContain("Sharing is off until you enable it");
});
