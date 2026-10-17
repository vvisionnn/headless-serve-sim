import { AnimatePresence, motion } from "motion/react";
import {
  Accessibility,
  Globe,
  MousePointerClick,
  Pause,
  Play,
  RotateCw,
  ScrollText,
  Trash2,
  X,
} from "lucide-react";
import { useContext, useRef, useState } from "react";
import { AxSnapshotContext } from "../hooks/use-ax-snapshot";
import { useSimLogs } from "../hooks/use-sim-logs";
import type { useWebKitDevtools } from "../hooks/use-webkit-devtools";
import { spring } from "../lib/motion";
import { useShell, type ConsoleTab } from "../shell/shell-context";
import { StatusDot } from "../ui/badge";
import { IconButton } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { isAxeUnavailable } from "../utils/ax";
import { AccessibilityView } from "./accessibility-view";
import { InputView } from "./input-view";
import { LOG_STATUS, LogsView } from "./logs-view";
import { WebView } from "./web-view";

export interface ConsolePanelProps {
  udid: string;
  logsEndpoint: string | undefined;
  appProcessId: number | null;
  devtools: ReturnType<typeof useWebKitDevtools>;
  selectedDevtoolsTargetId: string | null;
  onSelectDevtoolsTarget: (id: string | null) => void;
}

const TABS: ConsoleTab[] = ["logs", "input", "accessibility", "web"];

function Status({
  tone,
  live,
  children,
}: {
  tone: "green" | "orange" | "red" | "neutral";
  live?: boolean;
  children: string;
}) {
  return (
    <span
      role="status"
      className="mr-1 flex items-center gap-1.5 text-caption font-medium whitespace-nowrap text-label-2"
    >
      <StatusDot tone={tone} live={live} />
      {children}
    </span>
  );
}

/** Bottom debug area: everything you read from the device, in one drawer. */
export function ConsolePanel({
  udid,
  logsEndpoint,
  appProcessId,
  devtools,
  selectedDevtoolsTargetId,
  onSelectDevtoolsTarget,
}: ConsolePanelProps) {
  const shell = useShell();
  const tab = shell.consoleTab;
  const [includeSystem, setIncludeSystem] = useState(false);
  const [clearToken, setClearToken] = useState(0);
  // Logs live here, not in the Logs view, so the stream and buffer survive
  // switching tabs and the header can drive pause/clear.
  const logs = useSimLogs(logsEndpoint, { appProcessId, includeSystem });
  const { snapshot } = useContext(AxSnapshotContext);

  const prev = useRef(tab);
  const dir = TABS.indexOf(tab) >= TABS.indexOf(prev.current) ? 1 : -1;
  prev.current = tab;

  const status = LOG_STATUS[logs.status];
  const axCount = snapshot && !isAxeUnavailable(snapshot) ? snapshot.elements.length : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b-[0.5px] border-separator px-2.5">
        <Segmented<ConsoleTab>
          size="sm"
          intrinsic
          aria-label="Console view"
          value={tab}
          onChange={shell.setConsoleTab}
          items={[
            { value: "logs", label: "Logs", icon: <ScrollText /> },
            { value: "input", label: "Input", icon: <MousePointerClick /> },
            { value: "accessibility", label: "Accessibility", icon: <Accessibility /> },
            { value: "web", label: "Web Inspector", icon: <Globe /> },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          {tab === "logs" && (
            <>
              <Status tone={status.tone} live={logs.status === "live"}>
                {status.label}
              </Status>
              <IconButton
                size="md"
                label={logs.paused ? "Resume" : "Pause"}
                aria-pressed={logs.paused}
                disabled={!logsEndpoint}
                onClick={() => logs.setPaused((paused) => !paused)}
              >
                {logs.paused ? <Play /> : <Pause />}
              </IconButton>
              <IconButton
                size="md"
                label="Clear"
                disabled={logs.entries.length === 0}
                onClick={() => {
                  logs.clear();
                  setClearToken((n) => n + 1);
                }}
              >
                <Trash2 />
              </IconButton>
            </>
          )}
          {tab === "accessibility" && (
            <Status tone={shell.axOverlayEnabled ? "green" : "neutral"}>
              {`${axCount ? `${axCount} elements · ` : ""}AX overlay ${shell.axOverlayEnabled ? "on" : "off"}`}
            </Status>
          )}
          {tab === "web" && (
            <IconButton
              size="md"
              label="Refresh targets"
              disabled={devtools.loading}
              onClick={() => void devtools.refresh()}
            >
              <RotateCw />
            </IconButton>
          )}
          <span aria-hidden className="mx-1 h-4 w-px bg-separator" />
          <IconButton size="md" label="Close console" onClick={() => shell.setConsoleOpen(false)}>
            <X />
          </IconButton>
        </div>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout" custom={dir}>
          <motion.div
            key={tab}
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
            {tab === "logs" && (
              <LogsView
                logs={logs}
                endpoint={logsEndpoint}
                appProcessId={appProcessId}
                includeSystem={includeSystem}
                onIncludeSystemChange={setIncludeSystem}
                clearToken={clearToken}
              />
            )}
            {tab === "input" && <InputView />}
            {tab === "accessibility" && <AccessibilityView />}
            {tab === "web" && (
              <WebView
                udid={udid}
                devtools={devtools}
                selectedTargetId={selectedDevtoolsTargetId}
                onSelectTarget={onSelectDevtoolsTarget}
                live={shell.consoleOpen}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
