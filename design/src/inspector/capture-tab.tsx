import { AnimatePresence, motion } from "motion/react";
import { Camera, Copy, Download, Hand, Play, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { spring } from "../lib/motion";
import { useApp } from "../lib/store";
import { Button, IconButton } from "../ui/button";
import { Row, Section } from "../ui/group";
import { Shortcut } from "../ui/kbd";
import { Segmented } from "../ui/segmented";
import { Switch } from "../ui/switch";

export function CaptureTab() {
  return (
    <>
      <ScreenshotSection />
      <RecordingSection />
      <RecentSection />
    </>
  );
}

function ScreenshotSection() {
  const { screenshot } = useApp();
  const [display, setDisplay] = useState<"default" | "internal" | "external">("default");
  const [mask, setMask] = useState<"default" | "ignored" | "alpha" | "black">("default");
  return (
    <Section title="Screenshot">
      <Row label="Display" stacked>
        <Segmented
          aria-label="Display"
          size="sm"
          value={display}
          onChange={setDisplay}
          items={[
            { value: "default", label: "Default" },
            { value: "internal", label: "Internal" },
            { value: "external", label: "External" },
          ]}
        />
      </Row>
      <Row label="Mask" stacked>
        <Segmented
          aria-label="Mask"
          size="sm"
          value={mask}
          onChange={setMask}
          items={[
            { value: "default", label: "Default" },
            { value: "ignored", label: "Ignored" },
            { value: "alpha", label: "Alpha" },
            { value: "black", label: "Black" },
          ]}
        />
      </Row>
      <div className="row px-3 py-2.5">
        <Button variant="primary" size="lg" block onClick={screenshot} className="justify-between pr-2">
          <span className="flex items-center gap-1.5">
            <Camera /> Take screenshot
          </span>
          <Shortcut keys={["⌘", "S"]} className="[&_kbd]:bg-on-ink/15 [&_kbd]:text-on-ink/80 [&_kbd]:shadow-none" />
        </Button>
      </div>
    </Section>
  );
}

function useElapsed(since: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [since]);
  const s = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function RecordingSection() {
  const { recording, recordStartedAt, toggleRecording } = useApp();
  const [format, setFormat] = useState<"auto" | "mp4" | "webm">("auto");
  const [quality, setQuality] = useState<"performance" | "quality">("performance");
  const [touches, setTouches] = useState(true);
  const [frame, setFrame] = useState(true);
  const elapsed = useElapsed(recordStartedAt);
  return (
    <Section title="Screen recording">
      <Row label="Format">
        <Segmented
          aria-label="Format"
          size="sm"
          className="w-[188px]"
          value={format}
          onChange={setFormat}
          items={[
            { value: "auto", label: "Auto" },
            { value: "mp4", label: "MP4" },
            { value: "webm", label: "WebM" },
          ]}
        />
      </Row>
      <Row label="Stream" stacked>
        <Segmented
          aria-label="Stream quality"
          size="sm"
          value={quality}
          onChange={setQuality}
          items={[
            { value: "performance", label: "Performance" },
            { value: "quality", label: "Quality" },
          ]}
        />
      </Row>
      <Row label="Show touches" icon={<Hand />}>
        <Switch label="Show touches" checked={touches} onChange={setTouches} />
      </Row>
      <Row label="Device frame" detail="iPhone 17 Pro frame" icon={<Smartphone />}>
        <Switch label="Device frame" checked={frame} onChange={setFrame} />
      </Row>
      <div className="row px-3 py-2.5">
        <motion.div layout transition={spring.ui} className="flex items-center gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {recording && (
              <motion.span
                key="timer"
                layout
                initial={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
                transition={spring.ui}
                className="flex h-8 flex-1 items-center gap-2 rounded-full bg-red/10 px-3 text-red"
              >
                <span className="live-dot size-2 rounded-full bg-red text-red" />
                <span className="text-footnote font-semibold">Recording</span>
                <span className="ml-auto font-mono text-footnote font-semibold tabular">{elapsed}</span>
              </motion.span>
            )}
          </AnimatePresence>
          <motion.div layout transition={spring.ui} className={recording ? "" : "flex-1"}>
            <Button variant={recording ? "secondary" : "record"} size="lg" block onClick={toggleRecording}>
              {recording ? (
                <>
                  <span className="size-2.5 rounded-[3px] bg-red" /> Stop
                </>
              ) : (
                <>
                  <span className="size-2.5 rounded-full bg-white" /> Start recording
                </>
              )}
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </Section>
  );
}

function Thumb({ kind }: { kind: "screenshot" | "recording" }) {
  return (
    <span
      className="relative flex h-10 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[6px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.12)]"
      style={{ background: "radial-gradient(70% 50% at 25% 20%,#8fb4ff,transparent),radial-gradient(70% 50% at 80% 80%,#ffb08a,transparent),linear-gradient(180deg,#a9bcff,#e8c2ff 60%,#ffc9a8)" }}
    >
      {kind === "recording" && (
        <span className="flex size-4 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm">
          <Play className="ml-px size-2" fill="currentColor" strokeWidth={0} />
        </span>
      )}
    </span>
  );
}

function RecentSection() {
  const { captures, toast } = useApp();
  return (
    <Section title="Recent">
      {captures.length === 0 && <p className="px-3 py-4 text-center text-footnote text-label-3">Screenshots and recordings appear here.</p>}
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
              <Thumb kind={c.kind} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body font-medium text-label">{c.kind === "screenshot" ? "Screenshot" : "Recording"}</span>
                <span className="truncate font-mono text-caption text-label-3">{c.meta}</span>
              </span>
              <span className="font-mono text-caption text-label-3">{c.at}</span>
              <span className="flex">
                <IconButton label="Copy" size="sm" onClick={() => toast({ title: "Copied to clipboard" })}>
                  <Copy />
                </IconButton>
                <IconButton label="Download" size="sm">
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
