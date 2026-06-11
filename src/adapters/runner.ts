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
    // OpenWeft does not enforce client-side idle or wall-clock kills here.
    // Codex/Claude turns can legitimately run for a long time, and we do not yet
    // have a verified cancellation mechanism that is safe for in-flight sessions.
    let result;
    try {
      result = await execa(spec.command, spec.args, {
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
    } catch (error) {
      const errorRecord = error as {
        stdout?: unknown;
        stderr?: unknown;
        exitCode?: unknown;
        signal?: unknown;
        code?: unknown;
        message?: unknown;
      };
      const errorMessage = typeof errorRecord.message === 'string'
        ? errorRecord.message
        : String(error);

      const execution: CommandExecutionResult = {
        stdout: typeof errorRecord.stdout === 'string' ? errorRecord.stdout : '',
        stderr: typeof errorRecord.stderr === 'string' && errorRecord.stderr.trim()
          ? errorRecord.stderr
          : errorMessage,
        exitCode: typeof errorRecord.exitCode === 'number' ? errorRecord.exitCode : 1,
        signal: typeof errorRecord.signal === 'string' ? errorRecord.signal : null,
        errorMessage,
        failed: true,
        spawnFailure: true
      };
      if (typeof errorRecord.code === 'string') {
        execution.errorCode = errorRecord.code;
      }

      return execution;
    }

    const resultRecord = result as typeof result & {
      code?: unknown;
      failed?: unknown;
      message?: unknown;
    };
    const hasExitCode = typeof result.exitCode === 'number';
    const exitCode = hasExitCode ? result.exitCode as number : 1;
    const errorMessage = typeof resultRecord.message === 'string' ? resultRecord.message : undefined;
    const errorCode = typeof resultRecord.code === 'string' ? resultRecord.code : undefined;
    return {
      stdout: result.stdout,
      stderr: result.stderr || (!hasExitCode ? errorMessage ?? 'Command failed before exit code was available.' : ''),
      exitCode,
      signal: result.signal ?? null,
      ...(errorCode ? { errorCode } : {}),
      ...(!hasExitCode || errorMessage ? { errorMessage: errorMessage ?? 'Command failed before exit code was available.' } : {}),
      failed: Boolean(resultRecord.failed) || !hasExitCode || exitCode !== 0 || Boolean(result.signal),
      spawnFailure: !hasExitCode
    };
  };
};

export const execaCommandRunner: CommandRunner = createExecaCommandRunner();
