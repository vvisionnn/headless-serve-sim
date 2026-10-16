import { AnimatePresence, motion } from "motion/react";
import { Accessibility, Globe, MousePointerClick, Pause, Play, ScrollText, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { spring } from "../lib/motion";
import { useApp, type ConsoleTab } from "../lib/store";
import { StatusDot } from "../ui/badge";
import { IconButton } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { AccessibilityView } from "./accessibility-view";
import { InputView } from "./input-view";
import { LogsView } from "./logs-view";
import { WebView } from "./web-view";

const tabs: ConsoleTab[] = ["logs", "input", "accessibility", "web"];

/** Bottom debug area: everything you read from the device, in one drawer. */
export function ConsolePanel() {
  const { consoleTab, set, axOverlay } = useApp();
  const [paused, setPaused] = useState(false);
  const [clearToken, setClearToken] = useState(0);
  const prev = useRef(consoleTab);
  const dir = tabs.indexOf(consoleTab) >= tabs.indexOf(prev.current) ? 1 : -1;
  prev.current = consoleTab;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b-[0.5px] border-separator px-2.5">
        <Segmented<ConsoleTab>
          size="sm"
          intrinsic
          aria-label="Console view"
          value={consoleTab}
          onChange={(v) => set({ consoleTab: v })}
          items={[
            { value: "logs", label: "Logs", icon: <ScrollText /> },
            { value: "input", label: "Input", icon: <MousePointerClick /> },
            { value: "accessibility", label: "Accessibility", icon: <Accessibility /> },
            { value: "web", label: "Web Inspector", icon: <Globe /> },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          {consoleTab === "logs" && (
            <>
              <span className="mr-1 flex items-center gap-1.5 text-caption font-medium text-label-2">
                <StatusDot tone={paused ? "neutral" : "green"} live={!paused} />
                {paused ? "Paused" : "Live"}
              </span>
              <IconButton size="md" label={paused ? "Resume" : "Pause"} onClick={() => setPaused(!paused)}>
                {paused ? <Play /> : <Pause />}
              </IconButton>
              <IconButton size="md" label="Clear" onClick={() => setClearToken((n) => n + 1)}>
                <Trash2 />
              </IconButton>
            </>
          )}
          {consoleTab === "accessibility" && (
            <span className="mr-1 flex items-center gap-1.5 text-caption font-medium text-label-2">
              <StatusDot tone={axOverlay ? "green" : "neutral"} />
              AX overlay {axOverlay ? "on" : "off"}
            </span>
          )}
          <span aria-hidden className="mx-1 h-4 w-px bg-separator" />
          <IconButton size="md" label="Close console" onClick={() => set({ consoleOpen: false })}>
            <X />
          </IconButton>
        </div>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout" custom={dir}>
          <motion.div
            key={consoleTab}
            custom={dir}
            className="absolute inset-0"
            variants={{
              enter: (d: number) => ({ opacity: 0, x: 10 * d, filter: "blur(4px)" }),
              center: { opacity: 1, x: 0, filter: "blur(0px)" },
              exit: (d: number) => ({ opacity: 0, x: -10 * d, filter: "blur(4px)" }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={spring.ui}
          >
            {consoleTab === "logs" && <LogsView paused={paused} clearToken={clearToken} />}
            {consoleTab === "input" && <InputView />}
            {consoleTab === "accessibility" && <AccessibilityView />}
            {consoleTab === "web" && <WebView />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
