import { expect, test } from "bun:test";
import { BufferSource, EncodedPacketSink, Input, MP4 } from "mediabunny";
import type {
  AvccEncodedEvent,
  SimulatorRecordingSource,
} from "headless-serve-sim-client/simulator";
import { NativeStreamRecorder } from "../client/native-stream-recorder";

const description = new Uint8Array([
  1, 100, 0, 60, 255, 225, 0, 17, 0x27, 0x64, 0, 0x3c, 0xac, 0x56, 0x80, 0x35, 0x80, 0x6b, 0x7b,
  0xb9, 0xa8, 8, 0x68, 8, 0x10, 1, 0, 5, 0x28, 0xee, 0x3c, 0xb0, 0,
]);
const picture = (
  keyframe: boolean,
  timestampMicroseconds: number,
  sequence: number,
): AvccEncodedEvent => ({
  type: "picture",
  keyframe,
  data: new Uint8Array([0, 0, 0, 2, keyframe ? 0x65 : 0x41, 0x80]),
  timestampMicroseconds,
  durationMicroseconds: 16667,
  sequence,
  composition: {
    angle: 180,
    rotation: 0,
    scale: 1,
    displayId: 3,
    rawWidth: 2007,
    rawHeight: 2853,
    rawRotation: 90,
    mask: "",
    bounds: [0, 0, 1, 1],
    pieces: [],
  },
});
function fixture() {
  let listener: ((event: AvccEncodedEvent) => void) | null = null;
  let requested = 0,
    now = 1000;
  const source: SimulatorRecordingSource = {
    snapshot: () => ({
      source: {} as CanvasImageSource,
      width: 2906,
      height: 2076,
      surfaceWidth: 700,
      surfaceHeight: 500,
      touches: [],
      composition: (picture(true, 0, 0) as Extract<AvccEncodedEvent, { type: "picture" }>)
        .composition,
    }),
    subscribeEncoded(next) {
      listener = next;
      next({ type: "description", data: description });
      return () => {
        listener = null;
      };
    },
    requestKeyframe() {
      requested++;
    },
  };
  const recorder = new NativeStreamRecorder(
    { source },
    {
      now: () => now,
      wallClock: () => 1700000000000,
      createObjectURL: () => "blob:native-recording",
      revokeObjectURL() {},
    },
  );
  return {
    recorder,
    emit: (event: AvccEncodedEvent) => listener?.(event),
    setNow: (value: number) => {
      now = value;
    },
    requested: () => requested,
    subscribed: () => Boolean(listener),
  };
}

test("native recording remuxes unchanged source packets on a stable full-density raster", async () => {
  const f = fixture();
  f.recorder.start();
  expect(f.requested()).toBe(1);
  f.emit(picture(false, 9_000_000, 3));
  f.emit(picture(true, 10_000_000, 4));
  f.setNow(1033);
  f.emit(picture(false, 10_080_000, 5));
  f.setNow(1200);
  const result = await f.recorder.stop();
  expect([result.width, result.height]).toEqual([3420, 3420]);
  const input = new Input({
    source: new BufferSource(await result.blob.arrayBuffer()),
    formats: [MP4],
  });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    expect([track.codedWidth, track.codedHeight]).toEqual([3420, 3420]);
    const packets = [];
    for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet);
    expect(packets).toHaveLength(2);
    expect(packets[0]!.data).toEqual(
      (picture(true, 0, 0) as Extract<AvccEncodedEvent, { type: "picture" }>).data,
    );
    expect(packets[1]!.data).toEqual(
      (picture(false, 0, 0) as Extract<AvccEncodedEvent, { type: "picture" }>).data,
    );
    expect(packets[0]!.timestamp).toBe(0);
    expect(packets[0]!.duration).toBeCloseTo(0.08, 5);
    expect(packets[1]!.timestamp).toBeCloseTo(0.08, 5);
    expect(packets[1]!.duration).toBeCloseTo(0.167, 5);
  } finally {
    input.dispose();
  }
});

