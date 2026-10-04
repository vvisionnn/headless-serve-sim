import { useContext, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { SimulatorRecordingSource } from "headless-serve-sim-client/simulator";
import {
  duoAxPolygons,
  duoHomeEdge,
  duoProjectedPoint,
  duoRawPointForProjection,
  duoWheelDelta,
} from "../duo-model";
import { AxSelectionContext, useAxSnapshotContext } from "../hooks/use-ax-snapshot";
import { axElementKey } from "../utils/ax";
import { duoViewport } from "../utils/duo-viewport";

const FINGER_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Ccircle cx='12' cy='12' r='9' fill='rgba(255,255,255,0.45)' stroke='rgba(0,0,0,0.55)' stroke-width='1.25' filter='drop-shadow(0 1px 2px rgba(0,0,0,0.45))'/%3E%3C/svg%3E") 12 12, pointer`;

type Composition = NonNullable<ReturnType<SimulatorRecordingSource["snapshot"]>>["composition"];
interface Props {
  sourceRef: MutableRefObject<SimulatorRecordingSource | null>;
  recordingSourceRef: MutableRefObject<SimulatorRecordingSource | null>;
  width: number;
  height: number;
  axEnabled: boolean;
  includeFrame?: boolean;
  onButton?: (button: string) => void;
  onTouch: (touch: {
    type: string;
    x: number;
    y: number;
    edge?: number;
    displayId?: number;
  }) => void;
  onMultiTouch?: (touch: {
    type: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    displayId?: number;
  }) => void;
  onScroll: (scroll: { x: number; y: number; dx: number; dy: number }) => void;
  onBoundsChange: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    fittedWidth: number;
    fittedHeight: number;
  }) => void;
}

