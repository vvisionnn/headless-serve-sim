// Pure chart math for the Activity tab's CPU/memory gauges. Extracted from
// metrics-bar.tsx so the memory y-range floor and the CPU load tone can be
// tested in isolation. Presentation only — no DOM, no React.

// y-range floor so idle memory jitter reads flat
export const MEM_MIN_SPAN = 160 * 1024 * 1024;

export function cpuTone(pct: number | null): "neutral" | "green" | "orange" | "red" {
  if (pct == null) return "neutral";
  if (pct >= 80) return "red";
  if (pct >= 50) return "orange";
  return "green";
}

// The memory gauge auto-ranges around its own min/max with a MEM_MIN_SPAN floor
// (so an idle app's flat trace still reads as a band, not a glued-to-axis
// line), inflates by 1.15, and clamps the floor to 0. With no samples yet it
// centers on the latest memory reading.
export function memoryRange(
  values: number[],
  fallbackBytes: number,
): { yMin: number; yMax: number } {
  const memHi = values.length ? Math.max(...values) : fallbackBytes;
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
