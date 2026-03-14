import { execa } from 'execa';

import type { AdapterCommandSpec, CommandExecutionResult, CommandRunner } from './types.js';

interface ExecaCommandRunnerOptions {
  stdout?: unknown;
  stderr?: unknown;
  stdin?: unknown;
  detached?: boolean;
  cleanup?: boolean;
}

export const createExecaCommandRunner = (
  options: ExecaCommandRunnerOptions = {}
): CommandRunner => {
  return async (spec: AdapterCommandSpec): Promise<CommandExecutionResult> => {
    const result = await execa(spec.command, spec.args, {
      cwd: spec.cwd,
      reject: false,
      stdout: (options.stdout ?? 'pipe') as never,
      stderr: (options.stderr ?? 'pipe') as never,
      stdin: (options.stdin ?? 'pipe') as never,
      stripFinalNewline: false,
      ...(spec.env ? { env: spec.env } : {}),
      ...(spec.input !== undefined ? { input: spec.input } : {}),
      ...(options.detached !== undefined ? { detached: options.detached } : {}),
      ...(options.cleanup !== undefined ? { cleanup: options.cleanup } : {})
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0
    };
  };
};

export const execaCommandRunner: CommandRunner = createExecaCommandRunner();
