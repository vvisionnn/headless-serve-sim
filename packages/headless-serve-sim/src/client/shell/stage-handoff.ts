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
  frame: string | null;
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
}

/**
 * Give a pending handoff that has no picture the stream's first frame, so the
 * new device arrives showing its screen. Gives up quietly after `timeoutMs`.
 */
export async function primeStageFrame(streamUrl: string, timeoutMs = 1200): Promise<void> {
  if (!pending || pending.frame) return;
  const target = pending;
  const image = new Image();
  image.crossOrigin = "anonymous";
  const loaded = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    image.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    image.src = streamUrl;
  });
  try {
    if (loaded && pending === target && image.naturalWidth) {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      target.frame = canvas.toDataURL("image/jpeg", 0.85);
    }
  } catch {
    // A tainted frame: arrive without a picture.
  } finally {
    // An MJPEG image keeps its connection open until its source goes.
    image.src = "";
  }
}

/** The handoff for the shell mounting now; read once, then cleared. */
export function takeStageHandoff(): StageHandoff | null {
  const handoff = pending;
  pending = null;
  return handoff;
}
