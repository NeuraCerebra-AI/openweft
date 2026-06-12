import { describe, expect, it } from 'vitest';

import { createEmptyCheckpoint } from '../../src/state/checkpoint.js';
import { buildTerminalRunCopy } from '../../src/status/terminalCopy.js';

describe('terminal run copy', () => {
  it('gives stopped checkpoints with actionable work a safe resume action', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-03-23T00:00:00.000Z'
    });
    checkpoint.status = 'stopped';
    checkpoint.features['001'] = {
      id: '001',
      request: 'Add auth',
      status: 'planned',
      attempts: 0,
      planFile: '/tmp/001.plan.md',
      promptBFile: null,
      evolvedPlanFile: null,
      branchName: null,
      worktreePath: null,
      sessionId: null,
      sessionScope: null,
      backend: 'mock',
      manifest: {
        create: ['src/auth.ts'],
        modify: [],
        delete: []
      },
      manifestRecoveryMethod: 'json',
      manifestConfidence: 'current',
      reviewReason: null,
      blockedByFeatureIds: [],
      rerunEligible: true,
      mergeResolutionAttempts: 0,
      priorityScore: null,
      priorityTier: null,
      scoringCycles: 0,
      updatedAt: '2026-03-23T00:00:00.000Z'
    };

    expect(buildTerminalRunCopy({ checkpoint, checkpointSource: 'primary', pendingQueueCount: 0 })).toMatchObject({
      severity: 'warning',
      health: 'Stopped with resumable work',
      nextAction: expect.stringMatching(/openweft resume|openweft start/)
    });
  });

  it('classifies auth, permission, durability, backup, and completed states with next actions', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-03-23T00:00:00.000Z'
    });
    checkpoint.status = 'failed';
    checkpoint.features['001'] = {
      id: '001',
      request: 'Add auth',
      status: 'failed',
      attempts: 1,
      planFile: '/tmp/001.plan.md',
      promptBFile: null,
      evolvedPlanFile: null,
      branchName: null,
      worktreePath: null,
      sessionId: null,
      sessionScope: null,
      backend: 'codex',
      manifest: null,
      manifestRecoveryMethod: null,
      manifestConfidence: null,
      reviewReason: null,
      blockedByFeatureIds: [],
      rerunEligible: false,
      mergeResolutionAttempts: 0,
      priorityScore: null,
      priorityTier: null,
      scoringCycles: 0,
      lastError: 'Authentication failed: not logged in',
      updatedAt: '2026-03-23T00:00:00.000Z'
    };

    expect(buildTerminalRunCopy({ checkpoint, checkpointSource: 'primary', pendingQueueCount: 0 }).health).toBe('Authentication needed');

    checkpoint.features['001'].lastError = 'EACCES: Permission denied';
    expect(buildTerminalRunCopy({ checkpoint, checkpointSource: 'primary', pendingQueueCount: 0 }).health).toBe('Permission blocked');

    const durabilityCopy = buildTerminalRunCopy({
      checkpoint,
      checkpointSource: 'primary',
      pendingQueueCount: 0,
      diagnostics: {
        checkpointTimestamps: {
          primaryUpdatedAt: '2026-04-06T14:08:49.618Z',
          backupUpdatedAt: '2026-04-06T14:08:49.547Z'
        },
        headCommit: 'abc123',
        mergeDurability: {
          totalCompletedFeatures: 1,
          verifiedCount: 0,
          checks: [
            {
              featureId: '001',
              mergeCommit: 'def456',
              result: 'not-reachable'
            }
          ]
        },
        runtimeArtifacts: {
          codexHomePresent: true,
          residueFileCount: 0
        }
      }
    });
    expect(durabilityCopy.health).toBe('Durability check failed');
    expect(durabilityCopy.nextAction).toMatch(/inspect git history/i);

    const backupCopy = buildTerminalRunCopy({ checkpoint, checkpointSource: 'backup', pendingQueueCount: 0 });
    expect(backupCopy.health).toBe('Recovered from backup checkpoint');

    checkpoint.status = 'completed';
    checkpoint.features['001'].status = 'completed';
    checkpoint.features['001'].lastError = null;
    expect(buildTerminalRunCopy({ checkpoint, checkpointSource: 'primary', pendingQueueCount: 0 }).nextAction).toMatch(/Review the completed features/);
  });

  it('advises resume instead of stop for an in-progress checkpoint with no live process', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-06-11T00:00:00.000Z'
    });
    checkpoint.status = 'in-progress';

    const copy = buildTerminalRunCopy({
      checkpoint,
      checkpointSource: 'primary',
      pendingQueueCount: 0,
      background: null
    });

    expect(copy.severity).toBe('warning');
    expect(copy.health).not.toBe('Running');
    expect(copy.nextAction).not.toMatch(/openweft stop/);
    expect(copy.nextAction).toMatch(/openweft start/);
  });

  it('still reports a verified live background process as running', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-06-11T00:00:00.000Z'
    });
    checkpoint.status = 'in-progress';

    const copy = buildTerminalRunCopy({
      checkpoint,
      checkpointSource: 'primary',
      pendingQueueCount: 0,
      background: { pid: 4321, alive: true }
    });

    expect(copy.health).toBe('Running in background');
    expect(copy.meaning).toContain('4321');
  });

  it('prioritizes failed durability over backup checkpoint copy', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-03-23T00:00:00.000Z'
    });
    checkpoint.status = 'completed';

    const copy = buildTerminalRunCopy({
      checkpoint,
      checkpointSource: 'backup',
      pendingQueueCount: 0,
      diagnostics: {
        checkpointTimestamps: {
          primaryUpdatedAt: null,
          backupUpdatedAt: '2026-04-06T14:08:49.547Z'
        },
        headCommit: 'abc123',
        mergeDurability: {
          totalCompletedFeatures: 1,
          verifiedCount: 0,
          checks: [
            {
              featureId: '001',
              mergeCommit: 'def456',
              result: 'not-reachable'
            }
          ]
        },
        runtimeArtifacts: {
          codexHomePresent: true,
          residueFileCount: 0
        }
      }
    });

    expect(copy).toMatchObject({
      severity: 'error',
      health: 'Durability check failed'
    });
  });
});
