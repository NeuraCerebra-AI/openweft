import { createHash } from 'node:crypto';
import path from 'node:path';
import { access } from 'node:fs/promises';

import { cosmiconfig } from 'cosmiconfig';
import { z } from 'zod';

import { buildRuntimePaths } from '../fs/paths.js';
import {
  DEFAULT_OPENWEFT_CONFIG,
  OpenWeftConfigSchema,
  type OpenWeftConfig,
  type ResolvedOpenWeftConfig
} from './schema.js';

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`;
  }

  return JSON.stringify(value);
};

export const createConfigHash = (config: OpenWeftConfig | ResolvedOpenWeftConfig): string => {
  const normalized = OpenWeftConfigSchema.parse({
    backend: config.backend,
    auth: config.auth,
    prompts: config.prompts,
    featureRequestsDir: config.featureRequestsDir,
    queueFile: config.queueFile,
    models: config.models,
    effort: config.effort,
    approval: config.approval,
    concurrency: config.concurrency,
    rateLimits: config.rateLimits,
    status: config.status,
    runtime: config.runtime,
    budget: config.budget
  });

  return `sha256:${createHash('sha256').update(stableSerialize(normalized)).digest('hex')}`;
};

const resolveConfig = (
  config: OpenWeftConfig,
  repoRoot: string,
  configFilePath: string | null
): ResolvedOpenWeftConfig => {
  const configDirectory = configFilePath ? path.dirname(configFilePath) : repoRoot;
  const paths = buildRuntimePaths({
    repoRoot,
    configDirectory,
    featureRequestsDir: config.featureRequestsDir,
    queueFile: config.queueFile,
    promptA: config.prompts.promptA,
    planAdjustment: config.prompts.planAdjustment
  });

  return {
    ...config,
    repoRoot,
    configFilePath,
    configDirectory,
    paths
  };
};

const mergeConfigWithDefaults = (rawConfig: unknown): OpenWeftConfig => {
  const input = (rawConfig ?? {}) as Partial<OpenWeftConfig>;

  return OpenWeftConfigSchema.parse({
    ...DEFAULT_OPENWEFT_CONFIG,
    ...input,
    auth: {
      ...DEFAULT_OPENWEFT_CONFIG.auth,
      ...input.auth,
      codex: {
        ...DEFAULT_OPENWEFT_CONFIG.auth.codex,
        ...input.auth?.codex
      },
      claude: {
        ...DEFAULT_OPENWEFT_CONFIG.auth.claude,
        ...input.auth?.claude
      }
    },
    prompts: {
      ...DEFAULT_OPENWEFT_CONFIG.prompts,
      ...input.prompts
    },
    models: {
      ...DEFAULT_OPENWEFT_CONFIG.models,
      ...input.models
    },
    effort: {
      ...DEFAULT_OPENWEFT_CONFIG.effort,
      ...input.effort
    },
    approval: input.approval ?? DEFAULT_OPENWEFT_CONFIG.approval,
    concurrency: {
      ...DEFAULT_OPENWEFT_CONFIG.concurrency,
      ...input.concurrency
    },
    rateLimits: {
      codex: {
        ...DEFAULT_OPENWEFT_CONFIG.rateLimits.codex,
        ...input.rateLimits?.codex
      },
      claude: {
        ...DEFAULT_OPENWEFT_CONFIG.rateLimits.claude,
        ...input.rateLimits?.claude
      }
    },
    status: {
      ...DEFAULT_OPENWEFT_CONFIG.status,
      ...input.status
    },
    runtime: {
      ...DEFAULT_OPENWEFT_CONFIG.runtime,
      ...input.runtime
    },
    budget: {
      ...DEFAULT_OPENWEFT_CONFIG.budget,
      ...input.budget
    }
  });
};

const findExistingSearchDirectory = async (cwd: string): Promise<string> => {
  let current = path.resolve(cwd);

  while (true) {
    try {
      await access(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return path.resolve(cwd);
      }
      current = parent;
    }
  }
};

export const loadOpenWeftConfig = async (
  cwd = process.cwd()
): Promise<{ config: ResolvedOpenWeftConfig; configHash: string }> => {
  const explorer = cosmiconfig('openweft', {
    searchStrategy: 'global'
  });
  const searchDirectory = await findExistingSearchDirectory(cwd);
  const result = await explorer.search(searchDirectory);
  let parsedConfig: OpenWeftConfig;
  try {
    parsedConfig = mergeConfigWithDefaults(result?.config);
  } catch (error) {
    if (!(error instanceof z.ZodError)) {
      throw error;
    }

    const configLocation = result?.filepath ?? 'OpenWeft config';
    const details = error.issues
      .map((issue) => {
        const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `  • ${field}: ${issue.message}`;
      })
      .join('\n');

    throw new Error(`Error in ${configLocation}:\n${details}`, { cause: error });
  }
  const repoRoot = result?.filepath ? path.dirname(result.filepath) : path.resolve(cwd);
  const resolvedConfig = resolveConfig(parsedConfig, repoRoot, result?.filepath ?? null);

  return {
    config: resolvedConfig,
    configHash: createConfigHash(resolvedConfig)
  };
};

export const getDefaultConfig = (): OpenWeftConfig => {
  return structuredClone(DEFAULT_OPENWEFT_CONFIG);
};
