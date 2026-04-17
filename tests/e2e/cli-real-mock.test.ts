import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';

import { parseQueueFile } from '../../src/domain/queue.js';

const CLI_REAL_MOCK_TIMEOUT_MS = 30_000;

const runCli = async (cwd: string, args: string[]): Promise<string[]> => {
  const output: string[] = [];
  const { buildProgram } = await import('../../src/cli/buildProgram.js');
  const { createCommandHandlers } = await import('../../src/cli/handlers.js');
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

const installMockCliAdapters = async (): Promise<void> => {
  vi.resetModules();
  const actualAdapters = await vi.importActual<typeof import('../../src/adapters/index.js')>(
    '../../src/adapters/index.js'
  );

  class MockCodexCliAdapter extends actualAdapters.MockAgentAdapter {
    constructor(..._args: unknown[]) {
      super();
    }
  }

  class MockClaudeCliAdapter extends actualAdapters.MockAgentAdapter {
    constructor(..._args: unknown[]) {
      super();
    }
  }

  vi.doMock('../../src/adapters/index.js', () => ({
    ...actualAdapters,
    CodexCliAdapter: MockCodexCliAdapter,
    ClaudeCliAdapter: MockClaudeCliAdapter
  }));
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
  afterEach(() => {
    vi.doUnmock('../../src/adapters/index.js');
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('plans, executes, merges, and reports a real mock-backed run', async () => {
    await installMockCliAdapters();
    const repoRoot = await createTempRepo();

    await runCli(repoRoot, ['init']);
    await writeFile(
      path.join(repoRoot, '.openweftrc.json'),
      `${JSON.stringify(
        {
          backend: 'codex',
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
    expect(startOutput.join('\n')).toMatch(
      /Run complete: planned 2, merged 2, status completed, head [0-9a-f]{40}, durability verified \(2\/2 completed features\), codex-home already absent\./
    );

    const queueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    expect(queueContent).toContain('# openweft queue format: v1');
    expect(parseQueueFile(queueContent).processed).toHaveLength(2);
    expect(parseQueueFile(queueContent).processed.map((entry) => entry.featureId)).toEqual(['001', '002']);

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
  }, CLI_REAL_MOCK_TIMEOUT_MS);

  it('keeps the init-created default prompts and persists ledger-bearing plans', async () => {
    await installMockCliAdapters();
    const repoRoot = await createTempRepo();

    await runCli(repoRoot, ['init']);
    await writeFile(
      path.join(repoRoot, '.openweftrc.json'),
      `${JSON.stringify(
        {
          backend: 'codex',
          concurrency: {
            maxParallelAgents: 1,
            staggerDelayMs: 0
          }
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    await runCli(repoRoot, ['add', 'add planner ledger coverage']);
    const startOutput = await runCli(repoRoot, ['start']);
    expect(startOutput.join('\n')).toMatch(
      /Run complete: planned 1, merged 1, status completed, head [0-9a-f]{40}, durability verified \(1\/1 completed features\), codex-home already absent\./
    );

    const checkpoint = JSON.parse(
      await readFile(path.join(repoRoot, '.openweft', 'checkpoint.json'), 'utf8')
    ) as {
      features: Record<string, { planFile: string; promptBFile: string; status: string }>;
    };

    const savedFeature = checkpoint.features['001'];
    const planContent = await readFile(savedFeature?.planFile ?? '', 'utf8');
    const promptBContent = await readFile(savedFeature?.promptBFile ?? '', 'utf8');

    expect(savedFeature?.status).toBe('completed');
    expect(planContent).toContain('## Ledger');
    expect(planContent).toContain('## Manifest');
    expect(promptBContent).toContain('Runtime-generated Prompt B');
  }, CLI_REAL_MOCK_TIMEOUT_MS);
});
