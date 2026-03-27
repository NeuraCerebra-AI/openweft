import type { AgentAdapter, AdapterCommandSpec, AdapterTurnRequest, AdapterUsage, CommandRunner } from './types.js';

import { CODEX_EFFORT_OPTIONS } from '../config/options.js';
import {
  createAdapterFailure,
  createAdapterSuccess,
  getCommandIdleTimeoutMs,
  resolveAuthEnvironment
} from './shared.js';
import { execaCommandRunner } from './runner.js';

interface ParsedCodexJsonlOutput {
  sessionId: string | null;
  finalMessage: string;
  usage: AdapterUsage;
}

const parseCodexJsonlLine = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Failed to parse Codex JSONL line: ${line}`, { cause: error });
  }
};

export const parseCodexJsonlOutput = (
  stdout: string,
  fallbackSessionId: string | null = null
): ParsedCodexJsonlOutput => {
  let sessionId = fallbackSessionId;
  let finalMessage = '';
  let streamedMessage = '';
  let usage: AdapterUsage | null = null;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const parsed = parseCodexJsonlLine(line) as Record<string, unknown>;
    const type = typeof parsed.type === 'string' ? parsed.type : '';

    if (type === 'thread.started' && typeof parsed.thread_id === 'string') {
      sessionId = parsed.thread_id;
      continue;
    }

    if (type === 'item.agentMessage.delta' && typeof parsed.delta === 'string') {
      streamedMessage += parsed.delta;
      continue;
    }

    if (type === 'item.completed') {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        finalMessage = item.text;
      }
      continue;
    }

    if (type === 'turn.completed') {
      const usagePayload = parsed.usage as Record<string, unknown> | undefined;
      usage = {
        inputTokens:
          typeof usagePayload?.input_tokens === 'number' ? usagePayload.input_tokens : 0,
        outputTokens:
          typeof usagePayload?.output_tokens === 'number' ? usagePayload.output_tokens : 0,
        cachedInputTokens:
          typeof usagePayload?.cached_input_tokens === 'number' ? usagePayload.cached_input_tokens : 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalCostUsd: null,
        raw: usagePayload ?? {}
      };
    }
  }

  const resolvedMessage = finalMessage || streamedMessage.trim();
  if (!resolvedMessage) {
    throw new Error('Codex output did not include a final agent message.');
  }

  if (!usage) {
    throw new Error('Codex output did not include a turn.completed usage payload.');
  }

  return {
    sessionId,
    finalMessage: resolvedMessage,
    usage
  };
};

export const buildCodexCommand = (request: AdapterTurnRequest): AdapterCommandSpec => {
  const args = ['exec'];
  const env = {
    ...resolveAuthEnvironment(request.auth, 'CODEX_API_KEY'),
    ...(request.isolatedHomeDir ? { CODEX_HOME: request.isolatedHomeDir } : {})
  };

  if (
    request.effortLevel !== undefined &&
    !CODEX_EFFORT_OPTIONS.includes(request.effortLevel as typeof CODEX_EFFORT_OPTIONS[number])
  ) {
    throw new Error(`Unsupported Codex effort level: ${request.effortLevel}`);
  }

  if (request.sessionId) {
    args.push('resume', request.sessionId);
    args.push('--json', '--model', request.model);
  } else {
    args.push(
      '--sandbox',
      request.sandboxMode ?? 'danger-full-access',
      '-C',
      request.cwd
    );

    if (request.persistSession === false) {
      args.push('--ephemeral');
    }

    for (const directory of request.additionalDirectories ?? []) {
      args.push('--add-dir', directory);
    }

    args.push('--json', '--color', 'never', '--model', request.model);
  }

  if (request.effortLevel && request.effortLevel !== 'medium') {
    args.push('-c', `model_reasoning_effort="${request.effortLevel}"`);
  }

  args.push('-');

  return {
    command: 'codex',
    args,
    cwd: request.cwd,
    input: request.prompt,
    env,
    idleTimeoutMs: getCommandIdleTimeoutMs(request.stage)
  };
};

export class CodexCliAdapter implements AgentAdapter {
  readonly backend = 'codex' as const;

  constructor(private readonly runner: CommandRunner = execaCommandRunner) {}

  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec {
    return buildCodexCommand(request);
  }

  async runTurn(request: AdapterTurnRequest) {
    const command = this.buildCommand(request);

    let execution;
    try {
      execution = await this.runner(command);
    } catch (error) {
      return createAdapterFailure({
        backend: this.backend,
        request,
        command,
        error
      });
    }

    if (execution.exitCode !== 0) {
      return createAdapterFailure({
        backend: this.backend,
        request,
        command,
        execution
      });
    }

    try {
      const parsed = parseCodexJsonlOutput(execution.stdout, request.sessionId ?? null);

      return createAdapterSuccess({
        backend: this.backend,
        request,
        sessionId: parsed.sessionId,
        finalMessage: parsed.finalMessage,
        model: request.model,
        usage: parsed.usage,
        command,
        execution
      });
    } catch (error) {
      return createAdapterFailure({
        backend: this.backend,
        request,
        command,
        execution,
        error
      });
    }
  }
}
