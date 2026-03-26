import type { CostRecord, CostStage } from '../domain/costs.js';
import type { ClassifiedError } from '../domain/errors.js';
import type { AuthMethod, Backend } from '../domain/primitives.js';
import type { BackendEffortLevel } from '../config/options.js';

export type AdapterSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ClaudePermissionMode = 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan';

export interface AdapterAuthConfig {
  method: AuthMethod;
  envVar?: string;
}

export interface AdapterCommandSpec {
  command: string;
  args: string[];
  cwd: string;
  input?: string;
  env?: Record<string, string>;
  idleTimeoutMs?: number;
}

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CommandRunner = (spec: AdapterCommandSpec) => Promise<CommandExecutionResult>;

export interface AdapterUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalCostUsd: number | null;
  raw: unknown;
}

export interface AdapterTurnRequest {
  featureId: string;
  stage: CostStage;
  cwd: string;
  prompt: string;
  model: string;
  effortLevel?: BackendEffortLevel;
  auth: AdapterAuthConfig;
  sessionId?: string | null;
  persistSession?: boolean;
  isolatedHomeDir?: string | null;
  additionalDirectories?: string[];
  sandboxMode?: AdapterSandboxMode;
  claudePermissionMode?: ClaudePermissionMode;
  maxBudgetUsd?: number | null;
}

export interface AdapterRunArtifacts {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: AdapterCommandSpec;
}

export interface AdapterSuccess {
  ok: true;
  backend: Backend;
  sessionId: string | null;
  finalMessage: string;
  model: string;
  usage: AdapterUsage;
  costRecord: CostRecord;
  artifacts: AdapterRunArtifacts;
}

export interface AdapterFailure {
  ok: false;
  backend: Backend;
  sessionId: string | null;
  model: string;
  error: string;
  classified: ClassifiedError;
  artifacts: AdapterRunArtifacts;
}

export type AdapterTurnResult = AdapterSuccess | AdapterFailure;

export interface AgentAdapter {
  readonly backend: Backend;
  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec;
  runTurn(request: AdapterTurnRequest): Promise<AdapterTurnResult>;
}
