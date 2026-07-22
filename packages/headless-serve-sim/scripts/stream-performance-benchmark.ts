import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface SimulatorRecord {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
}

interface SimulatorInventory {
  devices?: Record<string, SimulatorRecord[]>;
}

export interface ProcessSample {
  cpuPercent: number;
  rssKb: number;
}

export function subtractNumericMetrics(
  after: Record<string, unknown>,
  before: Record<string, unknown>,
): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const [key, value] of Object.entries(after)) {
    const previous = before[key];
    if (typeof value === "number" && typeof previous === "number") delta[key] = value - previous;
  }
  return delta;
}

export function assertIsolatedSimulator(
  inventory: SimulatorInventory,
  udid: string,
): SimulatorRecord {
  const device = Object.values(inventory.devices ?? {})
    .flat()
    .find((candidate) => candidate.udid === udid);
  if (!device) throw new Error(`Simulator ${udid} was not found`);
  if (!device.name.startsWith("serve-sim-perf-") || device.state !== "Booted") {
    throw new Error(
      `Simulator ${udid} is not isolated: expected a booted device named serve-sim-perf-*`,
    );
  }
  return device;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

export function summarizeProcessSamples(samples: readonly ProcessSample[]) {
  const cpus = samples.map((sample) => sample.cpuPercent);
  const rss = samples.map((sample) => sample.rssKb / 1024);
  const average = (values: readonly number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  const rounded = (value: number) => Number(value.toFixed(2));
  return {
    samples: samples.length,
    cpuAveragePercent: rounded(average(cpus)),
    cpuP95Percent: rounded(percentile(cpus, 0.95)),
    cpuMaxPercent: rounded(Math.max(0, ...cpus)),
    rssAverageMb: rounded(average(rss)),
    rssMaxMb: rounded(Math.max(0, ...rss)),
  };
}

function parseArguments(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value)
      throw new Error(`Invalid argument near ${name ?? "end"}`);
    values.set(name, value);
  }
  const url = values.get("--url");
  const udid = values.get("--udid");
  const pid = Number(values.get("--pid"));
  const duration = Number(values.get("--duration") ?? "12");
  const workload = values.get("--workload") ?? "motion";
  const label = values.get("--label") ?? "stream-performance";
  const output = resolve(values.get("--output") ?? `/tmp/${label}.json`);
  if (
    !url ||
    !udid ||
    !Number.isInteger(pid) ||
    pid <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    (workload !== "motion" && workload !== "idle")
  ) {
    throw new Error(
      "Usage: bun run scripts/stream-performance-benchmark.ts --url URL --udid UDID --pid PID " +
        "[--duration 12] [--workload motion|idle] [--label baseline] [--output /tmp/baseline.json]",
    );
  }
  return { url, udid, pid, duration, workload, label, output };
}

function readInventory(): SimulatorInventory {
  const result = Bun.spawnSync(["xcrun", "simctl", "list", "devices", "-j"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim());
  return JSON.parse(result.stdout.toString()) as SimulatorInventory;
}

function sampleProcess(pid: number): ProcessSample | null {
  const result = Bun.spawnSync(["ps", "-p", String(pid), "-o", "%cpu=,rss="], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const [cpu, rss] = result.stdout.toString().trim().split(/\s+/).map(Number);
  return Number.isFinite(cpu) && Number.isFinite(rss) ? { cpuPercent: cpu!, rssKb: rss! } : null;
}

async function readStreamMetrics(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/stream-metrics`);
    return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function run(): Promise<void> {
  const options = parseArguments(Bun.argv.slice(2));
  const simulator = assertIsolatedSimulator(readInventory(), options.udid);
  const artifactDirectory = resolve(dirname(options.output), `${options.label}-artifacts`);
  mkdirSync(artifactDirectory, { recursive: true });
  const metricsBefore = await readStreamMetrics(options.url);

  const benchmark = Bun.spawn(
    [
      "bun",
      resolve(import.meta.dir, "stream-quality-benchmark.ts"),
      "--url",
      options.url,
      "--udid",
      options.udid,
      "--format",
      "avcc",
      "--workload",
      options.workload,
      "--duration",
      String(options.duration),
      "--min-fps",
      "1",
      "--min-window-fps",
      "1",
      "--max-mbps",
      "100",
      "--output",
      artifactDirectory,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const samples: ProcessSample[] = [];
  const timer = setInterval(() => {
    const sample = sampleProcess(options.pid);
    if (sample) samples.push(sample);
  }, 200);
  const stdoutPromise = new Response(benchmark.stdout).text();
  const stderrPromise = new Response(benchmark.stderr).text();
  const exitCode = await benchmark.exited;
  clearInterval(timer);
  const stdout = await stdoutPromise;
  const stderr = await stderrPromise;
  if (exitCode !== 0) throw new Error(stderr.trim() || stdout.trim());
  const metricsAfter = await readStreamMetrics(options.url);
  const pipeline =
    metricsBefore && metricsAfter ? subtractNumericMetrics(metricsAfter, metricsBefore) : null;
  if (pipeline) {
    delete pipeline.copyAvoidancePercent;
    const offered = pipeline.framesOffered ?? 0;
    const skipped = pipeline.snapshotsSkippedBeforeCopy ?? 0;
    pipeline.copyAvoidancePercent =
      offered > 0 ? Number(((skipped * 100) / offered).toFixed(2)) : 0;
  }
  const quality = JSON.parse(stdout) as { pipeline?: Record<string, number> };

  const result = {
    label: options.label,
    simulator: { name: simulator.name, udid: simulator.udid },
    helperPid: options.pid,
    measuredAt: new Date().toISOString(),
    quality,
    hostProcess: summarizeProcessSamples(samples),
    pipeline: quality.pipeline ?? pipeline,
  };
  mkdirSync(dirname(options.output), { recursive: true });
  await Bun.write(options.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
