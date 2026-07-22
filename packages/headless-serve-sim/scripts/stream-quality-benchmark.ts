import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type Rgb = readonly [red: number, green: number, blue: number];

export interface FrameAnalysis {
  status: "coherent" | "torn" | "invalid";
  dominantColor: number | null;
}

export interface RgbFrameReport {
  totalFrames: number;
  tornFrames: number;
  invalidFrames: number;
  frames: FrameAnalysis[];
}

const annexBStartCode = new Uint8Array([0, 0, 0, 1]);

function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function avccDescriptionToAnnexB(description: Uint8Array): {
  data: Uint8Array;
  nalLengthBytes: number;
} {
  if (description.byteLength < 7 || description[0] !== 1) {
    throw new Error("Invalid avcC decoder description");
  }
  const nalLengthBytes = (description[4]! & 0x03) + 1;
  let offset = 5;
  const parts: Uint8Array[] = [];

  const readParameterSets = (count: number) => {
    for (let index = 0; index < count; index++) {
      if (offset + 2 > description.byteLength) throw new Error("Truncated avcC parameter set");
      const length = (description[offset]! << 8) | description[offset + 1]!;
      offset += 2;
      if (offset + length > description.byteLength) throw new Error("Truncated avcC parameter set");
      parts.push(annexBStartCode, description.subarray(offset, offset + length));
      offset += length;
    }
  };

  const spsCount = description[offset]! & 0x1f;
  offset++;
  readParameterSets(spsCount);
  if (offset >= description.byteLength) throw new Error("Missing avcC PPS count");
  const ppsCount = description[offset]!;
  offset++;
  readParameterSets(ppsCount);

  return { data: joinBytes(parts), nalLengthBytes };
}

export function avccFrameToAnnexB(frame: Uint8Array, nalLengthBytes: number): Uint8Array {
  if (nalLengthBytes < 1 || nalLengthBytes > 4) {
    throw new Error(`Unsupported AVCC NAL length size: ${nalLengthBytes}`);
  }
  const parts: Uint8Array[] = [];
  let offset = 0;
  while (offset < frame.byteLength) {
    if (offset + nalLengthBytes > frame.byteLength) throw new Error("Truncated AVCC NAL length");
    let length = 0;
    for (let index = 0; index < nalLengthBytes; index++) {
      length = length * 256 + frame[offset + index]!;
    }
    offset += nalLengthBytes;
    if (length < 1 || offset + length > frame.byteLength)
      throw new Error("Truncated AVCC NAL unit");
    parts.push(annexBStartCode, frame.subarray(offset, offset + length));
    offset += length;
  }
  return joinBytes(parts);
}

export function extractJpegFrames(buffer: Uint8Array): {
  frames: Uint8Array[];
  remaining: Uint8Array;
} {
  const frames: Uint8Array[] = [];
  let cursor = 0;
  while (cursor < buffer.byteLength - 1) {
    let start = -1;
    for (let index = cursor; index < buffer.byteLength - 1; index++) {
      if (buffer[index] === 0xff && buffer[index + 1] === 0xd8) {
        start = index;
        break;
      }
    }
    if (start < 0) {
      const keepFrom = buffer.at(-1) === 0xff ? buffer.byteLength - 1 : buffer.byteLength;
      return { frames, remaining: buffer.subarray(keepFrom) };
    }

    let end = -1;
    for (let index = start + 2; index < buffer.byteLength - 1; index++) {
      if (buffer[index] === 0xff && buffer[index + 1] === 0xd9) {
        end = index + 2;
        break;
      }
    }
    if (end < 0) return { frames, remaining: buffer.subarray(start) };
    frames.push(buffer.slice(start, end));
    cursor = end;
  }
  return { frames, remaining: buffer.subarray(cursor) };
}

