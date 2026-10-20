import { useRef } from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import type { SimulatorOrientation } from "headless-serve-sim-client/simulator";
import { useAxSelectionContext, useAxSnapshotContext } from "../hooks/use-ax-snapshot";
import { spring } from "../lib/motion";
import { axElementKey } from "../utils/ax";
import { axSnapshotForDisplay } from "../utils/ax-display";
import { AxTarget } from "./ax-target";

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
  const snapshot =
    laidOut && axSnapshotForDisplay(laidOut, interfaceOrientation, displayOrientation);
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
        {!laidOut && (
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
        animate={{ opacity: laidOut ? 1 : 0 }}
        transition={spring.ui}
      >
        {!!snapshot?.screen.width &&
          !!snapshot.screen.height &&
          snapshot.elements.map((element, index) => {
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
    </motion.div>
  );
}
