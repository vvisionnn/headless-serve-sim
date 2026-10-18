// Protocol types for the device gateway wire protocol.

export type SimulatorOrientation =
  | "portrait"
  | "portrait_upside_down"
  | "landscape_left"
  | "landscape_right";

export interface SimulatorComposition {
  includeFrame?: boolean;
  angle: number;
  rotation: number;
  scale: number;
  displayId: number;
  rawWidth: number;
  rawHeight: number;
  rawRotation: number;
  mask: string;
  bounds: number[];
  pieces: { displayId: number; quad: number[][]; region: number[] }[];
  buttons?: {
    button: "lock" | "volume_up" | "volume_down";
    point: number[];
    outward: number[];
    along: number[];
  }[];
}

export interface StreamConfig {
  width: number;
  height: number;
  deviceComposition?: boolean;
  includeFrame?: boolean;
  /** Active native display, when the runtime exposes screen properties. */
  displayId?: number;
  /** Native display orientation, when known. */
  orientation?: SimulatorOrientation;
  /** Real interface orientation; `orientation` stays portrait under device composition. */
  interfaceOrientation?: SimulatorOrientation;
  /** The panel input lands on; width/height are raw panel pixels when known. */
  activeDisplay?: {
    id: number;
    rotation: number;
    orientation: SimulatorOrientation;
    width?: number;
    height?: number;
  };
}

export interface ExecMessage {
  type: "exec";
  id: string;
  command: string;
  args: string[];
}

export interface FileWriteMessage {
  type: "file:write";
  id: string;
  path: string;
  data: string;
  final: boolean;
}

export interface FileReadMessage {
  type: "file:read";
  id: string;
  path: string;
}

export type ClientMessage = ExecMessage | FileWriteMessage | FileReadMessage;

export interface ExecStdoutMessage {
  type: "exec:stdout";
  id: string;
  data: string;
}

export interface ExecStderrMessage {
  type: "exec:stderr";
  id: string;
  data: string;
}

export interface ExecDoneMessage {
  type: "exec:done";
  id: string;
  exitCode: number;
}

export interface ExecErrorMessage {
  type: "exec:error";
  id: string;
  error: string;
}

export interface FileDataMessage {
  type: "file:data";
  id: string;
  data: string;
}

export interface FileDoneMessage {
  type: "file:done";
  id: string;
}

export interface FileErrorMessage {
  type: "file:error";
  id: string;
  error: string;
}

export type ServerMessage =
  | ExecStdoutMessage
  | ExecStderrMessage
  | ExecDoneMessage
  | ExecErrorMessage
  | FileDataMessage
  | FileDoneMessage
  | FileErrorMessage;
