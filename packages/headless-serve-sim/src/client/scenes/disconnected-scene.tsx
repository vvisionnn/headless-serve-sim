import { motion } from "motion/react";
import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { DeviceFrameSpec } from "headless-serve-sim-client/simulator";
import { DeviceBezel } from "../components/device-bezel";
import { spring } from "../lib/motion";
import { Button } from "../ui/button";
import { fitDeviceBezel } from "../utils/bezel-geometry";

function useViewport() {
  const [size, setSize] = useState({ width: 1280, height: 800 });
  useEffect(() => {
    const read = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}

/**
 * Shown when the user-selected simulator disconnects. The device stays on the
 * stage, dark, and the view stays pinned to it until it comes back — changing
 * simulators is only ever the user's explicit choice.
 */
export function DisconnectedScene({
  deviceName,
  frameSpec,
  onChooseAnother,
}: {
  deviceName: string | null;
  frameSpec: DeviceFrameSpec | null;
  onChooseAnother: () => void;
}) {
  const viewport = useViewport();
  const card = (
    <DisconnectedCard name={deviceName ?? "This simulator"} onChooseAnother={onChooseAnother} />
  );

  if (!frameSpec) {
    return (
      <div className="stage-bg fixed inset-0 flex items-center justify-center p-6">{card}</div>
    );
  }

  const geometry = fitDeviceBezel({
    spec: frameSpec,
    rotation: 0,
    availWidth: viewport.width * 0.8,
    availHeight: viewport.height * 0.82,
    maxScreenWidth: Number.POSITIVE_INFINITY,
    maxScale: 1,
  });
  return (
    <div className="stage-bg fixed inset-0 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={spring.surface}
      >
        <DeviceBezel spec={frameSpec} geometry={geometry}>
          <div className="absolute inset-0 flex items-center justify-center bg-[#050506] p-5">
            {card}
          </div>
        </DeviceBezel>
      </motion.div>
    </div>
  );
}

function DisconnectedCard({
  name,
  onChooseAnother,
}: {
  name: string;
  onChooseAnother: () => void;
}) {
  return (
    <motion.div
      role="status"
      className="glass-pop flex w-full max-w-[260px] flex-col items-center gap-3 rounded-[22px] px-5 pt-5 pb-4 text-center"
      initial={{ scale: 0.92, y: 10, opacity: 0, filter: "blur(6px)" }}
      animate={{ scale: 1, y: 0, opacity: 1, filter: "blur(0px)" }}
      transition={{ ...spring.ui, delay: 0.15 }}
    >
      {/* Orange reads as "waiting", not an error. */}
      <span className="flex size-10 items-center justify-center rounded-full bg-orange/14 text-orange">
        <WifiOff className="size-5" strokeWidth={2} />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-title3 text-label">{name} disconnected</h1>
        <p className="text-footnote text-label-2">
          The view stays here and resumes as soon as it's back.
        </p>
      </div>
      <Button variant="secondary" size="md" block onClick={onChooseAnother}>
        Choose another simulator
      </Button>
      <span className="shimmer-text text-caption font-medium">Reconnecting…</span>
    </motion.div>
  );
}
