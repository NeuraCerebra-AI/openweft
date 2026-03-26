import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CheckpointSchema,
  createEmptyCheckpoint,
  FeatureCheckpointSchema,
  loadCheckpoint,
  saveCheckpoint
} from '../../src/state/index.js';

describe('checkpoint persistence', () => {
  it('saves and loads a checkpoint from the primary file', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-checkpoint-'));
    const checkpointFile = path.join(tempDirectory, 'checkpoint.json');
    const backupFile = path.join(tempDirectory, 'checkpoint.json.backup');
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: '0.1.0',
      configHash: 'sha256:test',
      runId: 'run-1',
      checkpointId: 'chk-1',
      createdAt: '2026-03-13T08:00:00.000Z'
    });

    await saveCheckpoint({ checkpoint, checkpointFile, backupFile });
    const loaded = await loadCheckpoint(checkpointFile, backupFile);

    expect(loaded.source).toBe('primary');
    expect(loaded.checkpoint?.runId).toBe('run-1');
  });

  it('falls back to the backup file when the primary is corrupted', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-checkpoint-fallback-'));
    const checkpointFile = path.join(tempDirectory, 'checkpoint.json');
    const backupFile = path.join(tempDirectory, 'checkpoint.json.backup');

    const first = createEmptyCheckpoint({
      orchestratorVersion: '0.1.0',
      configHash: 'sha256:test',
      runId: 'run-1',
      checkpointId: 'chk-1',
      createdAt: '2026-03-13T08:00:00.000Z'
    });

    const second = {
      ...first,
      checkpointId: 'chk-2',
      updatedAt: '2026-03-13T08:01:00.000Z',
      status: 'in-progress' as const
    };

    await saveCheckpoint({ checkpoint: first, checkpointFile, backupFile });
    await saveCheckpoint({ checkpoint: second, checkpointFile, backupFile });
    await writeFile(checkpointFile, '{not valid json', 'utf8');

    const loaded = await loadCheckpoint(checkpointFile, backupFile);

    expect(loaded.source).toBe('backup');
    expect(loaded.checkpoint?.checkpointId).toBe('chk-1');
  });

  it('fails closed when the primary checkpoint is corrupted and no backup exists', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-checkpoint-corrupt-primary-'));
    const checkpointFile = path.join(tempDirectory, 'checkpoint.json');
    const backupFile = path.join(tempDirectory, 'checkpoint.json.backup');

    await writeFile(checkpointFile, '{not valid json', 'utf8');

    await expect(loadCheckpoint(checkpointFile, backupFile)).rejects.toThrow(/checkpoint/i);
  });

  it('fails closed when both the primary and backup checkpoints are corrupted', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-checkpoint-corrupt-both-'));
    const checkpointFile = path.join(tempDirectory, 'checkpoint.json');
    const backupFile = path.join(tempDirectory, 'checkpoint.json.backup');

    await writeFile(checkpointFile, '{not valid json', 'utf8');
    await writeFile(backupFile, '{also not valid json', 'utf8');

    await expect(loadCheckpoint(checkpointFile, backupFile)).rejects.toThrow(/checkpoint/i);
  });

  it('accepts persisted pendingMergeSummaries', () => {
    const checkpoint = {
      ...createEmptyCheckpoint({
        orchestratorVersion: '0.1.0',
        configHash: 'sha256:test',
        runId: 'run-1',
        checkpointId: 'chk-1',
        createdAt: '2026-03-13T08:00:00.000Z'
      }),
      pendingMergeSummaries: [
        {
          featureId: '001',
          summary: {
            merge_commit: 'merge-123',
            branch: 'openweft-001-add-auth',
            pre_merge_commit: 'base-123',
            total_files_changed: 1,
            total_lines_added: 5,
            total_lines_removed: 1,
            files: [
              {
                path: 'src/auth.ts',
                change_type: 'modified' as const,
                lines_added: 5,
                lines_removed: 1,
                old_path: null
              }
            ]
          }
        }
      ]
    };

    const result = CheckpointSchema.safeParse(checkpoint);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pendingMergeSummaries).toHaveLength(1);
      expect(result.data.pendingMergeSummaries[0]?.featureId).toBe('001');
    }
  });

  it('defaults legacy checkpoints without pendingMergeSummaries to an empty array when loading', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-checkpoint-legacy-'));
    const checkpointFile = path.join(tempDirectory, 'checkpoint.json');
    const backupFile = path.join(tempDirectory, 'checkpoint.json.backup');
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: '0.1.0',
      configHash: 'sha256:test',
      runId: 'run-1',
      checkpointId: 'chk-1',
      createdAt: '2026-03-13T08:00:00.000Z'
    });
    const legacyCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as Record<string, unknown>;
    delete legacyCheckpoint.pendingMergeSummaries;

    await writeFile(checkpointFile, JSON.stringify(legacyCheckpoint), 'utf8');

    const loaded = await loadCheckpoint(checkpointFile, backupFile);

    expect(loaded.source).toBe('primary');
    expect(loaded.checkpoint?.pendingMergeSummaries).toEqual([]);
  });

  it('defaults legacy feature checkpoints without evolvedPlanFile, rerunEligible, or mergeResolutionAttempts when loading', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-checkpoint-legacy-feature-'));
    const checkpointFile = path.join(tempDirectory, 'checkpoint.json');
    const backupFile = path.join(tempDirectory, 'checkpoint.json.backup');
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: '0.1.0',
      configHash: 'sha256:test',
      runId: 'run-1',
      checkpointId: 'chk-1',
      createdAt: '2026-03-13T08:00:00.000Z'
    });
    checkpoint.features['001'] = {
      id: '001',
      request: 'Add auth',
      status: 'failed',
      attempts: 1,
      planFile: '/tmp/001.plan.md',
      evolvedPlanFile: null,
      branchName: 'openweft-001',
      worktreePath: '/tmp/worktrees/001',
      sessionId: null,
      rerunEligible: true,
      mergeResolutionAttempts: 0,
      updatedAt: '2026-03-13T08:00:00.000Z'
    };
    const legacyCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as {
      features: Record<string, Record<string, unknown>>;
    };
    delete legacyCheckpoint.features['001']?.evolvedPlanFile;
    delete legacyCheckpoint.features['001']?.rerunEligible;
    delete legacyCheckpoint.features['001']?.mergeResolutionAttempts;

    await writeFile(checkpointFile, JSON.stringify(legacyCheckpoint), 'utf8');

    const loaded = await loadCheckpoint(checkpointFile, backupFile);

    expect(loaded.source).toBe('primary');
    expect(loaded.checkpoint?.features['001']?.evolvedPlanFile).toBeNull();
    expect(loaded.checkpoint?.features['001']?.rerunEligible).toBe(true);
    expect(loaded.checkpoint?.features['001']?.mergeResolutionAttempts).toBe(0);
  });
});

describe('FeatureCheckpointSchema mergeCommit field', () => {
  const baseFeature = {
    id: 'feat-001',
    request: 'Add auth',
    status: 'completed' as const,
    attempts: 1,
    planFile: null,
    branchName: null,
    worktreePath: null,
    sessionId: null,
    updatedAt: '2026-03-20T10:00:00.000Z'
  };

  it('accepts a feature with a mergeCommit SHA', () => {
    const result = FeatureCheckpointSchema.safeParse({
      ...baseFeature,
      mergeCommit: 'abc1234def5678'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mergeCommit).toBe('abc1234def5678');
    }
  });

  it('accepts a feature with mergeCommit set to null', () => {
    const result = FeatureCheckpointSchema.safeParse({
      ...baseFeature,
      mergeCommit: null
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mergeCommit).toBeNull();
    }
  });

  it('accepts a feature without mergeCommit (backward compatible)', () => {
    const result = FeatureCheckpointSchema.safeParse(baseFeature);
    expect(result.success).toBe(true);
  });
});
