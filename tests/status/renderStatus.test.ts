import { describe, expect, it } from 'vitest';

import { createEmptyCheckpoint } from '../../src/state/checkpoint.js';
import { renderStatusReport } from '../../src/status/renderStatus.js';

describe('renderStatusReport', () => {
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

  it('can still render the estimated cost line when explicitly enabled', () => {
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

    expect(report).toContain('Cost: $0.728000 (384000 input / 4000 output tokens)');
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
      queueContent: '# OpenWeft feature queue\n'
    });

    expect(report).toContain('Checkpoint Source: backup');
  });
});