export function analyzeRgbFrames(
  data: Uint8Array,
  options: {
    width: number;
    height: number;
    palette: readonly Rgb[];
    maxColorDistance?: number;
  },
): RgbFrameReport {
  const { width, height, palette } = options;
  const frameBytes = width * height * 3;
  const totalFrames = Math.floor(data.byteLength / frameBytes);
  const maxDistanceSquared = (options.maxColorDistance ?? 100) ** 2;
  const minimumGenerationRows = Math.max(2, Math.ceil(height * 0.1));
  const frames: FrameAnalysis[] = [];

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const counts = Array<number>(palette.length).fill(0);
    let confidentRows = 0;

    for (let y = 0; y < height; y++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      const rowOffset = frameIndex * frameBytes + y * width * 3;
      for (let x = 0; x < width; x++) {
        const offset = rowOffset + x * 3;
        red += data[offset]!;
        green += data[offset + 1]!;
        blue += data[offset + 2]!;
      }
      red /= width;
      green /= width;
      blue /= width;

      let nearest = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let colorIndex = 0; colorIndex < palette.length; colorIndex++) {
        const color = palette[colorIndex]!;
        const distance = (red - color[0]) ** 2 + (green - color[1]) ** 2 + (blue - color[2]) ** 2;
        if (distance < nearestDistance) {
          nearest = colorIndex;
          nearestDistance = distance;
        }
      }
      if (nearestDistance <= maxDistanceSquared) {
        counts[nearest] = counts[nearest]! + 1;
        confidentRows++;
      }
    }

    const ranked = counts
      .map((count, color) => ({ color, count }))
      .sort((a, b) => b.count - a.count);
    const dominant = ranked[0];
    const runnerUp = ranked[1];
    const status =
      confidentRows < Math.ceil(height * 0.8)
        ? "invalid"
        : runnerUp && runnerUp.count >= minimumGenerationRows
          ? "torn"
          : "coherent";

    frames.push({
      status,
      dominantColor: dominant && dominant.count > 0 ? dominant.color : null,
    });
  }

  return {
    totalFrames,
    tornFrames: frames.filter((frame) => frame.status === "torn").length,
    invalidFrames: frames.filter((frame) => frame.status === "invalid").length,
    frames,
  };
}

const benchmarkPalette: Rgb[] = [
  [230, 45, 60],
  [35, 155, 85],
  [40, 95, 220],
  [240, 190, 35],
];

const patternPage = `<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<style>
  html, body, canvas { width: 100%; height: 100%; margin: 0; overflow: hidden; background: rgb(230 45 60); }
  canvas { display: block; }
</style>
<canvas></canvas>
<script>
  const colors = ${JSON.stringify(benchmarkPalette)};
  const canvas = document.querySelector("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  let generation = 0;
  function render() {
    const scale = devicePixelRatio || 1;
    const width = Math.max(1, Math.round(innerWidth * scale));
    const height = Math.max(1, Math.round(innerHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const color = colors[generation % colors.length];
    context.fillStyle = "rgb(" + color.join(" ") + ")";
    context.fillRect(0, 0, width, height);

    // Moving high-frequency detail stresses the encoder and bandwidth while the
    // middle 50% remains a uniform generation marker for the tearing detector.
    const sideWidth = Math.floor(width * 0.2);
    const stripe = Math.max(4, Math.floor(width / 80));
    for (let x = -stripe; x < sideWidth + stripe; x += stripe) {
      context.fillStyle = ((x / stripe + generation) & 1) ? "#f8f8f8" : "#080808";
      const shifted = x + (generation % stripe);
      context.fillRect(shifted, 0, stripe, height);
      context.fillRect(width - shifted - stripe, 0, stripe, height);
    }
    generation++;
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
</script>`;

export function makeBenchmarkPatternPage(workload: "motion" | "idle"): string {
  if (workload === "motion") return patternPage;
  return patternPage
    .replace("    requestAnimationFrame(render);", "")
    .replace("  requestAnimationFrame(render);\n</script>", "  render();\n</script>");
}

interface BenchmarkOptions {
  format: "avcc" | "mjpeg";
  workload: "motion" | "idle";
  streamUrl: string;
  udid: string;
  durationSeconds: number;
  minFps: number;
  minWindowFps: number;
  maxMbps: number;
  outputDirectory?: string;
}

interface CaptureResult {
  data: Uint8Array;
  inputFormat: "h264" | "mjpeg";
  frameTimesMs: number[];
  wireBytes: number;
  elapsedMs: number;
  avccChunks?: {
    keyframes: number;
    referenceDeltaFrames: number;
    disposableDeltaFrames: number;
    heartbeats: number;
  };
}

