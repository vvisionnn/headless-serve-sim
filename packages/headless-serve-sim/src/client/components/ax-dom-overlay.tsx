import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import type { SimulatorOrientation } from "headless-serve-sim-client/simulator";
import { useAxSelectionContext, useAxSnapshotContext } from "../hooks/use-ax-snapshot";
import { spring } from "../lib/motion";
import { axElementKey } from "../utils/ax";
import type { AxSnapshot } from "../../ax-shared";
import { axSnapshotForDisplay, axStaleAfterTurn } from "../utils/ax-display";
import { AxTarget } from "./ax-target";

// Long enough for iOS to turn an app's interface.
const SETTLE_MS = 1000;
// Longer than the slowest walk the server polls for, so a layout that held
// through a turn comes back after it has settled.
const STALE_WAIT_MS = 3500;

export function AxDomOverlay({
  interfaceOrientation,
  displayOrientation,
}: {
  interfaceOrientation?: SimulatorOrientation;
  displayOrientation?: SimulatorOrientation;
}) {
  // Turned off, the stream closes and the snapshot goes; keep drawing the last
  // one while the overlay fades out.
  const present = useIsPresent();
  const { snapshot: live } = useAxSnapshotContext();
  const held = useRef(live);
  if (present) held.current = live;
  const laidOut = held.current;
  // A turn can leave the last walk describing a layout the app no longer has.
  // Its boxes fade out riding the glass, as they were laid out, and the sweep
  // runs until a walk from after the turn lands. Walks landing while iOS is
  // still turning the interface may have caught it halfway, so the first one
  // shown is one that lands after the turn has settled. The server only sends
  // a walk that changed, so if none comes the layout held, and it comes back.
  const [turn, setTurn] = useState<{
    display?: SimulatorOrientation;
    stale: {
      snapshot: AxSnapshot;
      from: SimulatorOrientation;
      /** The last walk in when the turn settled; undefined until then. */
      settledOn?: AxSnapshot | null;
    } | null;
  }>({ display: displayOrientation, stale: null });
  const hidden =
    !!turn.stale && (turn.stale.settledOn === undefined || laidOut === turn.stale.settledOn);
  if (turn.display !== displayOrientation) {
    const from = turn.display;
    setTurn({
      display: displayOrientation,
      stale:
        turn.stale && hidden
          ? { snapshot: turn.stale.snapshot, from: turn.stale.from }
          : laidOut &&
              from &&
              displayOrientation &&
              axStaleAfterTurn(laidOut, from, displayOrientation)
            ? { snapshot: laidOut, from }
            : null,
    });
  }
  const { stale } = turn;
  useEffect(() => {
    if (!stale) return;
    const settled = stale.settledOn !== undefined;
    const timer = setTimeout(
      () =>
        setTurn((t) =>
          t.stale !== stale
            ? t
            : { ...t, stale: settled ? null : { ...stale, settledOn: held.current } },
        ),
      settled ? STALE_WAIT_MS : SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [stale]);
  const shown = !!laidOut && !hidden;
  const source = hidden ? stale!.snapshot : laidOut;
  const snapshot =
    source &&
    axSnapshotForDisplay(source, hidden ? stale!.from : interfaceOrientation, displayOrientation);
  const { highlightedKey, selectedKey, setHighlightedKey, setSelectedKey } =
    useAxSelectionContext();

  return (
    <motion.div
      className="absolute inset-0 z-10 overflow-hidden pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={spring.ui}
    >
      {/* The first walk takes a beat: a light sweep says it's looking. */}
      <AnimatePresence>
        {!shown && (
          <motion.div
            key="scan"
            data-ax-scanning=""
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={spring.ui}
            style={{
              background:
                "linear-gradient(100deg, transparent 35%, rgb(255 255 255 / 0.16) 50%, transparent 65%) 0 0 / 250% 100%",
              animation: "shimmer 1.6s linear infinite",
            }}
          />
        )}
      </AnimatePresence>
      {/* …and the walk's boxes fade in over it as it goes. */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: shown ? 1 : 0 }}
        transition={spring.ui}
      >
        {/* An app that lays itself out anew crossfades to the new layout. */}
        <AnimatePresence initial={false}>
          {!!source && !!snapshot?.screen.width && !!snapshot.screen.height && (
            <motion.div
              key={`${source.screen.width}x${source.screen.height}`}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, pointerEvents: "none" }}
              transition={spring.ui}
            >
              {snapshot.elements.map((element, index) => {
                const key = axElementKey(element);
                return (
                  <AxTarget
                    key={key}
                    element={element}
                    index={index}
                    screen={snapshot.screen}
                    highlighted={key === highlightedKey}
                    selected={key === selectedKey}
                    onHighlight={setHighlightedKey}
                    onSelect={setSelectedKey}
                  />
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
