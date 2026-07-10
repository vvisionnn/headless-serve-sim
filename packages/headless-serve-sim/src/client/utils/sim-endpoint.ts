import type { SimulatorOrientation } from "headless-serve-sim-client/simulator";

declare global {
  interface Window {
    __SIM_PREVIEW__?: {
      url: string;
      streamUrl: string;
      wsUrl: string;
      pid: number;
      port: number;
      device: string;
      basePath: string;
      logsEndpoint?: string;
      axEndpoint?: string;
      appStateEndpoint?: string;
      metricsEndpoint?: string;
      devtoolsEndpoint?: string;
      gridApiEndpoint?: string;
      gridStartEndpoint?: string;
      gridShutdownEndpoint?: string;
      gridMemoryEndpoint?: string;
      previewEndpoint?: string;
      // Absolute path of the running headless-serve-sim entry script. The camera tool
      // shells out via `node <bin> camera ...` so it doesn't depend on the
      // `headless-serve-sim` binary being on the user's PATH.
      serveSimBin?: string;
      /** Bearer token required by the /exec shell-exec route. */
      execToken?: string;
      /**
       * Device name (e.g. "iPad Pro 13-inch (M5)") baked in at page-serve time.
       * Lets the first paint resolve the device *type* — and thus the frame's
       * size cap — before the browser's async `simctl list` finishes, so an
       * iPad frame doesn't start at the iPhone cap and grow a moment later.
       */
      deviceName?: string;
      /**
       * Live screen geometry baked in at page-serve time (from the helper's
       * /config). Lets the first paint size the device frame to the real device
       * instead of a generic fallback that resizes when the control-socket
       * config arrives a moment later.
       */
      screenConfig?: { width: number; height: number; orientation?: SimulatorOrientation };
    };
  }
}

export function simEndpoint(path: string): string {
  // When __SIM_PREVIEW__ is injected we have the canonical base path. Without
  // it (BootEmptyState — no helper running yet) the page is still being served
  // at the middleware's mount point, so derive the base from the current URL.
  // Otherwise the empty-state polls (e.g. /api, /exec) would hit the wrong
  // path under any mount other than "/", and auto-switch after boot fails.
  const configured = window.__SIM_PREVIEW__?.basePath;
  const basePath = configured ?? (window.location.pathname.replace(/\/+$/, "") || "/");
  return basePath === "/" ? `/${path}` : `${basePath}/${path}`;
}
