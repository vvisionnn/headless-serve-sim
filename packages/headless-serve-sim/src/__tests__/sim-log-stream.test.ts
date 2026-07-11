import { describe, expect, test } from "bun:test";
import { EventEmitter } from "events";
import {
  buildSimLogStreamArgs,
  createSimLogLineFramer,
  parseSimLogLevel,
  startSimulatorLogStream,
} from "../sim-log-stream";

describe("simulator log stream options", () => {
  test("accepts only the log levels supported by simctl", () => {
    expect(parseSimLogLevel(undefined)).toBe("info");
    expect(parseSimLogLevel("")).toBeNull();
    expect(parseSimLogLevel("default")).toBe("default");
    expect(parseSimLogLevel("info")).toBe("info");
    expect(parseSimLogLevel("debug")).toBe("debug");
    expect(parseSimLogLevel("fault --predicate TRUEPREDICATE")).toBeNull();
  });

  test("builds an argv-only simctl command for the selected device and level", () => {
    expect(buildSimLogStreamArgs("DEVICE-123", "debug")).toEqual([
      "simctl",
      "spawn",
      "DEVICE-123",
      "log",
      "stream",
      "--style",
      "ndjson",
      "--level",
      "debug",
    ]);
  });
});

describe("createSimLogLineFramer", () => {
  test("reassembles fragmented lines and emits multiple complete NDJSON values", () => {
    const framer = createSimLogLineFramer(64);
    expect(framer.push('{"eventMes')).toEqual([]);
    expect(framer.push('sage":"one"}\n{"eventMessage":"two"}\r\n')).toEqual([
      '{"eventMessage":"one"}',
      '{"eventMessage":"two"}',
    ]);
  });

  test("drops oversized complete and unterminated lines without poisoning later logs", () => {
    const framer = createSimLogLineFramer(16);
    expect(framer.push(`${"x".repeat(20)}\n`)).toEqual([]);
    expect(framer.push("y".repeat(20))).toEqual([]);
    expect(framer.push('\n{"ok":1}\n')).toEqual(['{"ok":1}']);
  });
});

describe("startSimulatorLogStream", () => {
  test("frames SSE, pauses on backpressure, resumes on drain, and cleans up once", () => {
    const stdout = new EventEmitter() as EventEmitter & {
      pause: () => void;
      resume: () => void;
      destroy: () => void;
    };
    let pauses = 0;
    let resumes = 0;
    let destroys = 0;
    stdout.pause = () => { pauses++; };
    stdout.resume = () => { resumes++; };
    stdout.destroy = () => { destroys++; };

    const child = new EventEmitter() as EventEmitter & {
      stdout: typeof stdout;
      kill: () => void;
    };
    child.stdout = stdout;
    let kills = 0;
    child.kill = () => { kills++; };

    const response = new EventEmitter() as EventEmitter & {
      writableEnded: boolean;
      writes: string[];
      write: (chunk: string) => boolean;
      end: () => void;
    };
    response.writableEnded = false;
    response.writes = [];
    response.write = (chunk) => {
      response.writes.push(chunk);
      return response.writes.length > 1;
    };
    response.end = () => { response.writableEnded = true; };

    const stop = startSimulatorLogStream({
      udid: "DEVICE-123",
      level: "info",
      response: response as never,
      spawnProcess: (() => child) as never,
    });

    stdout.emit("data", Buffer.from('{"eventMessage":"hello"}\n'));
    expect(response.writes).toEqual(['data: {"eventMessage":"hello"}\n\n']);
    expect(pauses).toBe(1);

    stdout.emit("data", Buffer.from('{"eventMessage":"queued"}\n'));
    expect(response.writes).toEqual(['data: {"eventMessage":"hello"}\n\n']);

    response.emit("drain");
    expect(response.writes).toEqual([
      'data: {"eventMessage":"hello"}\n\n',
      'data: {"eventMessage":"queued"}\n\n',
    ]);
    expect(resumes).toBe(1);

    stop();
    stop();
    expect(destroys).toBe(1);
    expect(kills).toBe(1);
  });

  test("keeps only a bounded live tail while an adversarial source ignores pause", () => {
    const stdout = new EventEmitter() as EventEmitter & {
      pause: () => void;
      resume: () => void;
      destroy: () => void;
    };
    stdout.pause = () => {};
    stdout.resume = () => {};
    stdout.destroy = () => {};

    const child = new EventEmitter() as EventEmitter & {
      stdout: typeof stdout;
      kill: () => void;
    };
    child.stdout = stdout;
    child.kill = () => {};

    const response = new EventEmitter() as EventEmitter & {
      writableEnded: boolean;
      writes: string[];
      write: (chunk: string) => boolean;
      end: () => void;
    };
    response.writableEnded = false;
    response.writes = [];
    response.write = (chunk) => {
      response.writes.push(chunk);
      return response.writes.length > 1;
    };
    response.end = () => { response.writableEnded = true; };

    const stop = startSimulatorLogStream({
      udid: "DEVICE-123",
      level: "info",
      response: response as never,
      spawnProcess: (() => child) as never,
      maxPendingBytes: 64,
    });

    stdout.emit("data", Buffer.from('{"eventMessage":"initial"}\n'));
    stdout.emit("data", Buffer.from('{"eventMessage":"queued-one"}\n'));
    stdout.emit("data", Buffer.from('{"eventMessage":"queued-two"}\n'));
    expect(response.writes).toEqual(['data: {"eventMessage":"initial"}\n\n']);

    response.emit("drain");
    expect(response.writes).toEqual([
      'data: {"eventMessage":"initial"}\n\n',
      'data: {"eventMessage":"queued-two"}\n\n',
    ]);
    stop();
  });
});
