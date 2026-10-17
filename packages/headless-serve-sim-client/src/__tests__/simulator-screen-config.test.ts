import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import {
  SimulatorView,
  type SimulatorRecordingSource,
  type SimulatorViewProps,
} from "../simulator/SimulatorView";
import type { StreamConfig } from "../types";

function withSimulatorView(
  run: (
    render: (props: SimulatorViewProps) => React.ReactElement,
    commit: (dependency: unknown) => void,
  ) => void,
) {
  const refs: { current: unknown }[] = [];
  const states: { value: unknown }[] = [];
  let refIndex = 0;
  let stateIndex = 0;
  const effects: { effect: React.EffectCallback; deps?: React.DependencyList }[] = [];
  const spies = [
    spyOn(React, "useRef").mockImplementation((value: unknown) => {
      const index = refIndex++;
      return (refs[index] ??= { current: value });
    }),
    spyOn(React, "useState").mockImplementation(<S>(value?: S | (() => S)) => {
      const index = stateIndex++;
      const state = (states[index] ??= {
        value: typeof value === "function" ? (value as () => S)() : value,
      });
      return [
        state.value as S,
        (next: React.SetStateAction<S>) => {
          state.value =
            typeof next === "function" ? (next as (prev: S) => S)(state.value as S) : next;
        },
      ];
    }),
    spyOn(React, "useCallback").mockImplementation((callback) => callback),
    spyOn(React, "useEffect").mockImplementation((effect, deps) => {
      effects.push({ effect, deps });
    }),
    spyOn(React, "useLayoutEffect").mockImplementation((effect, deps) => {
      effects.push({ effect, deps });
    }),
  ];
  try {
    run(
      (props) => {
        refIndex = 0;
        stateIndex = 0;
        effects.length = 0;
        const tree = SimulatorView({ ...props, codec: "mjpeg", onStreamTouch: () => {} });
        effects.find(({ deps }) => deps?.[1] === props.streamConfig)?.effect();
        return tree;
      },
      (dependency) => {
        effects.find(({ deps }) => deps?.includes(dependency))?.effect();
      },
    );
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

function findElement(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<any>) => boolean,
): React.ReactElement<any> | null {
  if (!React.isValidElement(node)) return null;
  const element = node as React.ReactElement<any>;
  if (predicate(element)) return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

test("SimulatorView reports a display change with unchanged geometry", () => {
  withSimulatorView((render) => {
    const updates: StreamConfig[] = [];
    const first: StreamConfig = {
      width: 2007,
      height: 2853,
      orientation: "landscape_left",
      displayId: 1,
    };
    const props = {
      url: "http://stream.test",
      onScreenConfigChange: (config: StreamConfig) => updates.push(config),
    };
    render({ ...props, streamConfig: first });
    render({ ...props, streamConfig: { ...first, displayId: 3 } });
    expect(updates.map((config) => config.displayId)).toEqual([1, 3]);
  });
});

test("SimulatorView keeps display metadata when a JPEG reports dimensions", () => {
  withSimulatorView((render) => {
    const updates: StreamConfig[] = [];
    const streamConfig: StreamConfig = {
      width: 2007,
      height: 2853,
      orientation: "landscape_left",
      displayId: 3,
    };
    const tree = render({
      url: "http://stream.test",
      streamConfig,
      onScreenConfigChange: (config) => updates.push(config),
    });
    const image = findElement(tree, (element) => element.type === "img" && !!element.props.onLoad)!;
    image.props.onLoad({ currentTarget: { naturalWidth: 900, naturalHeight: 1280 } });
    expect(updates.at(-1)).toEqual({
      width: 900,
      height: 1280,
      orientation: "landscape_left",
      displayId: 3,
    });
  });
});

test("JPEG dimensions preserve shared composition capability and frame preference", () => {
  withSimulatorView((render) => {
    const updates: StreamConfig[] = [];
    const streamConfig: StreamConfig = {
      width: 3420,
      height: 3420,
      displayId: 3,
      deviceComposition: true,
      includeFrame: false,
    };
    const tree = render({
      url: "http://stream.test",
      streamConfig,
      onScreenConfigChange: (config) => updates.push(config),
    });
    const image = findElement(tree, (element) => element.type === "img" && !!element.props.onLoad)!;
    image.props.onLoad({ currentTarget: { naturalWidth: 2000, naturalHeight: 2000 } });
    expect(updates.at(-1)).toEqual({ ...streamConfig, width: 2000, height: 2000 });
    render({
      url: "http://stream.test",
      streamConfig: { ...streamConfig, deviceComposition: false, includeFrame: true },
      onScreenConfigChange: (config) => updates.push(config),
    });
    expect(updates.at(-1)?.deviceComposition).toBe(false);
    expect(updates.at(-1)?.includeFrame).toBe(true);
  });
});

test("SimulatorView recording snapshots identify the active display", () => {
  class TestImage {
    naturalWidth = 900;
    naturalHeight = 1280;
  }
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, "HTMLImageElement");
  Object.defineProperty(globalThis, "HTMLImageElement", { configurable: true, value: TestImage });
  try {
    withSimulatorView((render, commit) => {
      const recordingSourceRef: React.MutableRefObject<SimulatorRecordingSource | null> = {
        current: null,
      };
      let frame!: (url: string) => void;
      const subscribeFrame = (callback: (url: string) => void) => {
        frame = callback;
        return () => {};
      };
      const props = {
        url: "http://stream.test",
        streamConfig: {
          width: 2007,
          height: 2853,
          orientation: "landscape_left",
          displayId: 3,
        } as StreamConfig,
        subscribeFrame,
        recordingSourceRef,
      };
      const tree = render(props);
      const image = findElement(
        tree,
        (element) =>
          element.type === "img" &&
          !!element.props.onLoad &&
          element.props.style?.display !== "none",
      )!;
      image.props.ref.current = new TestImage();
      const surface = findElement(
        tree,
        (element) =>
          element.type === "div" &&
          element.props.style?.position === "relative" &&
          element.props.style?.overflow === "hidden",
      )!;
      surface.props.ref.current = { getBoundingClientRect: () => ({ width: 1, height: 1 }) };
      commit(subscribeFrame);
      frame("blob:frame");
      image.props.onLoad({
        currentTarget: Object.assign(image.props.ref.current, { currentSrc: "blob:frame" }),
      });
      render(props);
      commit(recordingSourceRef);
      expect(recordingSourceRef.current?.snapshot()).toMatchObject({
        width: 900,
        height: 1280,
        orientation: "landscape_left",
        displayId: 3,
      });
    });
  } finally {
    if (originalImage) Object.defineProperty(globalThis, "HTMLImageElement", originalImage);
    else Reflect.deleteProperty(globalThis, "HTMLImageElement");
  }
});
