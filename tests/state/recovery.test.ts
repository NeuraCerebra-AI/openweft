import { describe, expect, it } from 'vitest';

import { createEmptyCheckpoint } from '../../src/state/checkpoint.js';
import { hasActionableUnfinishedWork } from '../../src/state/recovery.js';

describe('checkpoint recovery helpers', () => {
  it('treats stopped checkpoints with planned, review, failed retryable, or pending-merge work as actionable', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: '0.1.0',
      configHash: 'sha256:test',
      runId: 'run-1',
      checkpointId: 'chk-1',
      createdAt: '2026-03-13T08:00:00.000Z'
    });
    checkpoint.status = 'stopped';
    checkpoint.features['001'] = {
      id: '001',
      request: 'Add auth',
      status: 'planning-needs-review',
      attempts: 0,
      planFile: '/tmp/001.plan.md',
      promptBFile: null,
      evolvedPlanFile: null,
      branchName: null,
      worktreePath: null,
      sessionId: null,
      sessionScope: null,
      backend: 'mock',
      manifest: null,
      manifestRecoveryMethod: null,
      manifestConfidence: null,
      reviewReason: 'Planner exhausted repair attempts.',
      blockedByFeatureIds: [],
      rerunEligible: true,
      mergeResolutionAttempts: 0,
      priorityScore: null,
      priorityTier: null,
      scoringCycles: 0,
      updatedAt: '2026-03-13T08:00:00.000Z'
    };

    expect(hasActionableUnfinishedWork(checkpoint, [])).toBe(true);

    checkpoint.features['001'].status = 'failed';
    checkpoint.features['001'].rerunEligible = false;
    expect(hasActionableUnfinishedWork(checkpoint, [])).toBe(false);

    checkpoint.pendingMergeSummaries = [
      {
        featureId: '001',
        summary: {
          merge_commit: 'abc123',
          branch: 'openweft-001',
          pre_merge_commit: 'base123',
          total_files_changed: 1,
          total_lines_added: 1,
          total_lines_removed: 0,
          files: [
            {
              path: 'src/auth.ts',
              change_type: 'modified',
              lines_added: 1,
              lines_removed: 0,
              old_path: null
            }
          ]
        }
      }
    ];
    expect(hasActionableUnfinishedWork(checkpoint, [])).toBe(true);
  });

  it('treats unprocessed queue entries as actionable even without checkpoint features', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: '0.1.0',
      configHash: 'sha256:test',
      runId: 'run-1',
      checkpointId: 'chk-1',
      createdAt: '2026-03-13T08:00:00.000Z'
    });

    expect(
      hasActionableUnfinishedWork(checkpoint, [
        {
          kind: 'pending'
        }
      ])
    ).toBe(true);
  });
});