export function NativeDuoDevice(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const composition = useRef<Composition>(undefined);
  const { snapshot } = useAxSnapshotContext();
  const selection = useContext(AxSelectionContext);
  const ax = useRef({ snapshot, selection });
  ax.current = { snapshot, selection };
  const redraw = useRef<(() => void) | null>(null);
  const buttonsRef = useRef<HTMLDivElement | null>(null);
  const fingersRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { desynchronized: true })!;
    let source: SimulatorRecordingSource | null = null;
    let unsubscribe: (() => void) | undefined;
    let frame = 0;
    let lastBounds = "";
    let crop = { x: 0, y: 0, width: 1, height: 1 };
    let presentedWidth = 0,
      presentedHeight = 0;
    const listeners = new Set<() => void>();
    const output: SimulatorRecordingSource = {
      snapshot: () =>
        composition.current &&
        (composition.current.includeFrame ?? true) === (latest.current.includeFrame ?? true)
          ? {
              source: canvas,
              width: canvas.width,
              height: canvas.height,
              surfaceWidth: presentedWidth,
              surfaceHeight: presentedHeight,
              orientation: "portrait",
              composition: composition.current,
              touches: [],
            }
          : null,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      get subscribeEncoded() {
        const encodedSource = props.sourceRef.current;
        return encodedSource?.subscribeEncoded?.bind(encodedSource);
      },
      get requestKeyframe() {
        const encodedSource = props.sourceRef.current;
        return encodedSource?.requestKeyframe?.bind(encodedSource);
      },
    };
    const outputRef = props.recordingSourceRef;
    outputRef.current = output;
    const paint = () => {
      const next = source?.snapshot();
      if (!next?.composition) return;
      const metadata = next.composition;
      composition.current = metadata;
      const view = duoViewport(
        metadata.bounds,
        next.width,
        next.height,
        latest.current.width,
        latest.current.height,
        metadata.scale,
      );
      crop = view.crop;
      const displayWidth = view.width,
        displayHeight = view.height;
      presentedWidth = displayWidth;
      presentedHeight = displayHeight;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      canvas.style.position = "absolute";
      canvas.style.left = `${(latest.current.width - displayWidth) / 2}px`;
      canvas.style.top = `${(latest.current.height - displayHeight) / 2}px`;
      if (canvas.width !== crop.width || canvas.height !== crop.height) {
        canvas.width = crop.width;
        canvas.height = crop.height;
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.setTransform(next.width, 0, 0, next.height, -crop.x, -crop.y);
      context.clip(new Path2D(metadata.mask), "evenodd");
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(
        next.source,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      context.restore();
      const fitted = duoViewport(
        metadata.bounds,
        next.width,
        next.height,
        latest.current.width,
        latest.current.height,
      );
      const bounds = {
        x: (latest.current.width - displayWidth) / 2,
        y: (latest.current.height - displayHeight) / 2,
        width: displayWidth,
        height: displayHeight,
        fittedWidth: fitted.width,
        fittedHeight: fitted.height,
      };
      const identity = Object.values(bounds).map(Math.round).join(":");
      if (identity !== lastBounds) {
        lastBounds = identity;
        latest.current.onBoundsChange(bounds);
      }
      const hardware = buttonsRef.current?.querySelectorAll<HTMLElement>("[data-duo-button]");
      hardware?.forEach((element) => {
        const button = metadata.buttons?.find(
          (button) => button.button === element.dataset.duoButton,
        );
        element.style.display = button && latest.current.includeFrame !== false ? "block" : "none";
        if (!button) return;
        const px = (button.point[0]! - metadata.bounds[0]!) / metadata.bounds[2]!,
          py = (button.point[1]! - metadata.bounds[1]!) / metadata.bounds[3]!;
        element.style.left = `${bounds.x + px * displayWidth}px`;
        element.style.top = `${bounds.y + py * displayHeight}px`;
        const dx = (button.outward[0]! - button.point[0]!) * next.width,
          dy = (button.outward[1]! - button.point[1]!) * next.height;
        const length = Math.hypot(dx, dy);
        element.style.setProperty("--duo-button-x", `${length ? (dx / length) * 32 : 32}px`);
        element.style.setProperty("--duo-button-y", `${length ? (dy / length) * 32 : 0}px`);
      });
      updateOverlay();
      updateFingers();
      listeners.forEach((listener) => listener());
    };
    const hit = (event: { clientX: number; clientY: number }, displayId?: number) => {
      const metadata = composition.current;
      if (!metadata) return null;
      const rect = canvas.getBoundingClientRect();
      const point = {
        x: metadata.bounds[0]! + ((event.clientX - rect.x) / rect.width) * metadata.bounds[2]!,
        y: metadata.bounds[1]! + ((event.clientY - rect.y) / rect.height) * metadata.bounds[3]!,
      };
      for (const piece of metadata.pieces) {
        if (piece.displayId !== (displayId ?? metadata.displayId)) continue;
        const raw = duoRawPointForProjection(point, piece);
        if (raw) return raw;
      }
      return null;
    };
    let touch: {
      pointerId: number;
      x: number;
      y: number;
      edge?: number;
      displayId: number;
    } | null = null;
    let multi: { x: number; y: number; pan: boolean } | null = null;
    let hoverPoint: { x: number; y: number } | null = null;
    let altHeld = false;
    const updateFingers = () => {
      const dots = fingersRef.current?.querySelectorAll<HTMLElement>("[data-duo-finger]");
      const metadata = composition.current;
      if (!dots || !metadata) return;
      const point = touch ?? (altHeld ? hoverPoint : null);
      const points = point
        ? [
            point,
            ...(multi || altHeld
              ? [
                  {
                    x: multi?.pan ? point.x + multi.x : 1 - point.x,
                    y: multi?.pan ? point.y + multi.y : 1 - point.y,
                  },
                ]
              : []),
          ]
        : [];
      const rect = canvas.getBoundingClientRect();
      dots.forEach((dot, index) => {
        const raw = points[index];
        const projected = raw
          ? metadata.pieces
              .filter((piece) => piece.displayId === (touch?.displayId ?? metadata.displayId))
              .map((piece) => duoProjectedPoint(raw, piece))
              .find((point) => point !== null)
          : null;
        dot.style.display = projected && !latest.current.axEnabled ? "block" : "none";
        if (!projected) return;
        dot.style.left = `${(latest.current.width - rect.width) / 2 + ((projected.x - metadata.bounds[0]!) / metadata.bounds[2]!) * rect.width}px`;
        dot.style.top = `${(latest.current.height - rect.height) / 2 + ((projected.y - metadata.bounds[1]!) / metadata.bounds[3]!) * rect.height}px`;
      });
    };
    const sendTouch = (type: string, point: { x: number; y: number }) => {
      if (multi) {
        latest.current.onMultiTouch?.({
          type,
          displayId: touch?.displayId,
          x1: point.x,
          y1: point.y,
          x2: multi.pan ? point.x + multi.x : 1 - point.x,
          y2: multi.pan ? point.y + multi.y : 1 - point.y,
        });
      } else
        latest.current.onTouch({ type, ...point, edge: touch?.edge, displayId: touch?.displayId });
    };
    const down = (event: PointerEvent) => {
      if (latest.current.axEnabled || touch || event.button !== 0) return;
      const point = hit(event);
      if (!point) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      const edge = duoHomeEdge(point, composition.current!.rawRotation);
      touch = {
        ...point,
        edge,
        pointerId: event.pointerId,
        displayId: composition.current!.displayId,
      };
      if (event.altKey && latest.current.onMultiTouch)
        multi = { x: 1 - 2 * point.x, y: 1 - 2 * point.y, pan: event.shiftKey };
      sendTouch("begin", point);
      updateFingers();
    };
    const move = (event: PointerEvent) => {
      hoverPoint = hit(event);
      altHeld = event.altKey;
      if (touch?.pointerId !== event.pointerId) {
        updateFingers();
        return;
      }
      const point = hit(event, touch.displayId);
      if (!point) return;
      touch = { ...touch, ...point };
      sendTouch("move", point);
      updateFingers();
    };
    const end = (event: PointerEvent) => {
      if (touch?.pointerId !== event.pointerId) return;
      const point = hit(event, touch.displayId) ?? touch;
      sendTouch("end", point);
      touch = null;
      multi = null;
      updateFingers();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const wheel = (event: WheelEvent) => {
      if (latest.current.axEnabled) return;
      const from = hit(event),
        metadata = composition.current;
      if (!from || !metadata) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? latest.current.height : 1;
      const dx = event.deltaX * unit,
        dy = event.deltaY * unit;
      const factor = Math.min(1, 2 / Math.max(Math.abs(dx), Math.abs(dy)));
      const to = hit({
        clientX: event.clientX + dx * factor,
        clientY: event.clientY + dy * factor,
      });
      if (!to) return;
      const delta = duoWheelDelta(from, to, metadata.rawWidth, metadata.rawHeight);
      latest.current.onScroll({ ...from, dx: -delta.dx / factor, dy: -delta.dy / factor });
      event.preventDefault();
    };
    const polygons = new Map<string, SVGPolygonElement>();
    const updateOverlay = () => {
      const overlay = overlayRef.current,
        metadata = composition.current;
      if (!overlay) return;
      if (!metadata || !latest.current.axEnabled || !ax.current.snapshot || !ax.current.selection) {
        overlay.replaceChildren();
        polygons.clear();
        return;
      }
      const rect = canvas.getBoundingClientRect(),
        owner = canvas.parentElement!.getBoundingClientRect();
      const active = new Set<string>();
      const ordered: SVGPolygonElement[] = [];
      const elements = [...ax.current.snapshot.elements].sort(
        (a, b) => b.frame.width * b.frame.height - a.frame.width * a.frame.height,
      );
      for (const element of elements) {
        const key = axElementKey(element);
        for (const [index, points] of duoAxPolygons(element.frame, metadata).entries()) {
          const identity = `${key}:${index}`;
          active.add(identity);
          let polygon = polygons.get(identity);
          if (!polygon) {
            polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            polygon.setAttribute("data-ax-key", key);
            polygon.setAttribute("role", "button");
            polygon.setAttribute("tabindex", "0");
            polygon.style.pointerEvents = "auto";
            polygon.style.cursor = "pointer";
            polygon.addEventListener("pointerenter", () =>
              ax.current.selection?.setHighlightedKey(key),
            );
            polygon.addEventListener("pointerleave", () =>
              ax.current.selection?.setHighlightedKey(null),
            );
            polygon.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              ax.current.selection?.setSelectedKey(key);
            });
            polygon.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                ax.current.selection?.setSelectedKey(key);
              }
            });
            polygons.set(identity, polygon);
            overlay.append(polygon);
          }
          polygon.setAttribute(
            "points",
            points
              .map(
                (point) =>
                  `${rect.left - owner.left + ((point.x - metadata.bounds[0]!) / metadata.bounds[2]!) * rect.width},${rect.top - owner.top + ((point.y - metadata.bounds[1]!) / metadata.bounds[3]!) * rect.height}`,
              )
              .join(" "),
          );
          ordered.push(polygon);
          polygon.setAttribute("data-ax-label", element.label);
          polygon.setAttribute("aria-label", element.label || element.role);
          const selected = ax.current.selection.selectedKey === key;
          const highlighted = ax.current.selection.highlightedKey === key;
          polygon.setAttribute("data-ax-selected", String(selected));
          polygon.setAttribute("fill", selected ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.06)");
          polygon.setAttribute(
            "stroke",
            selected || highlighted ? "var(--color-accent-solid)" : "var(--color-fg-3)",
          );
        }
      }
      for (const [index, polygon] of ordered.entries()) {
        const current = overlay.children[index];
        if (current !== polygon) overlay.insertBefore(polygon, current ?? null);
      }
      for (const [identity, polygon] of polygons) {
        if (active.has(identity)) continue;
        polygon.remove();
        polygons.delete(identity);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Alt") return;
      altHeld = event.type === "keydown";
      updateFingers();
    };
    const leave = () => {
      hoverPoint = null;
      updateFingers();
    };
    redraw.current = paint;
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("lostpointercapture", end);
    canvas.addEventListener("wheel", wheel, { passive: false });
    const tick = () => {
      if (source !== props.sourceRef.current) {
        unsubscribe?.();
        source = props.sourceRef.current;
        unsubscribe = source?.subscribe?.(paint);
        paint();
      }
      if (!composition.current) paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe?.();
      redraw.current = null;
      if (outputRef.current === output) outputRef.current = null;
      if (touch) sendTouch("end", touch);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", end);
      canvas.removeEventListener("pointercancel", end);
      canvas.removeEventListener("lostpointercapture", end);
      canvas.removeEventListener("wheel", wheel);
    };
  }, [props.sourceRef, props.recordingSourceRef]);
  useLayoutEffect(() => {
    redraw.current?.();
  }, [
    props.width,
    props.height,
    props.axEnabled,
    snapshot,
    selection?.selectedKey,
    selection?.highlightedKey,
  ]);
  return (
    <div className="relative" style={{ width: props.width, height: props.height }}>
      <canvas
        ref={canvasRef}
        data-duo-device
        style={{
          display: "block",
          width: props.width,
          height: props.height,
          touchAction: "none",
          cursor: FINGER_CURSOR,
        }}
      />
      <div ref={buttonsRef} className="duo-hardware-controls pointer-events-none absolute inset-0">
        {[
          ["lock", "Power"],
          ["volume_up", "Volume up"],
          ["volume_down", "Volume down"],
        ].map(([button, label]) => (
          <button
            key={button}
            type="button"
            data-duo-button={button}
            aria-label={label}
            className="duo-hardware-button pointer-events-auto absolute cursor-pointer"
            style={{ display: "none" }}
            onClick={() => props.onButton?.(button!)}
          >
            <span className="duo-hardware-icon">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {button === "lock" ? (
                  <>
                    <rect x="6" y="10" width="12" height="11" rx="2" />
                    <path d="M8 10V6a4 4 0 0 1 8 0v4" />
                  </>
                ) : (
                  <>
                    <path d="M11 4 6 8H3v8h3l5 4zM15 12h7" />
                    {button === "volume_up" && <path d="M18.5 8.5v7" />}
                  </>
                )}
              </svg>
            </span>
          </button>
        ))}
      </div>
      <div ref={fingersRef} className="pointer-events-none absolute inset-0" aria-hidden>
        {[0, 1].map((index) => (
          <span
            key={index}
            data-duo-finger={index}
            className="absolute"
            style={{
              display: "none",
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.45)",
              border: "1.25px solid rgba(0,0,0,0.55)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.45)",
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}
      </div>
      <svg
        ref={overlayRef}
        className="absolute inset-0 pointer-events-none"
        width={props.width}
        height={props.height}
      />
    </div>
  );
}
