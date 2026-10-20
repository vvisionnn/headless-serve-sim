import type { ConsoleTab, InspectorTab } from "./shell-context";

/**
 * What a device switch carries from the old shell into the new one, so the
 * window stays put and only the device changes — the way a native app swaps
 * documents, not the way a page reloads.
 */
export interface StageHandoff {
  /** Where the device was on screen (its wall tile), to fly in from. */
  from: DOMRect | null;
  /** Its last frame, held on the screen until the new stream paints. */
  frame: HTMLCanvasElement | null;
  layout: {
    navigatorOpen: boolean;
    inspectorOpen: boolean;
    inspectorTab: InspectorTab;
    consoleOpen: boolean;
    consoleTab: ConsoleTab;
    consoleHeight: number;
  };
}

let pending: StageHandoff | null = null;
let current: StageHandoff["layout"] | null = null;
/**
 * The leaving shell stays until the next one has put its device on the stage
 * (a Duo has no place until its first composite), so the window never shows
 * an empty stage between the two.
 */
let arrival: { promise: Promise<Arrival>; resolve: (how: Arrival) => void } | null = null;

interface Arrival {
  /** The device is opaque from its first frame, so the tile it leaves can go. */
  solid: boolean;
}

/** The live shell keeps its layout here, so any switch — even Back — can carry it. */
export function publishStageLayout(layout: StageHandoff["layout"]) {
  current = layout;
}

/** Hand over to the next shell; `from` and `frame` only when the switch knows them. */
export function handOffStage(handoff: Partial<StageHandoff> = {}) {
  if (!handoff.layout && !current) return;
  pending = {
    from: handoff.from ?? null,
    frame: handoff.frame ?? null,
    layout: handoff.layout ?? current!,
  };
  let resolve: (how: Arrival) => void = () => {};
  const promise = new Promise<Arrival>((r) => (resolve = r));
  arrival = { promise, resolve };
}

/** Settles once the next shell has placed its device; null with nothing to wait on. */
export function stageArrival(): Promise<Arrival> | null {
  return arrival?.promise ?? null;
}

/** The arriving shell has placed its device. */
export function stageArrived(how: Arrival) {
  arrival?.resolve(how);
  arrival = null;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The offset and scale that put the device back over the tile it flies from.
 * `box` is the device box at rest, which the flight scales about its centre;
 * `visible` is the device within it (the Duo draws inside a larger box).
 */
export function flightStart(
  tile: Box,
  box: Box,
  visible: { x: number; y: number; width: number; height: number },
): { x: number; y: number; scale: number } {
  const scale = tile.width / visible.width;
  const ox = box.left + box.width / 2;
  const oy = box.top + box.height / 2;
  const cx = box.left + visible.x + visible.width / 2;
  const cy = box.top + visible.y + visible.height / 2;
  return {
    x: tile.left + tile.width / 2 - ox - scale * (cx - ox),
    y: tile.top + tile.height / 2 - oy - scale * (cy - oy),
    scale,
  };
}

/** The handoff for the shell mounting now; read once, then cleared. */
export function takeStageHandoff(): StageHandoff | null {
  const handoff = pending;
  pending = null;
  return handoff;
}