function parseArguments(args: string[]): BenchmarkOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const name = args[index]!;
    if (!name.startsWith("--")) throw new Error(`Unexpected argument: ${name}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    values.set(name, value);
    index++;
  }
  const streamUrl = values.get("--url");
  const udid = values.get("--udid");
  if (!streamUrl || !udid) {
    throw new Error(
      "Usage: bun run scripts/stream-quality-benchmark.ts --url http://127.0.0.1:PORT --udid UDID " +
        "[--format avcc|mjpeg] [--duration 6] [--min-fps 55] [--min-window-fps 50] " +
        "[--max-mbps 8] [--output DIR]",
    );
  }
  const positiveNumber = (name: string, fallback: number) => {
    const value = Number(values.get(name) ?? fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
    return value;
  };
  const format = values.get("--format") ?? "avcc";
  if (format !== "avcc" && format !== "mjpeg") {
    throw new Error("--format must be avcc or mjpeg");
  }
  const workload = values.get("--workload") ?? "motion";
  if (workload !== "motion" && workload !== "idle") {
    throw new Error("--workload must be motion or idle");
  }
  return {
    format,
    workload,
    streamUrl: streamUrl.replace(/\/$/, ""),
    udid,
    durationSeconds: positiveNumber("--duration", 6),
    minFps: positiveNumber("--min-fps", 55),
    minWindowFps: positiveNumber("--min-window-fps", 50),
    maxMbps: positiveNumber("--max-mbps", 8),
    outputDirectory: values.get("--output"),
  };
}

async function captureAvcc(
  url: string,
  durationSeconds: number,
  allowIdle: boolean,
): Promise<CaptureResult> {
  const controller = new AbortController();
  const response = await fetch(`${url}/stream.avcc`, { signal: controller.signal });
  if (!response.ok || !response.body) {
    throw new Error(`AVCC endpoint returned HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let decoderDescription: Uint8Array | null = null;
  let nalLengthBytes = 4;
  let startedAt: number | null = null;
  let started = false;
  let wireBytes = 0;
  let endedAt: number | null = null;
  const frameTimesMs: number[] = [];
  const recordingParts: Uint8Array[] = [];
  const avccChunks = {
    keyframes: 0,
    referenceDeltaFrames: 0,
    disposableDeltaFrames: 0,
    heartbeats: 0,
  };

  try {
    capture: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const merged = new Uint8Array(pending.byteLength + value.byteLength);
      merged.set(pending);
      merged.set(value, pending.byteLength);
      pending = merged;

      let offset = 0;
      while (pending.byteLength - offset >= 4) {
        const length = new DataView(pending.buffer, pending.byteOffset + offset, 4).getUint32(
          0,
          false,
        );
        if (length < 1) throw new Error("Invalid zero-length AVCC envelope");
        if (pending.byteLength - offset - 4 < length) break;
        const tag = pending[offset + 4]!;
        const payload = pending.subarray(offset + 5, offset + 4 + length);
        offset += 4 + length;

        const envelopeNow = performance.now();
        if (started && envelopeNow - startedAt! >= durationSeconds * 1000) {
          endedAt = envelopeNow;
          break capture;
        }
        if (started) wireBytes += 4 + length;
        if (started && tag === 0x05) avccChunks.heartbeats++;

        if (tag === 0x01) {
          const converted = avccDescriptionToAnnexB(payload);
          decoderDescription = converted.data;
          nalLengthBytes = converted.nalLengthBytes;
          if (started) recordingParts.push(decoderDescription);
          continue;
        }
        if (tag !== 0x02 && tag !== 0x03 && tag !== 0x06) continue;
        if (!started) {
          if (tag !== 0x02 || !decoderDescription) continue;
          recordingParts.push(decoderDescription);
          started = true;
          startedAt = performance.now();
          wireBytes += 4 + length;
        }

        const now = performance.now();
        if (tag === 0x02) avccChunks.keyframes++;
        else if (tag === 0x03) avccChunks.referenceDeltaFrames++;
        else avccChunks.disposableDeltaFrames++;
        frameTimesMs.push(now - startedAt!);
        recordingParts.push(avccFrameToAnnexB(payload, nalLengthBytes));
        if (now - startedAt! >= durationSeconds * 1000) break capture;
      }
      pending = pending.subarray(offset);
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }

  if (!started || frameTimesMs.length < (allowIdle ? 1 : 2)) {
    throw new Error("AVCC stream did not produce a decoder description and keyframe");
  }
  return {
    data: joinBytes(recordingParts),
    inputFormat: "h264",
    frameTimesMs,
    wireBytes,
    elapsedMs: (endedAt ?? performance.now()) - startedAt!,
    avccChunks,
  };
}

