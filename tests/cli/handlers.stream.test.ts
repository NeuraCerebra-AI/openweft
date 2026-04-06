import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

vi.mock('fullscreen-ink', () => ({
  withFullScreen: () => {
    throw new Error('tui-started');
  }
}));

vi.mock('../../src/orchestrator/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/orchestrator/index.js')>();
  return {
    ...original,
    runRealOrchestration: vi.fn()
  };
});

import { buildProgram } from '../../src/cli/buildProgram.js';
import { createCommandHandlers } from '../../src/cli/handlers.js';
import { runRealOrchestration } from '../../src/orchestrator/index.js';
import { createEmptyCheckpoint } from '../../src/state/checkpoint.js';

describe('stream start behavior', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalIsTTY = process.stdout.isTTY;
  });

  afterEach(() => {
    if (originalIsTTY !== undefined) {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        configurable: true
      });
    }
  });

  it('honors --stream on TTY instead of opening the dashboard session', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-stream-tty-'));
    const output: string[] = [];
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash: 'test-config-hash',
      runId: 'test-run',
      checkpointId: 'test-checkpoint',
      createdAt: '2026-03-24T00:00:00.000Z'
    });
    checkpoint.status = 'completed';

    (runRealOrchestration as MockedFunction<typeof runRealOrchestration>).mockResolvedValue({
      checkpoint,
      plannedCount: 0,
      mergedCount: 0,
      finalizationSummary: {
        event: 'run.completed',
        status: 'completed',
        finalHead: 'abc123',
        unresolvedFailedFeatureIds: [],
        mergeDurability: {
          totalCompletedFeatures: 0,
          verifiedCount: 0,
          checks: []
        },
        runtimeCleanup: {
          policy: 'on-success-clean',
          action: 'nothing-to-clean',
          error: null
        },
        diagnostics: {
          checkpointTimestamps: {
            primaryUpdatedAt: '2026-03-24T00:00:00.000Z',
            backupUpdatedAt: null
          },
          headCommit: 'abc123',
          mergeDurability: {
            totalCompletedFeatures: 0,
            verifiedCount: 0,
            checks: []
          },
          runtimeArtifacts: {
            codexHomePresent: false,
            residueFileCount: 0
          }
        }
      }
    });

    const initProgram = buildProgram(
      createCommandHandlers({
        getCwd: () => repoRoot,
        writeLine: (message) => {
          output.push(message);
        },
        detectGitRepo: async () => true,
        detectCodex: async () => ({
          installed: true,
          authenticated: true
        }),
        detectClaude: async () => ({
          installed: true,
          authenticated: true
        })
      })
    );
    await initProgram.parseAsync(['init'], { from: 'user' });

    output.length = 0;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true
    });

    const program = buildProgram(
      createCommandHandlers({
        getCwd: () => repoRoot,
        writeLine: (message) => {
          output.push(message);
        },
        detectCodex: async () => ({
          installed: true,
          authenticated: true
        }),
        detectClaude: async () => ({
          installed: true,
          authenticated: true
        }),
        sleep: async () => {}
      })
    );

    await expect(program.parseAsync(['start', '--stream'], { from: 'user' })).resolves.toBeDefined();
    expect(runRealOrchestration).toHaveBeenCalledOnce();
    expect(output.some((line) => line.includes('Run complete: planned 0, merged 0, status completed, head abc123, durability verified (0/0 completed features), codex-home already absent.'))).toBe(true);
  });
});
