import { describe, expect, it } from 'vitest';

import { createEmptyCheckpoint } from '../../src/state/checkpoint.js';
import { renderStatusReport } from '../../src/status/renderStatus.js';

describe('renderStatusReport', () => {
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
