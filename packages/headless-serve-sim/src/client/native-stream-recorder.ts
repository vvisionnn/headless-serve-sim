import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import {
  avcCodecString,
  type AvccEncodedEvent,
  type SimulatorRecordingSource,
} from "headless-serve-sim-client/simulator";
import {
  recordingFilename,
  type RecordingArtifact,
  type ScreenRecorderState,
} from "./screen-recorder";

type Picture = Extract<AvccEncodedEvent, { type: "picture" }>;
interface Options {
  source: SimulatorRecordingSource;
  onError?: (error: Error) => void;
}
interface Platform {
  now(): number;
  wallClock(): number;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export class NativeStreamRecorder {
  private readonly target = new BufferTarget();
  private readonly output = new Output({ format: new Mp4OutputFormat(), target: this.target });
  private readonly packets = new EncodedVideoPacketSource("avc");
  private description: Uint8Array | null = null;
  private pending: { picture: Picture; receivedAt: number } | null = null;
  private firstTimestamp = 0;
  private firstPacket = true;
  private startedWallClock = 0;
  private unsubscribe: (() => void) | null = null;
  private writes: Promise<void> = Promise.resolve();
  private stopPromise: Promise<RecordingArtifact> | null = null;
  private failure: Error | null = null;
  private artifactUrl: string | null = null;
  private _state: ScreenRecorderState = "idle";

  constructor(
    private readonly options: Options,
    private readonly platform: Platform = {
      now: () => performance.now(),
      wallClock: () => Date.now(),
      createObjectURL: (blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
    },
  ) {}

  get state(): ScreenRecorderState {
    return this._state;
  }

  start(): void {
    if (this._state !== "idle") throw new Error("screen recorder has already been started");
    if (!this.options.source.snapshot()?.composition || !this.options.source.subscribeEncoded) {
      throw new Error("native encoded source is unavailable");
    }
    this.output.addVideoTrack(this.packets);
    this.writes = this.output.start();
    this.startedWallClock = this.platform.wallClock();
    this._state = "recording";
    try {
      this.unsubscribe = this.options.source.subscribeEncoded((event) => this.receive(event));
      this.options.source.requestKeyframe?.();
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private receive(event: AvccEncodedEvent): void {
    if (this._state !== "recording") return;
    if (event.type === "error") {
      this.fail(event.error);
      return;
    }
    if (event.type === "description") {
      if (
        this.description &&
        (event.data.length !== this.description.length ||
          !event.data.every((byte, index) => byte === this.description![index]))
      ) {
        this.fail(new Error("encoded stream configuration changed"));
      } else this.description = event.data.slice();
      return;
    }
    if (
      !Number.isSafeInteger(event.timestampMicroseconds) ||
      event.timestampMicroseconds < 0 ||
      !Number.isSafeInteger(event.durationMicroseconds) ||
      event.durationMicroseconds <= 0 ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence < 0
    ) {
      this.fail(new Error("encoded frame timing is invalid"));
      return;
    }
    if (!this.pending) {
      if (!event.keyframe) return;
      if (!this.description) {
        this.fail(new Error("encoded stream configuration is unavailable"));
        return;
      }
      this.firstTimestamp = event.timestampMicroseconds;
    } else {
      const previous = this.pending.picture;
      if (event.timestampMicroseconds <= previous.timestampMicroseconds) {
        this.fail(new Error("encoded frame timestamps are not increasing"));
        return;
      }
      if (event.sequence !== previous.sequence + 1 && !event.keyframe) {
        this.fail(new Error("encoded reference frame is missing"));
        return;
      }
      this.write(previous, event.timestampMicroseconds - previous.timestampMicroseconds);
    }
    this.pending = {
      picture: { ...event, data: event.data.slice() },
      receivedAt: this.platform.now(),
    };
  }

  private write(picture: Picture, durationMicroseconds: number): void {
    const packet = new EncodedPacket(
      picture.data,
      picture.keyframe ? "key" : "delta",
      (picture.timestampMicroseconds - this.firstTimestamp) / 1_000_000,
      durationMicroseconds / 1_000_000,
    );
    const metadata = this.firstPacket
      ? {
          decoderConfig: {
            codec: avcCodecString(this.description!),
            codedWidth: 3420,
            codedHeight: 3420,
            description: this.description! as Uint8Array<ArrayBuffer>,
          },
        }
      : undefined;
    this.firstPacket = false;
    this.writes = this.writes
      .then(() => this.packets.add(packet, metadata))
      .catch((error) => this.fail(error));
  }

  stop(): Promise<RecordingArtifact> {
    if (this.stopPromise) return this.stopPromise;
    if (this.failure) return Promise.reject(this.failure);
    if (this._state !== "recording")
      return Promise.reject(new Error("screen recorder is not recording"));
    const pending = this.pending;
    if (!pending) {
      this.fail(new Error("encoded keyframe is unavailable"));
      return Promise.reject(this.failure!);
    }
    this._state = "stopping";
    this.unsubscribe?.();
    this.unsubscribe = null;
    const durationMicroseconds = Math.max(
      pending.picture.durationMicroseconds,
      Math.round((this.platform.now() - pending.receivedAt) * 1000),
    );
    this.write(pending.picture, durationMicroseconds);
    this.pending = null;
    this.stopPromise = (async () => {
      await this.writes;
      if (this.failure) throw this.failure;
      if (this.state === "cancelled") throw new Error("screen recording was cancelled");
      try {
        await this.output.finalize();
        if (this.output.state === "canceled") throw new Error("screen recording was cancelled");
        const mimeType = "video/mp4";
        const blob = new Blob([this.target.buffer!], { type: mimeType });
        this.artifactUrl = this.platform.createObjectURL(blob);
        this._state = "finished";
        return {
          blob,
          url: this.artifactUrl,
          filename: recordingFilename(new Date(this.startedWallClock), mimeType),
          mimeType,
          durationSeconds:
            (pending.picture.timestampMicroseconds - this.firstTimestamp + durationMicroseconds) /
            1_000_000,
          bytes: blob.size,
          width: 3420,
          height: 3420,
        };
      } catch (error) {
        this.fail(error);
        throw this.failure ?? error;
      }
    })();
    return this.stopPromise;
  }

  cancel(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pending = null;
    this._state = "cancelled";
    void this.output.cancel().catch(() => {});
    if (this.artifactUrl) this.platform.revokeObjectURL(this.artifactUrl);
    this.artifactUrl = null;
  }

  private fail(error: unknown): void {
    if (this._state === "error" || this._state === "cancelled") return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this._state = "error";
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pending = null;
    void this.output.cancel().catch(() => {});
    this.options.onError?.(this.failure);
  }
}