async function captureMjpeg(url: string, durationSeconds: number): Promise<CaptureResult> {
  const controller = new AbortController();
  const response = await fetch(`${url}/stream.mjpeg?raw=1`, { signal: controller.signal });
  if (!response.ok || !response.body) {
    throw new Error(`MJPEG endpoint returned HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let startedAt: number | null = null;
  let wireBytes = 0;
  const frameTimesMs: number[] = [];
  const recordingParts: Uint8Array[] = [];

  try {
    capture: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const merged = new Uint8Array(pending.byteLength + value.byteLength);
      merged.set(pending);
      merged.set(value, pending.byteLength);
      const extracted = extractJpegFrames(merged);
      pending = extracted.remaining;

      for (const frame of extracted.frames) {
        const now = performance.now();
        if (startedAt === null) startedAt = now;
        frameTimesMs.push(now - startedAt);
        wireBytes += frame.byteLength;
        recordingParts.push(frame);
        if (now - startedAt >= durationSeconds * 1000) break capture;
      }
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }

  if (startedAt === null || frameTimesMs.length < 2) {
    throw new Error("MJPEG stream did not produce at least two JPEG frames");
  }
  return {
    data: joinBytes(recordingParts),
    inputFormat: "mjpeg",
    frameTimesMs,
    wireBytes,
    elapsedMs: (frameTimesMs.at(-1) ?? 0) - frameTimesMs[0]!,
  };
}

function runFfmpeg(args: string[]): Uint8Array {
  const result = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout;
}

export function oneSecondFrameCounts(
  frameTimesMs: readonly number[],
  elapsedMs = frameTimesMs.at(-1) ?? 0,
): number[] {
  const fullWindows = Math.floor(elapsedMs / 1000);
  const counts: number[] = [];
  for (let window = 0; window < fullWindows; window++) {
    const start = window * 1000;
    const end = start + 1000;
    counts.push(frameTimesMs.filter((time) => time >= start && time < end).length);
  }
  return counts;
}

export function summarizeFrameIntervals(frameTimesMs: readonly number[]) {
  const intervals = frameTimesMs
    .slice(1)
    .map((time, index) => time - frameTimesMs[index]!)
    .sort((a, b) => a - b);
  const percentile = (fraction: number) => {
    if (intervals.length === 0) return 0;
    return intervals[Math.max(0, Math.ceil(intervals.length * fraction) - 1)]!;
  };
  return {
    p50Ms: Number(percentile(0.5).toFixed(2)),
    p95Ms: Number(percentile(0.95).toFixed(2)),
    p99Ms: Number(percentile(0.99).toFixed(2)),
    maxMs: Number((intervals.at(-1) ?? 0).toFixed(2)),
    over25Ms: intervals.filter((interval) => interval > 25).length,
    over50Ms: intervals.filter((interval) => interval > 50).length,
    over100Ms: intervals.filter((interval) => interval > 100).length,
  };
}

async function readPipelineMetrics(url: string): Promise<Record<string, number> | null> {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/stream-metrics`);
    if (!response.ok) return null;
    const json = (await response.json()) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(json).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  } catch {
    return null;
  }
}

function pipelineDelta(
  before: Record<string, number> | null,
  after: Record<string, number> | null,
) {
  if (!before || !after) return null;
  const delta: Record<string, number> = {};
  for (const [key, value] of Object.entries(after)) {
    if (typeof before[key] === "number") delta[key] = value - before[key]!;
  }
  delete delta.copyAvoidancePercent;
  delete delta.helperResidentBytes;
  const offered = delta.framesDemandingEncode ?? 0;
  const avoided = delta.busyFramesAvoidedCopy ?? 0;
  delta.busyCopyAvoidancePercent = offered > 0 ? Number(((avoided * 100) / offered).toFixed(2)) : 0;
  const cpuTicks = delta.helperCpuTicks ?? 0;
  const elapsedTicks = delta.helperSampleTicks ?? 0;
  delta.helperCpuAveragePercent =
    elapsedTicks > 0 ? Number(((cpuTicks * 100) / elapsedTicks).toFixed(2)) : 0;
  return delta;
}

