import { z } from 'zod';

import { AuthMethodSchema, UserBackendSchema } from '../domain/primitives.js';
import type { RuntimePaths } from '../fs/paths.js';
import {
  APPROVAL_MODE_OPTIONS,
  CLAUDE_EFFORT_OPTIONS,
  CODEX_EFFORT_OPTIONS
} from './options.js';
export { AuthMethodSchema, UserBackendSchema };

export const BackendAuthConfigSchema = z
  .object({
    method: AuthMethodSchema,
    envVar: z.string().min(1).optional()
  })
  .strict();

export const RateLimitModeSchema = z.enum(['subscription', 'api_key']);

export const RateLimitConfigSchema = z
  .object({
    mode: RateLimitModeSchema,
    maxConcurrentRequests: z.number().int().positive(),
    retryBackoffMs: z.number().int().nonnegative(),
    retryMaxAttempts: z.number().int().positive()
  })
  .strict();

export const BudgetConfigSchema = z
  .object({
    warnAtUsd: z.number().nonnegative().nullable(),
    pauseAtUsd: z.number().nonnegative().nullable(),
    stopAtUsd: z.number().nonnegative().nullable()
  })
  .strict();

export const StatusUsageDisplaySchema = z.enum(['tokens', 'estimated-cost']);

export const StatusConfigSchema = z
  .object({
    usageDisplay: StatusUsageDisplaySchema
  })
  .strict();

export const CodexEffortLevelSchema = z.enum(CODEX_EFFORT_OPTIONS);
export const ClaudeEffortLevelSchema = z.enum(CLAUDE_EFFORT_OPTIONS);
export const ApprovalModeSchema = z.enum(APPROVAL_MODE_OPTIONS);

export const OpenWeftConfigSchema = z
  .object({
    backend: UserBackendSchema,
    auth: z
      .object({
        codex: BackendAuthConfigSchema,
        claude: BackendAuthConfigSchema
      })
      .strict(),
    prompts: z
      .object({
        promptA: z.string().min(1),
        planAdjustment: z.string().min(1)
      })
      .strict(),
    featureRequestsDir: z.string().min(1),
    queueFile: z.string().min(1),
    models: z
      .object({
        codex: z.string().min(1),
        claude: z.string().min(1)
      })
      .strict(),
    effort: z
      .object({
        codex: CodexEffortLevelSchema,
        claude: ClaudeEffortLevelSchema
      })
      .strict(),
    approval: ApprovalModeSchema,
    concurrency: z
      .object({
        maxParallelAgents: z.number().int().positive(),
        staggerDelayMs: z.number().int().nonnegative()
      })
      .strict(),
    rateLimits: z
      .object({
        codex: RateLimitConfigSchema,
        claude: RateLimitConfigSchema
      })
      .strict(),
    status: StatusConfigSchema,
    budget: BudgetConfigSchema
  })
  .strict();

export type OpenWeftConfig = z.infer<typeof OpenWeftConfigSchema>;

export const DEFAULT_OPENWEFT_CONFIG: OpenWeftConfig = {
  backend: 'codex',
  auth: {
    codex: { method: 'subscription' },
    claude: { method: 'subscription' }
  },
  prompts: {
    promptA: './prompts/prompt-a.md',
    planAdjustment: './prompts/plan-adjustment.md'
  },
  featureRequestsDir: './feature_requests',
  queueFile: './feature_requests/queue.txt',
  models: {
    codex: 'gpt-5.3-codex',
    claude: 'claude-sonnet-4-6'
  },
  effort: {
    codex: 'medium',
    claude: 'medium'
  },
  approval: 'always',
  concurrency: {
    maxParallelAgents: 3,
    staggerDelayMs: 5000
  },
  rateLimits: {
    codex: {
      mode: 'subscription',
      maxConcurrentRequests: 3,
      retryBackoffMs: 5000,
      retryMaxAttempts: 5
    },
    claude: {
      mode: 'subscription',
      maxConcurrentRequests: 2,
      retryBackoffMs: 5000,
      retryMaxAttempts: 5
    }
  },
  status: {
    usageDisplay: 'tokens'
  },
  budget: {
    warnAtUsd: null,
    pauseAtUsd: null,
    stopAtUsd: null
  }
};

export interface ResolvedOpenWeftConfig extends OpenWeftConfig {
  configFilePath: string | null;
  configDirectory: string;
  repoRoot: string;
  paths: RuntimePaths;
}
