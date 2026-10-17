import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { spring } from "../lib/motion";
import { useShell, type InspectorTab } from "../shell/shell-context";
import { Segmented } from "../ui/segmented";
import { ActivityTab } from "./activity-tab";
import { AppTab } from "./app-tab";
import { CaptureTab } from "./capture-tab";
import { DeviceTab } from "./device-tab";
import type { InspectorProps } from "./types";

const tabs: { value: InspectorTab; label: string }[] = [
  { value: "device", label: "Device" },
  { value: "app", label: "App" },
  { value: "capture", label: "Capture" },
  { value: "activity", label: "Activity" },
];

/**
 * Inspector: one panel, four questions — the device, the app on it, what you
 * capture from it, and how it is performing. Tab content slides in from the
 * side of the tab you came from, so the order is spatial, not arbitrary.
 */
export function Inspector(props: InspectorProps) {
  const { inspectorTab, setInspectorTab } = useShell();
  const index = tabs.findIndex((t) => t.value === inspectorTab);
  const prev = useRef(index);
  const dir = index >= prev.current ? 1 : -1;
  prev.current = index;
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center px-3">
        <Segmented
          aria-label="Inspector"
          className="w-full"
          items={tabs}
          value={inspectorTab}
          onChange={setInspectorTab}
        />
      </header>
      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={inspectorTab}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: 24 * d, opacity: 0, filter: "blur(4px)" }),
              center: { x: 0, opacity: 1, filter: "blur(0px)" },
              exit: (d: number) => ({ x: -24 * d, opacity: 0, filter: "blur(4px)" }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ ...spring.ui, opacity: { duration: 0.18 } }}
            className="thin-scrollbar scroll-fade absolute inset-0 flex flex-col gap-5 overflow-y-auto px-3 pt-2 pb-8 [&>*]:shrink-0"
          >
            {inspectorTab === "device" && <DeviceTab {...props} />}
            {inspectorTab === "app" && <AppTab {...props} />}
            {inspectorTab === "capture" && <CaptureTab {...props} />}
            {inspectorTab === "activity" && <ActivityTab {...props} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
