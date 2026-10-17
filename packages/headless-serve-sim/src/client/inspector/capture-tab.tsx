import { AnimatePresence, motion } from "motion/react";
import { Copy, Download, Play } from "lucide-react";
import { ScreenRecordingTool } from "../components/screen-recording-tool";
import { ScreenshotTool } from "../components/screenshot-tool";
import type { StreamMode } from "../components/stream-mode-toggle";
import { spring } from "../lib/motion";
import { useShell, type Capture } from "../shell/shell-context";
import { IconButton } from "../ui/button";
import { Row, Section } from "../ui/group";
import { Segmented } from "../ui/segmented";
import type { InspectorProps } from "./types";

// clipboard.write / ClipboardItem only exist in a secure context, but this UI is
// also served to LAN clients over plain HTTP. Hide Copy rather than show it
// broken — Download is the fallback.
const canCopyImage = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.clipboard?.write === "function" &&
  typeof ClipboardItem !== "undefined";

export function CaptureTab(props: InspectorProps) {
  const { stream } = props;
  return (
    <>
      <ScreenshotTool udid={props.udid} displayId={props.displayId} foldable={props.foldable} />
      <ScreenRecordingTool
        recording={props.recording}
        streamControl={
          stream.modeAvailable && (
            <Row label="Stream" stacked>
              <Segmented<StreamMode>
                aria-label="Stream quality"
                size="sm"
                value={stream.mode}
                onChange={stream.onModeChange}
                items={[
                  { value: "perf", label: "Performance", disabled: !props.streaming },
                  { value: "quality", label: "Quality", disabled: !props.streaming },
                ]}
              />
            </Row>
          )
        }
      />
      <RecentSection />
    </>
  );
}

function Thumb({ capture }: { capture: Capture }) {
  return (
    <span className="relative flex h-10 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-fill-2 shadow-[0_0_0_0.5px_rgba(0,0,0,0.12)]">
      {capture.kind === "screenshot" ? (
        <img src={capture.url} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <>
          <video
            src={capture.url}
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 size-full object-cover"
          />
          <span className="relative flex size-4 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm">
            <Play className="ml-px size-2" fill="currentColor" strokeWidth={0} />
          </span>
        </>
      )}
    </span>
  );
}

const clock = (at: number) => new Date(at).toTimeString().slice(0, 5);

function download(capture: Capture) {
  const a = document.createElement("a");
  a.href = capture.url;
  a.download = capture.filename;
  a.click();
}

function RecentSection() {
  const { captures, toast } = useShell();
  const copyable = canCopyImage();
  const copy = async (capture: Capture) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [capture.blob.type]: capture.blob })]);
      toast({ title: "Copied to clipboard", tone: "success" });
    } catch (e: any) {
      toast({ title: "Copy failed", detail: e?.message, tone: "danger" });
    }
  };
  return (
    <Section title="Recent">
      {captures.length === 0 && (
        <p className="px-3 py-4 text-center text-footnote text-label-3">
          Screenshots and recordings from this session appear here.
        </p>
      )}
      <AnimatePresence initial={false}>
        {captures.map((c) => (
          <motion.div
            key={c.id}
            layout
            initial={{ opacity: 0, y: -8, filter: "blur(4px)", height: 0 }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)", height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring.ui}
            className="row overflow-hidden"
          >
            <div className="flex items-center gap-2.5 px-3 py-2">
              <Thumb capture={c} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body font-medium text-label">
                  {c.kind === "screenshot" ? "Screenshot" : "Recording"}
                </span>
                <span className="truncate font-mono text-caption text-label-3">{c.meta}</span>
              </span>
              <span className="font-mono text-caption text-label-3">{clock(c.createdAt)}</span>
              <span className="flex">
                {copyable && c.kind === "screenshot" && (
                  <IconButton label="Copy image" size="sm" onClick={() => void copy(c)}>
                    <Copy />
                  </IconButton>
                )}
                <IconButton label="Download" size="sm" onClick={() => download(c)}>
                  <Download />
                </IconButton>
              </span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </Section>
  );
}
