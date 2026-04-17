import { describe, expect, it } from 'vitest';

import { createEmptyCheckpoint } from '../../src/state/checkpoint.js';
import { renderStatusReport } from '../../src/status/renderStatus.js';

describe('renderStatusReport', () => {
  const diagnostics = {
    checkpointTimestamps: {
      primaryUpdatedAt: '2026-04-06T14:08:49.618Z',
      backupUpdatedAt: '2026-04-06T14:08:49.547Z'
    },
    headCommit: 'ef7e12b2e42315b746794b4955a6f287e52ca1f3',
    mergeDurability: {
      totalCompletedFeatures: 1,
      verifiedCount: 1,
      checks: [
        {
          featureId: '001',
          mergeCommit: 'ef7e12b2e42315b746794b4955a6f287e52ca1f3',
          result: 'verified'
        }
      ]
    },
    runtimeArtifacts: {
      codexHomePresent: false,
      residueFileCount: 0
    }
  } as const;

  it('defaults to a token-only usage line', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-03-23T00:00:00.000Z'
    });
    checkpoint.cost.totalInputTokens = 384000;
    checkpoint.cost.totalOutputTokens = 4000;
    checkpoint.cost.totalEstimatedUsd = 0.728;

    const report = renderStatusReport({
      checkpoint,
      checkpointSource: 'primary',
      queueContent: '# OpenWeft feature queue\n'
    });

    expect(report).toContain('Tokens: 384000 input / 4000 output');
    expect(report).not.toContain('Cost:');
  });

  it('keeps token-only usage even when old config asks for estimated cost', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-03-23T00:00:00.000Z'
    });
    checkpoint.cost.totalInputTokens = 384000;
    checkpoint.cost.totalOutputTokens = 4000;
    checkpoint.cost.totalEstimatedUsd = 0.728;

    const report = renderStatusReport({
      checkpoint,
      checkpointSource: 'primary',
      queueContent: '# OpenWeft feature queue\n',
      usageDisplay: 'estimated-cost'
    });

    expect(report).toContain('Tokens: 384000 input / 4000 output');
    expect(report).not.toContain('Cost:');
    expect(report).not.toContain('$0.728000');
  });

  it('bounds huge feature request labels in status output', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-03-23T00:00:00.000Z'
    });
    const hugeRequest = `build ${'giant '.repeat(80)}thing`;
    const normalized = hugeRequest.trim().replace(/\s+/g, ' ');
    checkpoint.features['001'] = {
      id: '001',
      request: hugeRequest,
      status: 'planned',
      attempts: 0,
      planFile: null,
      promptBFile: null,
      evolvedPlanFile: null,
      branchName: null,
      worktreePath: null,
      sessionId: null,
      sessionScope: null,
      backend: 'mock',
      manifest: null,
      rerunEligible: true,
      mergeResolutionAttempts: 0,
      priorityScore: null,
      priorityTier: null,
      scoringCycles: 0,
      updatedAt: '2026-03-23T00:00:00.000Z'
    };

    const report = renderStatusReport({
      checkpoint,
      checkpointSource: 'primary',
      queueContent: '# OpenWeft feature queue\n'
    });

    expect(report).toContain(`${normalized.slice(0, 160)}...`);
    expect(report).not.toContain(normalized);
  });

  it('discloses when status is rendering from the backup checkpoint', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-03-23T00:00:00.000Z'
    });

    const report = renderStatusReport({
      checkpoint,
      checkpointSource: 'backup',
      queueContent: '# OpenWeft feature queue\n',
      diagnostics
    });

    expect(report).toContain('Checkpoint Source: backup');
    expect(report).toContain('Primary Checkpoint Updated: 2026-04-06T14:08:49.618Z');
    expect(report).toContain('Backup Checkpoint Updated: 2026-04-06T14:08:49.547Z');
    expect(report).toContain('Backup Semantics: previous snapshot by design');
  });

  it('renders a verified merge durability summary', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-03-23T00:00:00.000Z'
    });

    const report = renderStatusReport({
      checkpoint,
      checkpointSource: 'primary',
      queueContent: '# OpenWeft feature queue\n',
      diagnostics
    });

    expect(report).toContain('Current HEAD: ef7e12b2e42315b746794b4955a6f287e52ca1f3');
    expect(report).toContain('Current HEAD Check: verified (1/1 completed features)');
    expect(report).toContain('Runtime Artifacts: codex-home missing');
  });

  it('renders failing merge durability details', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-03-23T00:00:00.000Z'
    });

    const report = renderStatusReport({
      checkpoint,
      checkpointSource: 'primary',
      queueContent: '# OpenWeft feature queue\n',
      diagnostics: {
        ...diagnostics,
        mergeDurability: {
          totalCompletedFeatures: 2,
          verifiedCount: 1,
          checks: [
            ...diagnostics.mergeDurability.checks,
            {
              featureId: '002',
              mergeCommit: 'deadbeef',
              result: 'not-reachable'
            }
          ]
        }
      }
    });

    expect(report).toContain('Current HEAD Check: FAILED (002 not reachable from current HEAD)');
  });

  it('renders preserved runtime artifacts details', () => {
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-03-23T00:00:00.000Z'
    });

    const report = renderStatusReport({
      checkpoint,
      checkpointSource: 'primary',
      queueContent: '# OpenWeft feature queue\n',
      diagnostics: {
        ...diagnostics,
        runtimeArtifacts: {
          codexHomePresent: true,
          residueFileCount: 7
        }
      }
    });

    expect(report).toContain('Runtime Artifacts: preserved (7 residue files under .openweft/codex-home)');
  });
});
