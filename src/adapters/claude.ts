import type { AgentAdapter, AdapterCommandSpec, AdapterTurnRequest, AdapterUsage, CommandRunner } from './types.js';

import { CLAUDE_EFFORT_OPTIONS } from '../config/options.js';
import {
  createAdapterFailure,
  createAdapterSuccess,
  getCommandIdleTimeoutMs,
  resolveAuthEnvironment
} from './shared.js';
import { execaCommandRunner } from './runner.js';

interface ParsedClaudeJsonOutput {
  sessionId: string | null;
  finalMessage: string;
  model: string;
  usage: AdapterUsage;
}

const parseClaudeJson = (stdout: string): Record<string, unknown> => {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (error) {
    throw new Error('Failed to parse Claude JSON output.', { cause: error });
  }
};

export const parseClaudeJsonOutput = (
  stdout: string,
  fallbackModel: string,
  fallbackSessionId: string | null = null
): ParsedClaudeJsonOutput => {
  const parsed = parseClaudeJson(stdout);

  if (parsed.is_error === true) {
    throw new Error(typeof parsed.result === 'string' ? parsed.result : 'Claude returned an error result.');
  }

  const usagePayload = (parsed.usage ?? {}) as Record<string, unknown>;
  const modelUsage = (parsed.modelUsage ?? {}) as Record<string, unknown>;
  const modelName = Object.keys(modelUsage)[0] ?? fallbackModel;
  const finalMessage =
    typeof parsed.result === 'string' ? parsed.result : '';

  if (!finalMessage) {
    throw new Error('Claude output did not include a result string.');
  }

  return {
    sessionId: typeof parsed.session_id === 'string' ? parsed.session_id : fallbackSessionId,
    finalMessage,
    model: modelName,
    usage: {
      inputTokens:
        typeof usagePayload.input_tokens === 'number' ? usagePayload.input_tokens : 0,
      outputTokens:
        typeof usagePayload.output_tokens === 'number' ? usagePayload.output_tokens : 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens:
        typeof usagePayload.cache_creation_input_tokens === 'number'
          ? usagePayload.cache_creation_input_tokens
          : 0,
      cacheReadInputTokens:
        typeof usagePayload.cache_read_input_tokens === 'number'
          ? usagePayload.cache_read_input_tokens
          : 0,
      totalCostUsd:
        typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null,
      raw: parsed
    }
  };
};

export const buildClaudeCommand = (request: AdapterTurnRequest): AdapterCommandSpec => {
  if (
    request.effortLevel !== undefined &&
    !CLAUDE_EFFORT_OPTIONS.includes(request.effortLevel as typeof CLAUDE_EFFORT_OPTIONS[number])
  ) {
    throw new Error(`Unsupported Claude effort level: ${request.effortLevel}`);
  }

  // All headless modes skip permissions; only 'default' defers to Claude's own prompting
  const shouldSkipPermissions = request.claudePermissionMode !== 'default';
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    request.model,
    ...(request.effortLevel && request.effortLevel !== 'medium'
      ? ['--effort', request.effortLevel]
      : []),
    ...(shouldSkipPermissions ? ['--dangerously-skip-permissions'] : []),
  ];

  if (request.sessionId) {
    args.push('--resume', request.sessionId);
  } else if (request.persistSession === false) {
    args.push('--no-session-persistence');
  }

  if (request.maxBudgetUsd !== null && request.maxBudgetUsd !== undefined) {
    args.push('--max-budget-usd', String(request.maxBudgetUsd));
  }

  const additionalDirectories = request.additionalDirectories ?? [];
  if (additionalDirectories.length > 0) {
    args.push('--add-dir', ...additionalDirectories);
  }

  return {
    command: 'claude',
    args,
    cwd: request.cwd,
    input: request.prompt,
    env: resolveAuthEnvironment(request.auth, 'ANTHROPIC_API_KEY'),
    idleTimeoutMs: getCommandIdleTimeoutMs(request.stage)
  };
};

export class ClaudeCliAdapter implements AgentAdapter {
  readonly backend = 'claude' as const;

  constructor(private readonly runner: CommandRunner = execaCommandRunner) {}

  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec {
    return buildClaudeCommand(request);
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
      const parsed = parseClaudeJsonOutput(
        execution.stdout,
        request.model,
        request.sessionId ?? null
      );

      return createAdapterSuccess({
        backend: this.backend,
        request,
        sessionId: parsed.sessionId,
        finalMessage: parsed.finalMessage,
        model: parsed.model,
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
