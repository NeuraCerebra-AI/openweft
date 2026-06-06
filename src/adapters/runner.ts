import { execa } from 'execa';

import type { AdapterCommandSpec, CommandExecutionResult, CommandRunner } from './types.js';

interface ExecaCommandRunnerOptions {
  stdout?: unknown;
  stderr?: unknown;
  stdin?: unknown;
  detached?: boolean;
  cleanup?: boolean;
}

/**
 * Extends the shared CommandExecutionResult with the raw termination signals
 * that execa exposes. When a process is killed by a signal (OOM/SIGKILL/
 * SIGTERM) execa returns exitCode === undefined and signal set; collapsing that
 * to exitCode 1 makes it indistinguishable from a normal non-zero exit and
 * loses information downstream classification needs. We keep exitCode for
 * compatibility and ADD these optional fields.
 *
 * NOTE (cross-file): src/domain/errors.ts classification could consume these
 * fields to distinguish signal terminations (e.g. SIGKILL/OOM) from ordinary
 * non-zero exits. errors.ts is owned by another agent and is intentionally not
 * modified here; only the runner-side propagation is implemented.
 */
export interface CommandExecutionResultWithSignal extends CommandExecutionResult {
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
  isCanceled?: boolean;
}

export const createExecaCommandRunner = (
  options: ExecaCommandRunnerOptions = {}
): CommandRunner => {
  return async (spec: AdapterCommandSpec): Promise<CommandExecutionResult> => {
    // OpenWeft does not enforce client-side idle or wall-clock kills here.
    // Codex/Claude turns can legitimately run for a long time, and we do not yet
    // have a verified cancellation mechanism that is safe for in-flight sessions.
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

    const signal = (result.signal ?? null) as NodeJS.Signals | null;

    const mapped: CommandExecutionResultWithSignal = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? (signal ? 1 : 0),
      // Propagate the raw signal (and related termination hints) so callers can
      // distinguish a signal-kill from an ordinary non-zero exit. exitCode is
      // preserved unchanged for backward compatibility.
      signal,
      timedOut: result.timedOut ?? false,
      isCanceled: result.isCanceled ?? false
    };

    return mapped;
  };
};

export const execaCommandRunner: CommandRunner = createExecaCommandRunner();
