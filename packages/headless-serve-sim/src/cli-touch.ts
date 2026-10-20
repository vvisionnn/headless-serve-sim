/**
 * The CLI's x/y are fractions of the screen as it looks — the screenshot's
 * orientation — so the helper maps them onto the raw panel with the current
 * rotation. A gesture that already carries a `space` keeps it.
 */
export function cliTouchPayload(touch: { type: string; x: number; y: number; space?: string }) {
  return { space: "interface", ...touch };
}