test("native recording rejects a missing reference picture", async () => {
  const f = fixture();
  f.recorder.start();
  f.emit(picture(true, 10_000_000, 4));
  f.emit(picture(false, 10_016_667, 6));
  expect(f.recorder.state).toBe("error");
  expect(f.subscribed()).toBe(false);
  await expect(f.recorder.stop()).rejects.toThrow("encoded reference frame is missing");
});

test("native recording can resume at a new IDR after a sequence gap", async () => {
  const f = fixture();
  f.recorder.start();
  f.emit(picture(true, 10_000_000, 4));
  f.emit(picture(true, 10_080_000, 8));
  expect(f.recorder.state).toBe("recording");
  const result = await f.recorder.stop();
  expect(result.bytes).toBeGreaterThan(0);
});

test("native recording rejects invalid or nonmonotonic source time", async () => {
  for (const timestamp of [NaN, -1, 10_000_000, 9_999_999]) {
    const f = fixture();
    f.recorder.start();
    f.emit(picture(true, 10_000_000, 4));
    f.emit(picture(false, timestamp, 5));
    expect(f.recorder.state).toBe("error");
    await expect(f.recorder.stop()).rejects.toThrow(/timing|timestamps/);
  }
});

test("native recording fails rather than export across a source disconnect", async () => {
  const f = fixture();
  f.recorder.start();
  f.emit(picture(true, 10_000_000, 4));
  f.emit({ type: "error", error: new Error("encoded stream disconnected") });
  expect(f.recorder.state).toBe("error");
  expect(f.subscribed()).toBe(false);
  await expect(f.recorder.stop()).rejects.toThrow("encoded stream disconnected");
});

test("native recording rejects a changed stream configuration", async () => {
  const f = fixture();
  f.recorder.start();
  f.emit(picture(true, 10_000_000, 4));
  f.emit({ type: "description", data: new Uint8Array([1, 100, 0, 52]) });
  expect(f.recorder.state).toBe("error");
  await expect(f.recorder.stop()).rejects.toThrow("configuration changed");
});

test("native recording owns retained packet bytes", async () => {
  const f = fixture();
  f.recorder.start();
  const frame = picture(true, 10_000_000, 4) as Extract<AvccEncodedEvent, { type: "picture" }>;
  const original = frame.data.slice();
  f.emit(frame);
  frame.data.fill(0);
  const result = await f.recorder.stop();
  const input = new Input({
    source: new BufferSource(await result.blob.arrayBuffer()),
    formats: [MP4],
  });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    expect((await new EncodedPacketSink(track).getFirstPacket())!.data).toEqual(original);
  } finally {
    input.dispose();
  }
});

test("native recording cancels a pending finalize without publishing an artifact", async () => {
  const f = fixture();
  f.recorder.start();
  f.emit(picture(true, 10_000_000, 4));
  const stopped = f.recorder.stop();
  f.recorder.cancel();
  await expect(stopped).rejects.toThrow("cancelled");
  expect(f.recorder.state).toBe("cancelled");
});

test("finished native recording releases all muxer owners and keeps its artifact", async () => {
  const f = fixture();
  f.recorder.start();
  f.emit(picture(true, 10_000_000, 4));
  const result = await f.recorder.stop();
  const owners = f.recorder as unknown as { target: unknown; output: unknown; packets: unknown };
  expect([owners.target, owners.output, owners.packets].map((owner) => owner === null)).toEqual([
    true,
    true,
    true,
  ]);
  expect(await f.recorder.stop()).toBe(result);
  expect(result.bytes).toBeGreaterThan(0);
  f.recorder.cancel();
  expect(result.blob.size).toBe(result.bytes);
});

test("native recording cancel releases the encoded subscriber", () => {
  const f = fixture();
  f.recorder.start();
  expect(f.subscribed()).toBe(true);
  f.recorder.cancel();
  expect(f.recorder.state).toBe("cancelled");
  expect(f.subscribed()).toBe(false);
});
