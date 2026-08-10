/**
 * UI choices applied once, when a preview page first loads.
 *
 * These are launch options, not persisted settings: they seed the initial
 * render and then the user (and localStorage) own the state. Keeping the
 * parsing here means the CLI rejects a bad `--panes` before a server starts,
 * rather than the browser silently opening the wrong layout.
 */

/** Panels the preview can open on load. */
export const PREVIEW_PANES = ["devices", "inspector", "devtools", "logs", "metrics"] as const;

export type PreviewPane = (typeof PREVIEW_PANES)[number];
export type SimulatorTheme = "light" | "dark";

export interface PreviewInitialState {
  panes?: PreviewPane[];
  /** Size the simulator to fit the viewport on first paint. */
  fit?: boolean;
}

/**
 * Parse the comma-separated value accepted by `--panes`.
 *
 * `none` is exclusive on purpose: `none,logs` is a contradiction, and quietly
 * picking one reading of it would hand back a layout the user didn't ask for.
 */
export function parsePreviewPanes(value: string): PreviewPane[] {
  const panes = value
    .split(",")
    .map((pane) => pane.trim().toLowerCase())
    .filter(Boolean);

  if (panes.length === 1 && panes[0] === "none") return [];
  if (panes.length === 0 || panes.includes("none")) {
    throw new Error(`Expected 'none' or a comma-separated list of: ${PREVIEW_PANES.join(", ")}.`);
  }

  const invalid = panes.filter((pane) => !(PREVIEW_PANES as readonly string[]).includes(pane));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown pane${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}. ` +
        `Expected: ${PREVIEW_PANES.join(", ")}.`,
    );
  }

  return [...new Set(panes)] as PreviewPane[];
}

/** Parse the simulator appearance accepted by `--theme`. */
export function parseSimulatorTheme(value: string): SimulatorTheme {
  const theme = value.trim().toLowerCase();
  if (theme === "light" || theme === "dark") return theme;
  throw new Error("Expected simulator theme: light or dark.");
}

/**
 * Whether a pane should start open.
 *
 * An absent `panes` means "no launch preference", which must not be confused
 * with an explicit empty list from `--panes none`: the first leaves the
 * persisted default alone, the second closes everything.
 */
export function paneInitiallyOpen(
  state: PreviewInitialState | undefined,
  pane: PreviewPane,
  persistedDefault: boolean,
): boolean {
  if (!state?.panes) return persistedDefault;
  return state.panes.includes(pane);
}
