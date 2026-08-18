import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import {
  streamDisplayGeometry,
  type SimulatorRecordingSnapshot,
  type SimulatorRecordingSource,
} from "headless-serve-sim-client/simulator";

const BUTTON_SIZE = 44;
const VIEWPORT_MARGIN = 8;
const DRAG_THRESHOLD = 4;

type Point = { x: number; y: number };
type DragState = Point & {
  pointerId: number;
  clientX: number;
  clientY: number;
  moved: boolean;
};

type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type WebkitVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

export function shouldUseNativeVideoFullscreen(
  target: {
    requestFullscreen?: HTMLElement["requestFullscreen"];
    webkitRequestFullscreen?: WebkitElement["webkitRequestFullscreen"];
  } | null,
  video: { webkitEnterFullscreen?: WebkitVideo["webkitEnterFullscreen"] } | null,
): boolean {
  return (
    !target?.requestFullscreen && !target?.webkitRequestFullscreen && !!video?.webkitEnterFullscreen
  );
}

export function clampPhoneFullscreenButton(
  point: Point,
  viewport: { width: number; height: number },
): Point {
  return {
    x: Math.min(
      Math.max(VIEWPORT_MARGIN, point.x),
      Math.max(VIEWPORT_MARGIN, viewport.width - BUTTON_SIZE - VIEWPORT_MARGIN),
    ),
    y: Math.min(
      Math.max(VIEWPORT_MARGIN, point.y),
      Math.max(VIEWPORT_MARGIN, viewport.height - BUTTON_SIZE - VIEWPORT_MARGIN),
    ),
  };
}

export function fullscreenVideoGeometry(
  snapshot: Pick<
    SimulatorRecordingSnapshot,
    "width" | "height" | "orientation" | "surfaceWidth" | "surfaceHeight"
  >,
): { width: number; height: number; rotation: number } {
  const geometry = streamDisplayGeometry(snapshot);
  const rawIsLandscape = snapshot.width > snapshot.height;
  const displayIsLandscape = snapshot.surfaceWidth > snapshot.surfaceHeight;
  if (geometry.rotationDegrees === 0 && rawIsLandscape !== displayIsLandscape) {
    return { width: snapshot.height, height: snapshot.width, rotation: 90 };
  }
  return {
    width: geometry.displayConfig?.width ?? snapshot.width,
    height: geometry.displayConfig?.height ?? snapshot.height,
    rotation: geometry.rotationDegrees,
  };
}

function currentFullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function currentPhoneViewport(): { width: number; height: number } {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

export function PhoneFullscreenToggle({
  targetRef,
  recordingSourceRef,
}: {
  targetRef: RefObject<HTMLElement | null>;
  recordingSourceRef: RefObject<SimulatorRecordingSource | null>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoFullscreenRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [position, setPosition] = useState<Point | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [videoFallback, setVideoFallback] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current as WebkitVideo | null;
    const target = targetRef.current as WebkitElement | null;
    setVideoFallback(shouldUseNativeVideoFullscreen(target, video));
    const sync = () => setFullscreen(currentFullscreenElement() !== null);
    const beginVideoFullscreen = () => {
      videoFullscreenRef.current = true;
      setFullscreen(true);
      void video?.play().catch(() => {});
    };
    const endVideoFullscreen = () => {
      videoFullscreenRef.current = false;
      setFullscreen(false);
    };
    const place = () => {
      const viewport = currentPhoneViewport();
      setPosition((current) =>
        clampPhoneFullscreenButton(
          current ?? {
            x: viewport.width - BUTTON_SIZE - 12,
            y: viewport.height - BUTTON_SIZE - 20,
          },
          viewport,
        ),
      );
    };
    sync();
    place();
    video?.addEventListener("webkitbeginfullscreen", beginVideoFullscreen);
    video?.addEventListener("webkitendfullscreen", endVideoFullscreen);
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      video?.removeEventListener("webkitbeginfullscreen", beginVideoFullscreen);
      video?.removeEventListener("webkitendfullscreen", endVideoFullscreen);
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [targetRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (
      !videoFallback ||
      !video ||
      typeof HTMLCanvasElement.prototype.captureStream !== "function"
    ) {
      return;
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    let frame = 0;
    let lastPaintAt = 0;
    let stream: MediaStream | null = null;
    let activeSource: SimulatorRecordingSource | null = null;
    let unsubscribe: (() => void) | null = null;

    const replaceStream = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = canvas.captureStream(30);
      setVideoReady(false);
      video.srcObject = stream;
      void video.play().catch(() => {});
    };

    const paint = (source: SimulatorRecordingSource) => {
      try {
        const snapshot = source.snapshot();
        if (!snapshot) return;
        const geometry = fullscreenVideoGeometry(snapshot);
        const resized = canvas.width !== geometry.width || canvas.height !== geometry.height;
        if (resized) {
          canvas.width = geometry.width;
          canvas.height = geometry.height;
        }
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = "black";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate((geometry.rotation * Math.PI) / 180);
        context.drawImage(
          snapshot.source,
          -snapshot.width / 2,
          -snapshot.height / 2,
          snapshot.width,
          snapshot.height,
        );
        if (!stream || resized) replaceStream();
      } catch {}
    };

    const watch = (now: number) => {
      try {
        const source = recordingSourceRef.current;
        if (source !== activeSource) {
          unsubscribe?.();
          activeSource = source;
          unsubscribe = source?.subscribe ? source.subscribe(() => paint(source)) : null;
          if (source) {
            paint(source);
          } else {
            stream?.getTracks().forEach((track) => track.stop());
            stream = null;
            video.srcObject = null;
            setVideoReady(false);
          }
        }
        if (source && !source.subscribe && now - lastPaintAt >= 1000 / 30) {
          lastPaintAt = now;
          paint(source);
        }
      } finally {
        frame = requestAnimationFrame(watch);
      }
    };

    const ready = () => setVideoReady(video.readyState >= HTMLMediaElement.HAVE_METADATA);
    video.addEventListener("loadedmetadata", ready);
    video.addEventListener("canplay", ready);
    frame = requestAnimationFrame(watch);
    return () => {
      if (videoFullscreenRef.current) (video as WebkitVideo).webkitExitFullscreen?.();
      cancelAnimationFrame(frame);
      unsubscribe?.();
      stream?.getTracks().forEach((track) => track.stop());
      video.removeEventListener("loadedmetadata", ready);
      video.removeEventListener("canplay", ready);
      video.srcObject = null;
      setVideoReady(false);
    };
  }, [recordingSourceRef, videoFallback]);

  const toggleFullscreen = async () => {
    const doc = document as WebkitDocument;
    const video = videoRef.current as WebkitVideo | null;
    if (videoFullscreenRef.current || video?.webkitDisplayingFullscreen) {
      video?.webkitExitFullscreen?.();
      return;
    }
    if (currentFullscreenElement()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else await doc.webkitExitFullscreen?.();
      return;
    }
    const enterVideoFullscreen = () => {
      if (!videoReady || !video?.srcObject || !video.webkitEnterFullscreen) return;
      const playback = video.play();
      video.webkitEnterFullscreen();
      void playback.catch(() => {});
    };
    if (videoFallback) {
      enterVideoFullscreen();
      return;
    }
    const target = targetRef.current as WebkitElement | null;
    if (target?.requestFullscreen) await target.requestFullscreen({ navigationUI: "hide" });
    else if (target?.webkitRequestFullscreen) await target.webkitRequestFullscreen();
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    suppressClickRef.current = false;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: rect.left,
      y: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.clientX;
    const dy = event.clientY - drag.clientY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    event.preventDefault();
    event.stopPropagation();
    setPosition(
      clampPhoneFullscreenButton({ x: drag.x + dx, y: drag.y + dy }, currentPhoneViewport()),
    );
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.stopPropagation();
  };

  const cancelDrag = (event: PointerEvent<HTMLButtonElement>) => {
    finishDrag(event);
    suppressClickRef.current = false;
  };
  const preparingVideo = videoFallback && !videoReady;
  const label = preparingVideo
    ? "Preparing fullscreen video"
    : fullscreen
      ? "Exit fullscreen"
      : "Enter fullscreen";

  return (
    <>
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 size-px object-cover opacity-0"
      />
      <button
        type="button"
        data-phone-fullscreen-toggle
        aria-label={label}
        title={label}
        disabled={preparingVideo}
        className="fixed z-50 flex size-11 cursor-grab items-center justify-center rounded-sm border border-control-border bg-surface-3 text-fg shadow-overlay hover:bg-hover active:cursor-grabbing disabled:cursor-wait disabled:text-fg-3 focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--color-accent-solid)]"
        style={
          position
            ? { left: position.x, top: position.y, touchAction: "none" }
            : { right: 12, bottom: 20, touchAction: "none" }
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={cancelDrag}
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          void toggleFullscreen().catch(() => {});
        }}
      >
        {fullscreen ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
          </svg>
        )}
      </button>
    </>
  );
}
