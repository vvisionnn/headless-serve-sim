// Pure chart math for the Activity rail's CPU/memory gauges. Extracted from
// metrics-bar.tsx so the right-anchored sparkline scaling, the memory y-range
// floor, and the CPU load coloring can be tested in isolation. Presentation
// only — no DOM, no React.

// y-range floor so idle memory jitter reads flat
export const MEM_MIN_SPAN = 160 * 1024 * 1024;

export function cpuColor(pct: number | null): string {
  if (pct == null) return "var(--color-fg-3)";
  if (pct >= 80) return "var(--color-danger)";
  if (pct >= 50) return "var(--color-warning)";
  return "var(--color-success)";
}

// "219 MB" -> ["219", "MB"]; "—" -> ["—", ""].
export function splitValueUnit(s: string): [string, string] {
  const i = s.indexOf(" ");
  return i === -1 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

// The memory gauge auto-ranges around its own min/max with a MEM_MIN_SPAN floor
// (so an idle app's flat trace still reads as a band, not a glued-to-axis
// line), inflates by 1.15, and clamps the floor to 0. With no samples yet it
// centers on the latest RSS reading.
export function memoryRange(
  values: number[],
  fallbackRss: number,
): { yMin: number; yMax: number } {
  const memHi = values.length ? Math.max(...values) : fallbackRss;
  const memLo = values.length ? Math.min(...values) : 0;
  const memMid = (memHi + memLo) / 2;
  const memSpan = Math.max(memHi - memLo, MEM_MIN_SPAN) * 1.15;
  let yMin = memMid - memSpan / 2;
  let yMax = memMid + memSpan / 2;
  if (yMin < 0) {
    yMax -= yMin;
    yMin = 0;
  }
  return { yMin, yMax };
}

export interface Sparkline {
  line: string;
  area: string;
  tip: [number, number];
}

// Right-anchored sparkline scaled into [yMin, yMax]; newest sample pins to the
// right edge. Returns the stroke path, a closed area (to the baseline), and the
// latest point so the chart reads as live telemetry. A small top/bottom margin
// keeps a flat/idle series a visible line + band, never glued to the axis.
export function buildSparkline(
  values: number[],
  yMin: number,
  yMax: number,
  w: number,
  h: number,
  maxSamples: number,
): Sparkline | null {
  if (values.length < 2 || w <= 0 || h <= 0) return null;
  const span = yMax - yMin || 1;
  const dx = w / (maxSamples - 1);
  const n = values.length;
  const topPad = 6;
  const baseY = h - 4;
  const usableH = Math.max(1, baseY - topPad);
  const xy = values.map((v, i) => {
    const x = w - (n - 1 - i) * dx;
    const clamped = Math.max(yMin, Math.min(yMax, v));
    const frac = (clamped - yMin) / span;
    const y = topPad + (1 - frac) * usableH;
    return [x, y] as const;
  });
  const line = `M${xy.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")}`;
  const x0 = xy[0]![0];
  const xN = xy[xy.length - 1]![0];
  const area = `${line} L${xN.toFixed(1)} ${baseY.toFixed(1)} L${x0.toFixed(1)} ${baseY.toFixed(1)} Z`;
  return { line, area, tip: xy[xy.length - 1]! as [number, number] };
}
