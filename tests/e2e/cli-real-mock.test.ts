import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';

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
      }),
      detectTmux: async () => false
    })
  );

  await program.parseAsync(args, { from: 'user' });

  return output;
};

const createTempRepo = async (): Promise<string> => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-real-e2e-'));
  const git = simpleGit(repoRoot);

  await git.init(['-b', 'main']);
  await git.addConfig('user.name', 'OpenWeft Test');
  await git.addConfig('user.email', 'openweft@example.com');
  await writeFile(path.join(repoRoot, 'README.md'), '# Test Repo\n', 'utf8');
  await git.add(['README.md']);
  await git.commit('initial commit');

  return repoRoot;
};

describe('openweft CLI real mock flow', () => {
  it('plans, executes, merges, and reports a real mock-backed run', async () => {
    const repoRoot = await createTempRepo();

    await runCli(repoRoot, ['init']);
    await writeFile(
      path.join(repoRoot, '.openweftrc.json'),
      `${JSON.stringify(
        {
          backend: 'mock',
          concurrency: {
            maxParallelAgents: 2,
            staggerDelayMs: 0
          }
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    await writeFile(path.join(repoRoot, 'prompts', 'prompt-a.md'), 'Plan {{USER_REQUEST}}.', 'utf8');
    await writeFile(
      path.join(repoRoot, 'prompts', 'plan-adjustment.md'),
      'Review {{CODE_EDIT_SUMMARY}} and update the plan if needed.',
      'utf8'
    );

    await runCli(repoRoot, ['add', 'add dashboard filters']);
    await runCli(repoRoot, ['add', 'add export controls']);

    const startOutput = await runCli(repoRoot, ['start']);
    expect(startOutput).toContain('Run complete: planned 2, merged 2, status completed.');

    const queueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    expect(queueContent).toContain('# ✓ [001] add dashboard filters');
    expect(queueContent).toContain('# ✓ [002] add export controls');

    const createdFeatureOne = await readFile(
      path.join(repoRoot, 'src', 'features', '001-runtime-generated-prompt-b-for-001.ts'),
      'utf8'
    );
    const createdFeatureTwo = await readFile(
      path.join(repoRoot, 'src', 'features', '002-runtime-generated-prompt-b-for-002.ts'),
      'utf8'
    );
    expect(createdFeatureOne).toContain('openweft-mock');
    expect(createdFeatureTwo).toContain('openweft-mock');

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
    expect(statusOutput.join('\n')).toContain('Background: not running');
    expect(statusOutput.join('\n')).toContain('Features: 2 total (2 completed)');
  });
});
