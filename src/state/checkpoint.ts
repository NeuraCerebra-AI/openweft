import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { CheckpointCostTotalsSchema, createEmptyCostTotals } from '../domain/costs.js';
import { BackendSchema, ManifestSchema, PriorityTierSchema } from '../domain/primitives.js';
import { writeJsonFileAtomic } from '../fs/files.js';

export const FeatureStatusSchema = z.enum([
  'pending',
  'planned',
  'executing',
  'completed',
  'failed',
  'skipped'
]);

export const RunStatusSchema = z.enum([
  'idle',
  'in-progress',
  'paused',
  'completed',
  'failed',
  'stopped'
]);

export const MachineStateSchema = z.enum([
  'idle',
  'planning',
  'executing',
  'merging',
  're-analysis',
  'queue-management',
  'stopped'
]);

export const FeatureCheckpointSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    request: z.string(),
    status: FeatureStatusSchema,
    attempts: z.number().int().nonnegative(),
    planFile: z.string().nullable(),
    promptBFile: z.string().nullable().optional(),
    branchName: z.string().nullable(),
    worktreePath: z.string().nullable(),
    sessionId: z.string().nullable(),
    sessionScope: z.enum(['repo', 'worktree']).nullable().optional(),
    backend: BackendSchema.nullable().optional(),
    manifest: ManifestSchema.nullable().optional(),
    priorityScore: z.number().nullable().optional(),
    priorityTier: PriorityTierSchema.nullable().optional(),
    scoringCycles: z.number().int().nonnegative().optional(),
    mergeCommit: z.string().nullable().optional(),
    lastError: z.string().nullable().optional(),
    updatedAt: z.string().datetime()
  })
  .strict();

export type FeatureCheckpoint = z.infer<typeof FeatureCheckpointSchema>;

export const CheckpointSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    orchestratorVersion: z.string(),
    configHash: z.string(),
    checkpointId: z.string(),
    runId: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    status: RunStatusSchema,
    currentState: MachineStateSchema,
    currentPhase: z
      .object({
        index: z.number().int().positive(),
        name: z.string(),
        featureIds: z.array(z.string()),
        startedAt: z.string().datetime()
      })
      .nullable(),
    queue: z
      .object({
        orderedFeatureIds: z.array(z.string()),
        totalCount: z.number().int().nonnegative()
      })
      .strict(),
    features: z.record(z.string(), FeatureCheckpointSchema),
    pendingRequests: z.array(
      z
        .object({
          request: z.string(),
          queuedAt: z.string().datetime()
        })
        .strict()
    ),
    cost: CheckpointCostTotalsSchema
  })
  .strict();

export type OrchestratorCheckpoint = z.infer<typeof CheckpointSchema>;

export interface LoadCheckpointResult {
  checkpoint: OrchestratorCheckpoint | null;
  source: 'primary' | 'backup' | 'none';
}

interface CheckpointPathInput {
  checkpointFile: string;
  backupFile?: string;
  checkpointBackupFile?: string;
}

class CheckpointLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CheckpointLoadError';
  }
}

const parseCheckpointText = (content: string): OrchestratorCheckpoint => {
  return CheckpointSchema.parse(JSON.parse(content));
};

const isMissingFileError = (error: unknown): boolean => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
};

const readCheckpointCandidate = async (
  filePath: string
): Promise<
  | { kind: 'valid'; checkpoint: OrchestratorCheckpoint }
  | { kind: 'missing' }
  | { kind: 'invalid'; error: unknown }
> => {
  try {
    const content = await readFile(filePath, 'utf8');
    return {
      kind: 'valid',
      checkpoint: parseCheckpointText(content)
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        kind: 'missing'
      };
    }

    return {
      kind: 'invalid',
      error
    };
  }
};

