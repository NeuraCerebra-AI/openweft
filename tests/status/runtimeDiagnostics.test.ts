import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectRuntimeDiagnostics, summarizeCurrentHeadCheck } from '../../src/status/runtimeDiagnostics.js';
import type { FeatureCheckpoint } from '../../src/state/checkpoint.js';

const completedFeatureWithoutMergeCommit = (): FeatureCheckpoint => ({
  id: '001',
  request: 'add password reset flow',
  status: 'completed',
  attempts: 1,
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
  updatedAt: '2026-06-11T00:00:00.000Z'
});

const diagnosticsInput = async (runMode?: 'real' | 'dry-run') => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openweft-diag-'));
  return {
    repoRoot: root,
    checkpointFile: path.join(root, 'checkpoint.json'),
    checkpointBackupFile: path.join(root, 'checkpoint.json.backup'),
    codexHomeDir: path.join(root, 'codex-home'),
    completedFeatures: [completedFeatureWithoutMergeCommit()],
    ...(runMode ? { runMode } : {})
  };
};

describe('collectRuntimeDiagnostics merge durability', () => {
  it('skips merge durability checks for dry-run checkpoints', async () => {
    const diagnostics = await collectRuntimeDiagnostics(await diagnosticsInput('dry-run'));

    expect(diagnostics.mergeDurability.checks).toHaveLength(0);
    expect(summarizeCurrentHeadCheck(diagnostics)).toBe('skipped (dry run)');
  });

  it('still fails real-run durability when a completed feature has no merge commit', async () => {
    const diagnostics = await collectRuntimeDiagnostics(await diagnosticsInput());

    expect(diagnostics.mergeDurability.checks).toHaveLength(1);
    expect(summarizeCurrentHeadCheck(diagnostics)).toBe(
      'FAILED (001 is missing a recorded merge commit)'
    );
  });

  it('still fails durability for an explicit real run with no merge commit', async () => {
    const diagnostics = await collectRuntimeDiagnostics(await diagnosticsInput('real'));

    expect(summarizeCurrentHeadCheck(diagnostics)).toBe(
      'FAILED (001 is missing a recorded merge commit)'
    );
  });
});
