import { animate, motion, useMotionValue } from "motion/react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import {
  streamDisplayGeometry,
  type SimulatorRecordingSnapshot,
  type SimulatorRecordingSource,
} from "headless-serve-sim-client/simulator";
import { project, spring } from "../lib/motion";

const BUTTON_SIZE = 44;
const VIEWPORT_MARGIN = 8;
const DRAG_THRESHOLD = 4;
/** Resting corners sit this far from the viewport edges. */
const CORNER_INSET = 16;
/** Only pointer samples this recent count toward the release velocity. */
const VELOCITY_WINDOW_MS = 100;

type Point = { x: number; y: number };
type Sample = Point & { t: number };
type DragState = Point & {
  pointerId: number;
  clientX: number;
  clientY: number;
  moved: boolean;
  samples: Sample[];
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

/**
 * Where a thrown button comes to rest: project the release velocity forward
 * (Apple's momentum projection) and pick the corner nearest that landing spot,
 * so a flick lands in the corner it was heading for, not the one it left from.
 */
export function phoneFullscreenCorner(
  point: Point,
  velocity: Point,
  viewport: { width: number; height: number },
): Point {
  const landing = {
    x: point.x + project(velocity.x, 0.99),
    y: point.y + project(velocity.y, 0.99),
  };
  const left = CORNER_INSET;
  const right = viewport.width - BUTTON_SIZE - CORNER_INSET;
  const top = CORNER_INSET;
  const bottom = viewport.height - BUTTON_SIZE - CORNER_INSET;
  const corner = {
    x: Math.abs(landing.x - left) <= Math.abs(landing.x - right) ? left : right,
    y: Math.abs(landing.y - top) <= Math.abs(landing.y - bottom) ? top : bottom,
  };
  return clampPhoneFullscreenButton(corner, viewport);
}

/** Release velocity in px/s from the most recent pointer samples. */
export function releaseVelocity(samples: Sample[]): Point {
  const last = samples.at(-1);
  if (!last) return { x: 0, y: 0 };
  const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS) ?? last;
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
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
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [placed, setPlaced] = useState(false);
  const [dragging, setDragging] = useState(false);
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
    let first = true;
    // Start in the bottom-right corner; on resize, keep to whichever corner
    // the button is nearest.
    const place = () => {
      const viewport = currentPhoneViewport();
      const from = first ? { x: viewport.width, y: viewport.height } : { x: x.get(), y: y.get() };
      const corner = phoneFullscreenCorner(from, { x: 0, y: 0 }, viewport);
      x.jump(corner.x);
      y.jump(corner.y);
      first = false;
      setPlaced(true);
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
  }, [targetRef, x, y]);

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
    x.stop();
    y.stop();
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: x.get(),
      y: y.get(),
      moved: false,
      samples: [],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.clientX;
    const dy = event.clientY - drag.clientY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) setDragging(true);
    drag.moved = true;
    event.preventDefault();
    event.stopPropagation();
    const next = clampPhoneFullscreenButton(
      { x: drag.x + dx, y: drag.y + dy },
      currentPhoneViewport(),
    );
    x.set(next.x);
    y.set(next.y);
    drag.samples.push({ ...next, t: event.timeStamp });
    if (drag.samples.length > 8) drag.samples.shift();
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    if (drag.moved) {
      setDragging(false);
      // Thrown: carry the flick's velocity into a spring toward the corner it
      // was heading for.
      const velocity = releaseVelocity(drag.samples);
      const corner = phoneFullscreenCorner(
        { x: x.get(), y: y.get() },
        velocity,
        currentPhoneViewport(),
      );
      animate(x, corner.x, { ...spring.momentum, velocity: velocity.x });
      animate(y, corner.y, { ...spring.momentum, velocity: velocity.y });
    }
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
      <motion.button
        type="button"
        data-phone-fullscreen-toggle
        aria-label={label}
        title={label}
        disabled={preparingVideo}
        className="fixed top-0 left-0 z-50 flex size-11 cursor-grab items-center justify-center rounded-full text-white outline-none active:cursor-grabbing disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        style={{ x, y, touchAction: "none", visibility: placed ? "visible" : "hidden" }}
        animate={{ scale: dragging ? 1.08 : 1 }}
        whileTap={{ scale: dragging ? 1.08 : 0.92 }}
        transition={spring.snappy}
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
        {/* Glass over a live stream: dark enough to read on any frame. */}
        <span className="absolute inset-0 rounded-full bg-black/35 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.35),0_4px_14px_rgba(0,0,0,0.3)] backdrop-blur-xl" />
        {fullscreen ? (
          <Minimize2 className="relative size-[18px]" strokeWidth={2.2} aria-hidden />
        ) : (
          <Maximize2 className="relative size-[18px]" strokeWidth={2.2} aria-hidden />
        )}
      </motion.button>
    </>
  );
}
