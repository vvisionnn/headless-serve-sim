import {
  commandName,
  type CommandRequest,
  type CommandResult,
  type CommandTask,
  type HostCommands,
} from "../runtime/host-commands";

export class HostCommandDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostCommandDeniedError";
  }
}

export function createDenyHostCommands(
  reason = "Host command execution is disabled",
): HostCommands {
  const denied = (detail: string): never => {
    throw new HostCommandDeniedError(`${reason}: ${detail}`);
  };

  const run = ((
    request: CommandRequest,
    _mode?: "sync",
  ): Promise<CommandResult> | CommandResult => {
    return denied(commandName(request));
  }) as HostCommands["run"];

  return {
    run,
    start(request: CommandRequest): CommandTask {
      return denied(commandName(request));
    },
    signal(pid: number, signal: NodeJS.Signals | 0): boolean {
      return denied(`signal ${signal} for pid ${pid}`);
    },
  };
}
