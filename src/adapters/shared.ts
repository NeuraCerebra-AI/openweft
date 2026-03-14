import { createCostRecord } from '../domain/costs.js';
import { classifyError } from '../domain/errors.js';

import type {
  AdapterCommandSpec,
  AdapterFailure,
  AdapterRunArtifacts,
  AdapterSuccess,
  AdapterTurnRequest,
  AdapterUsage,
  CommandExecutionResult
} from './types.js';

const buildArtifacts = (
  command: AdapterCommandSpec,
  execution: CommandExecutionResult
): AdapterRunArtifacts => {
  return {
    stdout: execution.stdout,
    stderr: execution.stderr,
    exitCode: execution.exitCode,
    command
  };
};

const buildErrorMessage = (input: {
  execution?: CommandExecutionResult;
  error?: unknown;
}): string => {
  const stdout = input.execution?.stdout?.trim();
  const stderr = input.execution?.stderr?.trim();

  if (stderr) {
    return stderr;
  }

  if (stdout) {
    return stdout;
  }

  if (input.error instanceof Error) {
    return input.error.message;
  }

  if (typeof input.error === 'string') {
    return input.error;
  }

  return 'Unknown adapter failure';
};

export const resolveAuthEnvironment = (
  auth: AdapterTurnRequest['auth'],
  defaultEnvVar: string
): Record<string, string> => {
  if (auth.method !== 'api_key') {
    return {};
  }

  const envVar = auth.envVar ?? defaultEnvVar;
  const envValue = process.env[envVar];

  if (!envValue) {
    throw new Error(`Missing required API key environment variable ${envVar}.`);
  }

  return {
    [envVar]: envValue
  };
};

export const createAdapterSuccess = (input: {
  backend: AdapterSuccess['backend'];
  request: AdapterTurnRequest;
  sessionId: string | null;
  finalMessage: string;
  model: string;
  usage: AdapterUsage;
  command: AdapterCommandSpec;
  execution: CommandExecutionResult;
}): AdapterSuccess => {
  return {
    ok: true,
    backend: input.backend,
    sessionId: input.sessionId,
    finalMessage: input.finalMessage,
    model: input.model,
    usage: input.usage,
    costRecord: createCostRecord({
      featureId: input.request.featureId,
      stage: input.request.stage,
      model: input.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      timestamp: new Date().toISOString()
    }),
    artifacts: buildArtifacts(input.command, input.execution)
  };
};

export const createAdapterFailure = (input: {
  backend: AdapterFailure['backend'];
  request: AdapterTurnRequest;
  command: AdapterCommandSpec;
  execution?: CommandExecutionResult;
  error?: unknown;
  sessionId?: string | null;
}): AdapterFailure => {
  const message = buildErrorMessage({
    ...(input.execution ? { execution: input.execution } : {}),
    ...(input.error !== undefined ? { error: input.error } : {})
  });

  return {
    ok: false,
    backend: input.backend,
    sessionId: input.sessionId ?? input.request.sessionId ?? null,
    model: input.request.model,
    error: message,
    classified: classifyError(message),
    artifacts: buildArtifacts(
      input.command,
      input.execution ?? {
        stdout: '',
        stderr: message,
        exitCode: 1
      }
    )
  };
};