export const createEmptyCheckpoint = (input: {
  orchestratorVersion: string;
  configHash: string;
  runId: string;
  checkpointId: string;
  createdAt: string;
}): OrchestratorCheckpoint => {
  return {
    schemaVersion: '1.0.0',
    orchestratorVersion: input.orchestratorVersion,
    configHash: input.configHash,
    checkpointId: input.checkpointId,
    runId: input.runId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    status: 'idle',
    currentState: 'idle',
    currentPhase: null,
    queue: {
      orderedFeatureIds: [],
      totalCount: 0
    },
    features: {},
    pendingRequests: [],
    cost: createEmptyCostTotals()
  };
};

const resolveCheckpointPaths = (
  input: CheckpointPathInput | string,
  backupFile?: string
): { checkpointFile: string; backupFile: string } => {
  if (typeof input === 'string') {
    if (!backupFile) {
      throw new Error('Backup file path is required when using string checkpoint paths.');
    }

    return {
      checkpointFile: input,
      backupFile
    };
  }

  const resolvedBackup = input.backupFile ?? input.checkpointBackupFile;
  if (!resolvedBackup) {
    throw new Error('Either backupFile or checkpointBackupFile must be provided.');
  }

  return {
    checkpointFile: input.checkpointFile,
    backupFile: resolvedBackup
  };
};

export const saveCheckpoint = async (
  input:
    | {
        checkpoint: OrchestratorCheckpoint;
        checkpointFile: string;
        backupFile?: string;
        checkpointBackupFile?: string;
      }
    | CheckpointPathInput,
  checkpointArg?: OrchestratorCheckpoint
): Promise<void> => {
  const checkpoint =
    'checkpoint' in input ? input.checkpoint : checkpointArg;

  if (!checkpoint) {
    throw new Error('Checkpoint payload is required.');
  }

  const paths = resolveCheckpointPaths(input);

  let primaryContent: string | undefined;
  try {
    primaryContent = await readFile(paths.checkpointFile, 'utf8');
  } catch {
    // No current primary checkpoint to back up yet.
  }

  if (primaryContent !== undefined) {
    try {
      await writeJsonFileAtomic(paths.backupFile, JSON.parse(primaryContent));
    } catch (backupError) {
      console.warn(
        `OpenWeft: failed to write checkpoint backup to ${paths.backupFile}: ${backupError instanceof Error ? backupError.message : String(backupError)}`
      );
    }
  }

  await writeJsonFileAtomic(paths.checkpointFile, checkpoint);
};

export const loadCheckpoint = async (
  checkpointInput: CheckpointPathInput | string,
  backupFile?: string
): Promise<LoadCheckpointResult> => {
  const paths = resolveCheckpointPaths(checkpointInput, backupFile);

  const primary = await readCheckpointCandidate(paths.checkpointFile);
  if (primary.kind === 'valid') {
    return {
      checkpoint: primary.checkpoint,
      source: 'primary'
    };
  }

  const backup = await readCheckpointCandidate(paths.backupFile);
  if (backup.kind === 'valid') {
    return {
      checkpoint: backup.checkpoint,
      source: 'backup'
    };
  }

  if (primary.kind === 'missing' && backup.kind === 'missing') {
    return {
      checkpoint: null,
      source: 'none'
    };
  }

  if (primary.kind === 'invalid' && backup.kind === 'invalid') {
    throw new CheckpointLoadError(
      `Both checkpoint files are corrupted or unreadable: ${paths.checkpointFile} and ${paths.backupFile}.`,
      {
        cause: new AggregateError([primary.error, backup.error], 'Invalid checkpoint files')
      }
    );
  }

  if (primary.kind === 'invalid') {
    throw new CheckpointLoadError(
      `Primary checkpoint is corrupted or unreadable and no valid backup exists: ${paths.checkpointFile}.`,
      {
        cause: primary.error
      }
    );
  }

  throw new CheckpointLoadError(
    `Backup checkpoint is corrupted or unreadable: ${paths.backupFile}.`,
    {
      cause: backup.kind === 'invalid' ? backup.error : undefined
    }
  );
};
