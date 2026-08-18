import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SimulatorView, type SimulatorRecordingSource } from "headless-serve-sim-client/simulator";
import { PhoneFullscreenToggle } from "./phone-fullscreen-toggle";

export interface PhonePreviewConfig {
  mode?: "phone";
  device: string;
  url: string;
  wsUrl: string;
  codec?: "auto" | "mjpeg";
}

export function PhonePreview({ config }: { config: PhonePreviewConfig }) {
  const previewRef = useRef<HTMLElement | null>(null);
  const recordingSourceRef = useRef<SimulatorRecordingSource | null>(null);
  const [connectionKey, setConnectionKey] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const streamedRef = useRef(false);
  const streamingRef = useRef(false);
  const retryDelayRef = useRef(1_000);

  useEffect(() => {
    streamingRef.current = streaming;
    if (streaming) {
      streamedRef.current = true;
      retryDelayRef.current = 1_000;
    }
  }, [streaming]);

  useEffect(() => {
    if (streaming || !streamedRef.current) return;
    const delay = retryDelayRef.current;
    const timer = setTimeout(() => {
      retryDelayRef.current = Math.min(delay * 2, 10_000);
      setConnectionKey((key) => key + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [streaming, connectionKey]);

  useEffect(() => {
    const reconnect = () => {
      retryDelayRef.current = 1_000;
      setConnectionKey((key) => key + 1);
    };
    const reconnectIfStale = () => {
      if (document.visibilityState === "visible" && !streamingRef.current) reconnect();
    };
    document.addEventListener("visibilitychange", reconnectIfStale);
    window.addEventListener("online", reconnect);
    return () => {
      document.removeEventListener("visibilitychange", reconnectIfStale);
      window.removeEventListener("online", reconnect);
    };
  }, []);

  return (
    <main
      ref={previewRef}
      data-phone-preview
      className="fixed inset-0 h-screen w-screen overflow-hidden bg-black [height:100dvh]"
      style={{ touchAction: "none", overscrollBehavior: "none" }}
    >
      <SimulatorView
        key={connectionKey}
        url={config.url}
        wsUrl={config.wsUrl}
        codec={config.codec === "mjpeg" ? "mjpeg" : "avcc"}
        hideControls
        onStreamingChange={setStreaming}
        recordingSourceRef={recordingSourceRef}
        style={{ width: "100%", height: "100%", border: "none" }}
        imageStyle={{ borderRadius: 0 } as CSSProperties}
      />
      <PhoneFullscreenToggle targetRef={previewRef} recordingSourceRef={recordingSourceRef} />
    </main>
  );
}
