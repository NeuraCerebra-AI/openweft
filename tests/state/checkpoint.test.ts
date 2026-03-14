import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyCheckpoint, loadCheckpoint, saveCheckpoint } from '../../src/state/index.js';

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
});
