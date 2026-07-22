import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export interface PerformanceStage {
  label: string;
  result: Record<string, unknown>;
}

interface MetricSpec {
  label: string;
  path: string;
  unit: string;
  direction: "higher" | "lower";
}

const METRICS: readonly MetricSpec[] = [
  { label: "Average FPS", path: "quality.averageFps", unit: "fps", direction: "higher" },
  {
    label: "Minimum 1 s FPS",
    path: "quality.minimumOneSecondFps",
    unit: "fps",
    direction: "higher",
  },
  {
    label: "Frame interval p95",
    path: "quality.frameIntervals.p95Ms",
    unit: "ms",
    direction: "lower",
  },
  {
    label: "Frame interval p99",
    path: "quality.frameIntervals.p99Ms",
    unit: "ms",
    direction: "lower",
  },
  {
    label: "Frame interval max",
    path: "quality.frameIntervals.maxMs",
    unit: "ms",
    direction: "lower",
  },
  {
    label: "Intervals over 25 ms",
    path: "quality.frameIntervals.over25Ms",
    unit: "frames",
    direction: "lower",
  },
  {
    label: "Helper CPU average",
    path: "hostProcess.cpuAveragePercent",
    unit: "%",
    direction: "lower",
  },
  {
    label: "Helper CPU p95",
    path: "hostProcess.cpuP95Percent",
    unit: "%",
    direction: "lower",
  },
  {
    label: "Maximum RSS",
    path: "hostProcess.rssMaxMb",
    unit: "MB",
    direction: "lower",
  },
  {
    label: "Bandwidth",
    path: "quality.bandwidthMbps",
    unit: "Mbps",
    direction: "lower",
  },
  {
    label: "Framebuffer offers",
    path: "quality.pipeline.framesOffered",
    unit: "frames",
    direction: "lower",
  },
  {
    label: "Snapshots required",
    path: "quality.pipeline.snapshotsRequired",
    unit: "frames",
    direction: "lower",
  },
  {
    label: "JPEG encodes admitted",
    path: "quality.pipeline.jpegAdmitted",
    unit: "frames",
    direction: "lower",
  },
];

function numericAt(value: Record<string, unknown>, path: string): number | null {
  let current: unknown = value;
  for (const component of path.split(".")) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[component];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

export function improvementPercent(
  baseline: number,
  candidate: number,
  direction: "higher" | "lower",
): number | null {
  if (baseline === 0) return null;
  const raw = ((candidate - baseline) / Math.abs(baseline)) * 100;
  return Number((direction === "higher" ? raw : -raw).toFixed(1));
}

function display(value: number | null, unit: string): string {
  if (value === null) return "—";
  const rounded = Number(value.toFixed(2));
  return `${rounded} ${unit}`;
}

export function renderPerformanceReport(
  baseline: PerformanceStage,
  candidates: readonly PerformanceStage[],
): string {
  const lines = [
    `# Stream performance: ${baseline.label} baseline`,
    "",
    "Positive percentages mean an improvement in the desired direction. A dash means the baseline was zero or the metric was unavailable.",
    "",
  ];

  for (const candidate of candidates) {
    lines.push(
      `## ${candidate.label}`,
      "",
      "| Metric | Baseline | Candidate | Improvement |",
      "| --- | ---: | ---: | ---: |",
    );
    for (const metric of METRICS) {
      const before = numericAt(baseline.result, metric.path);
      const after = numericAt(candidate.result, metric.path);
      const improvement =
        before === null || after === null
          ? null
          : improvementPercent(before, after, metric.direction);
      lines.push(
        `| ${metric.label} | ${display(before, metric.unit)} | ${display(after, metric.unit)} | ${improvement === null ? "—" : `${improvement > 0 ? "+" : ""}${improvement}%`} |`,
      );
    }
    const tears = numericAt(candidate.result, "quality.tornFrames");
    const invalid = numericAt(candidate.result, "quality.invalidFrames");
    lines.push(
      "",
      `Quality guard: ${tears ?? "—"} torn frames; ${invalid ?? "—"} invalid frames.`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseArguments(args: string[]) {
  let baseline: string | null = null;
  let output: string | null = null;
  const stages: Array<{ label: string; path: string }> = [];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error(`Invalid argument near ${flag}`);
    if (flag === "--baseline") baseline = value;
    else if (flag === "--output") output = value;
    else if (flag === "--stage") {
      const separator = value.indexOf("=");
      if (separator <= 0) throw new Error("--stage must be LABEL=PATH");
      stages.push({ label: value.slice(0, separator), path: value.slice(separator + 1) });
    } else throw new Error(`Unknown argument ${flag}`);
  }
  if (!baseline || !output || stages.length === 0) {
    throw new Error(
      "Usage: bun run scripts/stream-performance-report.ts --baseline FILE --stage LABEL=FILE [--stage LABEL=FILE] --output REPORT.md",
    );
  }
  return { baseline: resolve(baseline), output: resolve(output), stages };
}

async function readStage(path: string, label?: string): Promise<PerformanceStage> {
  const result = (await Bun.file(path).json()) as Record<string, unknown>;
  return { label: label ?? String(result.label ?? "baseline"), result };
}

async function run(): Promise<void> {
  const options = parseArguments(Bun.argv.slice(2));
  const baseline = await readStage(options.baseline);
  const candidates = await Promise.all(
    options.stages.map((stage) => readStage(resolve(stage.path), stage.label)),
  );
  const report = renderPerformanceReport(baseline, candidates);
  mkdirSync(dirname(options.output), { recursive: true });
  await Bun.write(options.output, report);
  process.stdout.write(report);
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
