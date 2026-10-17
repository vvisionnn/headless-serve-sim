import { AnimatePresence, motion } from "motion/react";
import { Hand, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import {
  durationLabel,
  useRecordingElapsed,
  type ScreenRecording,
} from "../hooks/use-screen-recording";
import { spring } from "../lib/motion";
import type { RecordingFormat } from "../screen-recorder";
import { Button } from "../ui/button";
import { Row, Section } from "../ui/group";
import { Segmented } from "../ui/segmented";
import { Switch } from "../ui/switch";

export {
  frameSelectionAfterDeviceChange,
  recordingFormatSupport,
  recordingFrameDescription,
} from "../hooks/use-screen-recording";

/**
 * Screen recording section of the Capture tab. All recorder state lives in
 * useScreenRecording (owned by client.tsx); this only presents it. The record
 * button morphs into a timer capsule while recording.
 */
export function ScreenRecordingTool({
  recording,
  streamControl,
}: {
  recording: ScreenRecording;
  /** Optional "Stream" row (native H.264 only), rendered between Format and touches. */
  streamControl?: ReactNode;
}) {
  const busy = recording.status !== "idle";
  return (
    <Section title="Screen recording">
      <Row label="Format">
        <Segmented<RecordingFormat>
          aria-label="Recording format"
          size="sm"
          className="w-[188px]"
          value={recording.format}
          onChange={recording.setFormat}
          items={[
            { value: "auto", label: "Auto", disabled: busy || !recording.support.auto },
            { value: "mp4", label: "MP4", disabled: busy || !recording.support.mp4 },
            { value: "webm", label: "WebM", disabled: busy || !recording.support.webm },
          ]}
        />
      </Row>
      {streamControl}
      <Row
        label="Show touches"
        icon={<Hand />}
        detail={
          recording.touchMarkersAvailable
            ? undefined
            : "Touch markers are unavailable in the 3D view."
        }
      >
        <Switch
          label="Show touches"
          checked={recording.showTouches}
          disabled={busy || !recording.touchMarkersAvailable}
          onChange={recording.setShowTouches}
        />
      </Row>
      <Row label="Device frame" detail={recording.frameDescription} icon={<Smartphone />}>
        <Switch
          label="Device frame"
          checked={recording.deviceFrame}
          disabled={busy || !recording.deviceFrameAvailable}
          onChange={recording.setDeviceFrame}
        />
      </Row>
      <div className="row flex flex-col gap-2 px-3 py-2.5">
        <RecordControl recording={recording} />
        {recording.notice && (
          <p role="status" className="text-footnote text-label-2">
            {recording.notice}
          </p>
        )}
        {recording.error && (
          <p role="alert" className="text-footnote text-red [overflow-wrap:anywhere]">
            {recording.error}
          </p>
        )}
      </div>
    </Section>
  );
}

function RecordControl({ recording }: { recording: ScreenRecording }) {
  const { status } = recording;
  const busy = status !== "idle";
  const elapsed = useRecordingElapsed(recording.startedAt);
  return (
    <motion.div layout transition={spring.ui} className="flex items-center gap-2">
      <AnimatePresence initial={false} mode="popLayout">
        {busy && (
          <motion.span
            key="timer"
            layout
            role="status"
            initial={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
            transition={spring.ui}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full bg-red/10 px-3 text-red"
          >
            <span className="live-dot size-2 shrink-0 rounded-full bg-red text-red" />
            <span className="truncate text-footnote font-semibold">
              {status === "preparing"
                ? "Preparing recorder…"
                : status === "finishing"
                  ? "Finishing…"
                  : "Recording"}
            </span>
            {status === "recording" && (
              <span className="ml-auto font-mono text-footnote font-semibold tabular">
                {durationLabel(elapsed)}
              </span>
            )}
          </motion.span>
        )}
      </AnimatePresence>
      <motion.div layout transition={spring.ui} className={busy ? "" : "flex-1"}>
        {busy ? (
          <Button
            variant="secondary"
            size="lg"
            block
            disabled={status === "finishing"}
            onClick={recording.stop}
          >
            <span className="size-2.5 rounded-[3px] bg-red" />
            {status === "preparing" ? "Cancel" : "Stop"}
          </Button>
        ) : (
          <Button
            variant="record"
            size="lg"
            block
            disabled={!recording.available}
            onClick={recording.start}
          >
            <span className="size-2.5 rounded-full bg-white" />
            {recording.artworkLoading ? "Preparing frame…" : "Start recording"}
          </Button>
        )}
      </motion.div>
    </motion.div>
  );
}