async function runBenchmark(options: BenchmarkOptions): Promise<boolean> {
  let patternRequested = false;
  const patternServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      patternRequested = true;
      const page = makeBenchmarkPatternPage(options.workload);
      return new Response(page, {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        },
      });
    },
  });
  const temporaryOutput = !options.outputDirectory;
  const outputDirectory = options.outputDirectory
    ? resolve(options.outputDirectory)
    : mkdtempSync(join(tmpdir(), "headless-serve-sim-quality-"));
  mkdirSync(outputDirectory, { recursive: true });

  try {
    const patternUrl = `http://127.0.0.1:${patternServer.port}/`;
    const opened = Bun.spawnSync(["xcrun", "simctl", "openurl", options.udid, patternUrl], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (opened.exitCode !== 0) {
      throw new Error(`Could not open benchmark pattern: ${opened.stderr.toString().trim()}`);
    }
    const pageDeadline = performance.now() + 8_000;
    while (!patternRequested && performance.now() < pageDeadline) await Bun.sleep(50);
    if (!patternRequested) throw new Error("Simulator did not load the benchmark pattern");
    await Bun.sleep(1_500);

    const metricsBefore = await readPipelineMetrics(options.streamUrl);
    const capture =
      options.format === "avcc"
        ? await captureAvcc(options.streamUrl, options.durationSeconds, options.workload === "idle")
        : await captureMjpeg(options.streamUrl, options.durationSeconds);
    const metricsAfter = await readPipelineMetrics(options.streamUrl);
    const streamPath = join(outputDirectory, `stream-quality.${capture.inputFormat}`);
    const mp4Path = join(outputDirectory, "stream-quality.mp4");
    await Bun.write(streamPath, capture.data);
    if (capture.inputFormat === "h264") {
      runFfmpeg([
        "-fflags",
        "+genpts",
        "-r",
        "60",
        "-i",
        streamPath,
        "-c:v",
        "copy",
        "-movflags",
        "+faststart",
        mp4Path,
      ]);
    } else {
      runFfmpeg([
        "-f",
        "mjpeg",
        "-r",
        "60",
        "-i",
        streamPath,
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-movflags",
        "+faststart",
        mp4Path,
      ]);
    }
    const rgb = runFfmpeg([
      "-f",
      capture.inputFormat,
      "-i",
      streamPath,
      "-vf",
      "crop=trunc(iw*0.5/2)*2:trunc(ih*0.5/2)*2:trunc(iw*0.25/2)*2:trunc(ih*0.25/2)*2,scale=16:64:flags=area",
      "-fps_mode",
      "passthrough",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    const frameReport = analyzeRgbFrames(rgb, {
      width: 16,
      height: 64,
      palette: benchmarkPalette,
    });
    const elapsedMs = capture.elapsedMs;
    const firstToLastMs = (capture.frameTimesMs.at(-1) ?? 0) - capture.frameTimesMs[0]!;
    const averageFps =
      options.workload === "motion" && capture.frameTimesMs.length > 1
        ? ((capture.frameTimesMs.length - 1) * 1000) / firstToLastMs
        : capture.frameTimesMs.length / (elapsedMs / 1000);
    const windowCounts = oneSecondFrameCounts(capture.frameTimesMs, elapsedMs);
    const minimumWindowFps = windowCounts.length > 0 ? Math.min(...windowCounts) : 0;
    const megabitsPerSecond = (capture.wireBytes * 8) / elapsedMs / 1000;
    const frameIntervals = summarizeFrameIntervals(capture.frameTimesMs);
    const failures: string[] = [];
    if (frameReport.tornFrames !== 0) failures.push(`${frameReport.tornFrames} torn frame(s)`);
    if (frameReport.invalidFrames !== 0)
      failures.push(`${frameReport.invalidFrames} unclassifiable frame(s)`);
    if (frameReport.totalFrames !== capture.frameTimesMs.length) {
      failures.push(
        `captured ${capture.frameTimesMs.length} frame(s), decoded ${frameReport.totalFrames}`,
      );
    }
    if (options.workload === "motion" && averageFps < options.minFps)
      failures.push(`average FPS ${averageFps.toFixed(2)} < ${options.minFps}`);
    if (options.workload === "motion" && minimumWindowFps < options.minWindowFps) {
      failures.push(`minimum 1s FPS ${minimumWindowFps} < ${options.minWindowFps}`);
    }
    if (megabitsPerSecond > options.maxMbps) {
      failures.push(`bandwidth ${megabitsPerSecond.toFixed(2)} Mbps > ${options.maxMbps} Mbps`);
    }
    const result = {
      pass: failures.length === 0,
      format: options.format,
      workload: options.workload,
      durationSeconds: elapsedMs / 1000,
      capturedFrames: capture.frameTimesMs.length,
      decodedFrames: frameReport.totalFrames,
      tornFrames: frameReport.tornFrames,
      invalidFrames: frameReport.invalidFrames,
      averageFps: Number(averageFps.toFixed(2)),
      oneSecondFps: windowCounts,
      minimumOneSecondFps: minimumWindowFps,
      bandwidthMbps: Number(megabitsPerSecond.toFixed(2)),
      avccChunks: capture.avccChunks,
      frameIntervals,
      pipeline: pipelineDelta(metricsBefore, metricsAfter),
      recording: temporaryOutput ? undefined : mp4Path,
      failures,
    };
    console.log(JSON.stringify(result, null, 2));
    return result.pass;
  } finally {
    await patternServer.stop(true);
    if (temporaryOutput) rmSync(outputDirectory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  try {
    const passed = await runBenchmark(parseArguments(Bun.argv.slice(2)));
    process.exitCode = passed ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (import.meta.main) void main();
