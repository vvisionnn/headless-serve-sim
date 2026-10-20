/**
 * Drops screen touches that begin while the device is turning: the screen is
 * moving under the pointer, so the press was meant for something else (a
 * second Rotate). The rest of a dropped touch goes with it; a touch already
 * down when the turn starts carries on.
 */
export function createTurnTouchGate(turning: () => boolean) {
  let dropping = false;
  return (phase: "begin" | "move" | "end") => {
    if (phase === "begin") dropping = turning();
    const admit = !dropping;
    if (phase === "end") dropping = false;
    return admit;
  };
}
