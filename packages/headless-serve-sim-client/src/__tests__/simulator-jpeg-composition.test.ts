import { expect, spyOn, test } from "bun:test";
import * as React from "react";
import { SimulatorView, type SimulatorRecordingSource } from "../simulator/SimulatorView";
import type { SimulatorComposition } from "../types";

const composition: SimulatorComposition = {
  angle: 90,
  rotation: 0,
  scale: 1,
  displayId: 3,
  rawWidth: 2007,
  rawHeight: 2853,
  rawRotation: 90,
  mask: "M0 0Z",
  bounds: [0, 0, 1, 1],
  pieces: [],
};

function findElement(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<any>) => boolean,
): React.ReactElement<any> | null {
  if (!React.isValidElement(node)) return null;
  const element = node as React.ReactElement<any>;
  if (predicate(element)) return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

test("relay recording composition becomes visible only with its corresponding loaded JPEG", () => {
  class TestImage {
    naturalWidth = 1280;
    naturalHeight = 900;
    src = "";
    currentSrc = "";
  }
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, "HTMLImageElement");
  Object.defineProperty(globalThis, "HTMLImageElement", { configurable: true, value: TestImage });
  const refs: { current: unknown }[] = [];
  const states: { value: unknown }[] = [];
  const effects: { effect: React.EffectCallback; deps?: React.DependencyList }[] = [];
  let refIndex = 0;
  let stateIndex = 0;
  const spies = [
    spyOn(React, "useRef").mockImplementation(
      (value: unknown) => (refs[refIndex++] ??= { current: value }),
    ),
    spyOn(React, "useState").mockImplementation(<S>(value?: S | (() => S)) => {
      const state = (states[stateIndex++] ??= {
        value: typeof value === "function" ? (value as () => S)() : value,
      });
      return [
        state.value as S,
        (next: React.SetStateAction<S>) => {
          state.value =
            typeof next === "function" ? (next as (previous: S) => S)(state.value as S) : next;
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
  let cleanup: ReturnType<React.EffectCallback> = undefined;
  try {
    let frame!: (url: string, bytes?: number, composition?: SimulatorComposition) => void;
    const subscribeFrame = (callback: typeof frame) => {
      frame = callback;
      return () => {};
    };
    const recordingSourceRef: React.MutableRefObject<SimulatorRecordingSource | null> = {
      current: null,
    };
    const render = () => {
      refIndex = 0;
      stateIndex = 0;
      effects.length = 0;
      return SimulatorView({
        url: "http://stream.test",
        codec: "mjpeg",
        onStreamTouch: () => {},
        subscribeFrame,
        recordingSourceRef,
      });
    };
    const tree = render();
    const imageElement = findElement(
      tree,
      (element) => element.type === "img" && element.props.style?.display !== "none",
    )!;
    const image = new TestImage();
    imageElement.props.ref.current = image;
    const surface = findElement(
      tree,
      (element) =>
        element.type === "div" &&
        element.props.style?.position === "relative" &&
        element.props.style?.overflow === "hidden",
    )!;
    surface.props.ref.current = { getBoundingClientRect: () => ({ width: 1280, height: 900 }) };
    cleanup = effects.find(({ deps }) => deps?.includes(subscribeFrame))!.effect();
    frame("blob:first", 100, composition);
    render();
    effects.find(({ deps }) => deps?.includes(recordingSourceRef))!.effect();
    expect(recordingSourceRef.current?.snapshot()).toBeNull();
    image.currentSrc = "blob:first";
    imageElement.props.onLoad({ currentTarget: image });
    expect(recordingSourceRef.current?.snapshot()?.composition).toEqual(composition);
    let presented = 0;
    const unsubscribe = recordingSourceRef.current?.subscribe?.(() => presented++);
    frame("blob:second", 101, { ...composition, displayId: 1 });
    expect(recordingSourceRef.current?.snapshot()).toBeNull();
    // An obsolete load event must not publish the newer frame's metadata.
    imageElement.props.onLoad({ currentTarget: image });
    expect(recordingSourceRef.current?.snapshot()).toBeNull();
    image.currentSrc = "blob:second";
    imageElement.props.onLoad({ currentTarget: image });
    expect(recordingSourceRef.current?.snapshot()?.composition?.displayId).toBe(1);
    expect(presented).toBe(1);
    frame("blob:ordinary", 102);
    image.currentSrc = "blob:ordinary";
    imageElement.props.onLoad({ currentTarget: image });
    expect(recordingSourceRef.current?.snapshot()?.composition).toBeUndefined();
    unsubscribe?.();
  } finally {
    if (typeof cleanup === "function") cleanup();
    for (const spy of spies) spy.mockRestore();
    if (originalImage) Object.defineProperty(globalThis, "HTMLImageElement", originalImage);
    else Reflect.deleteProperty(globalThis, "HTMLImageElement");
  }
});
