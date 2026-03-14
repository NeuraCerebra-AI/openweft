import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildProgram } from '../../src/cli/buildProgram.js';
import { createCommandHandlers } from '../../src/cli/handlers.js';

const runCli = async (cwd: string, args: string[]): Promise<string[]> => {
  const output: string[] = [];
  const program = buildProgram(
    createCommandHandlers({
      getCwd: () => cwd,
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
      })
    })
  );

  await program.parseAsync(args, { from: 'user' });

  return output;
};

describe('openweft CLI dry-run flow', () => {
  it('initializes the repo scaffold and runs a dry-run batch end to end', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-e2e-'));

    const initOutput = await runCli(repoRoot, ['init']);
    expect(initOutput[0]).toContain('Initialized OpenWeft');

    const firstAddOutput = await runCli(repoRoot, ['add', 'add dark mode toggle']);
    const secondAddOutput = await runCli(repoRoot, ['add', 'refactor auth middleware']);
    expect(firstAddOutput).toContain('Queued #001 "add dark mode toggle"');
    expect(secondAddOutput).toContain('Queued #002 "refactor auth middleware"');

    const startOutput = await runCli(repoRoot, ['start', '--dry-run']);
    expect(startOutput).toContain('Dry run complete: planned 2, completed 2.');

    const queueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    expect(queueContent).toContain('# ✓ [001] add dark mode toggle');
    expect(queueContent).toContain('# ✓ [002] refactor auth middleware');

    const checkpoint = JSON.parse(
      await readFile(path.join(repoRoot, '.openweft', 'checkpoint.json'), 'utf8')
    ) as {
      status: string;
      features: Record<string, { status: string }>;
    };
    expect(checkpoint.status).toBe('completed');
    expect(Object.values(checkpoint.features).every((feature) => feature.status === 'completed')).toBe(true);

    const statusOutput = await runCli(repoRoot, ['status']);
    expect(statusOutput.join('\n')).toContain('Status: completed');
    expect(statusOutput.join('\n')).toContain('Pending Queue: 0');
    expect(statusOutput.join('\n')).toContain('Features: 2 total (2 completed)');

    const stopOutput = await runCli(repoRoot, ['stop']);
    expect(stopOutput).toContain('No background OpenWeft run is active.');
  });
});
