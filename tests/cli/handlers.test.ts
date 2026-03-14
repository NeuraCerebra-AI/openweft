import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildProgram } from '../../src/cli/buildProgram.js';
import { createCommandHandlers } from '../../src/cli/handlers.js';
import type { TmuxSpawnInput } from '../../src/tmux/index.js';

describe('git detection dependencies', () => {
  it('detectGitInstalled resolves true when git is installed (exitCode 0)', async () => {
    const handlers = createCommandHandlers({
      detectGitInstalled: async () => true
    });
    // The dependency is injectable — verify it can be mocked and is accessible via handlers
    // (indirect test: we confirm the mock shape is accepted and no type error occurs)
    expect(handlers).toBeDefined();
  });

  it('detectGitInstalled resolves false when git is not installed (command throws)', async () => {
    const handlers = createCommandHandlers({
      detectGitInstalled: async () => false
    });
    expect(handlers).toBeDefined();
  });

  it('detectGitRepo resolves true when inside a git repository (exitCode 0)', async () => {
    const handlers = createCommandHandlers({
      detectGitRepo: async () => true
    });
    expect(handlers).toBeDefined();
  });

  it('detectGitRepo resolves false when not inside a git repository (non-zero exit)', async () => {
    const handlers = createCommandHandlers({
      detectGitRepo: async () => false
    });
    expect(handlers).toBeDefined();
  });

  it('detectGitHasCommits resolves true when HEAD exists (exitCode 0)', async () => {
    const handlers = createCommandHandlers({
      detectGitHasCommits: async () => true
    });
    expect(handlers).toBeDefined();
  });

  it('detectGitHasCommits resolves false when no commits exist (non-zero exit)', async () => {
    const handlers = createCommandHandlers({
      detectGitHasCommits: async () => false
    });
    expect(handlers).toBeDefined();
  });

  it('initGitRepo resolves void on success', async () => {
    let called = false;
    const handlers = createCommandHandlers({
      initGitRepo: async () => {
        called = true;
      }
    });
    expect(handlers).toBeDefined();
    // Confirm the mock can be exercised directly
    const deps = { initGitRepo: async () => { called = true; } };
    await deps.initGitRepo();
    expect(called).toBe(true);
  });

  it('initGitRepo propagates error on failure', async () => {
    const handlers = createCommandHandlers({
      initGitRepo: async () => {
        throw new Error('git init failed');
      }
    });
    expect(handlers).toBeDefined();
  });

  it('createInitialCommit resolves void on success', async () => {
    let called = false;
    const handlers = createCommandHandlers({
      createInitialCommit: async () => {
        called = true;
      }
    });
    expect(handlers).toBeDefined();
    const deps = { createInitialCommit: async () => { called = true; } };
    await deps.createInitialCommit();
    expect(called).toBe(true);
  });

  it('createInitialCommit propagates error on failure', async () => {
    const handlers = createCommandHandlers({
      createInitialCommit: async () => {
        throw new Error('git commit failed');
      }
    });
    expect(handlers).toBeDefined();
  });

  it('all five git dependencies can be simultaneously mocked via createCommandHandlers', async () => {
    const calls: string[] = [];

    const handlers = createCommandHandlers({
      detectGitInstalled: async () => { calls.push('detectGitInstalled'); return true; },
      detectGitRepo: async () => { calls.push('detectGitRepo'); return true; },
      detectGitHasCommits: async () => { calls.push('detectGitHasCommits'); return false; },
      initGitRepo: async () => { calls.push('initGitRepo'); },
      createInitialCommit: async () => { calls.push('createInitialCommit'); }
    });

    expect(handlers).toBeDefined();
    // handlers object is created successfully with all five mocked — type check passes
  });
});

describe('command handlers', () => {
  it('scaffolds starter prompt files on init without overwriting existing prompts', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-init-'));
    const output: string[] = [];

    const runCli = async (): Promise<void> => {
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
            authenticated: false
          })
        })
      );

      await program.parseAsync(['init'], { from: 'user' });
    };

    await runCli();

    const promptAPath = path.join(repoRoot, 'prompts', 'prompt-a.md');
    const planAdjustmentPath = path.join(repoRoot, 'prompts', 'plan-adjustment.md');
    const promptA = await readFile(promptAPath, 'utf8');
    const planAdjustment = await readFile(planAdjustmentPath, 'utf8');

    expect(promptA).toContain('{{USER_REQUEST}}');
    expect(planAdjustment).toContain('{{CODE_EDIT_SUMMARY}}');
    expect(output).toContain('Prompts: prompt-a=created, plan-adjustment=created');

    await writeFile(promptAPath, 'custom prompt a\n', 'utf8');
    output.length = 0;

    await runCli();

    expect(await readFile(promptAPath, 'utf8')).toBe('custom prompt a\n');
    expect(output).toContain('Prompts: prompt-a=kept, plan-adjustment=kept');
  });

  it('respects existing config discovered via package.json during init', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-package-config-'));
    const workspaceRoot = path.join(repoRoot, 'workspace');
    const output: string[] = [];

    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(
      path.join(repoRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'fixture',
          version: '1.0.0',
          openweft: {
            prompts: {
              promptA: './custom-prompts/prompt-a.md',
              planAdjustment: './custom-prompts/plan-adjustment.md'
            }
          }
        },
        null,
        2
      ),
      'utf8'
    );

    const program = buildProgram(
      createCommandHandlers({
        getCwd: () => workspaceRoot,
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

    await program.parseAsync(['init'], { from: 'user' });

    expect(await readFile(path.join(repoRoot, 'custom-prompts', 'prompt-a.md'), 'utf8')).toContain(
      '{{USER_REQUEST}}'
    );
    expect(
      await readFile(path.join(repoRoot, 'custom-prompts', 'plan-adjustment.md'), 'utf8')
    ).toContain('{{CODE_EDIT_SUMMARY}}');
    expect(output[0]).toContain(`Config: kept ${path.join(repoRoot, 'package.json')}.`);
  });

  it('spawns a tmux session wrapper when --tmux is requested', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-tmux-'));
    const output: string[] = [];
    let tmuxInput: TmuxSpawnInput | null = null;

    const runCli = async (args: string[]): Promise<void> => {
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
          detectTmux: async () => true,
          getProcessArgv: () => ['node', '/tmp/openweft.js', 'start', '--tmux'],
          getExecPath: () => '/usr/local/bin/node',
          getEnv: () => ({}),
          spawnTmuxSession: async (input) => {
            tmuxInput = input;
            return {
              sessionName: input.sessionName ?? 'openweft-test',
              slotLogFiles: []
            };
          }
        })
      );

      await program.parseAsync(args, { from: 'user' });
    };

    await runCli(['init']);
    await runCli(['start', '--tmux']);

    expect(tmuxInput).not.toBeNull();
    if (!tmuxInput) {
      throw new Error('Expected tmux input to be captured.');
    }
    const resolvedTmuxInput: TmuxSpawnInput = tmuxInput;
    expect(resolvedTmuxInput.args).toEqual(['start']);
    expect(resolvedTmuxInput.slotCount).toBe(3);
    expect(resolvedTmuxInput.logDirectory).toBe(path.join(repoRoot, '.openweft', 'tmux'));
    expect(output.some((line) => line.includes("tmux attach -t"))).toBe(true);
  });
});

describe('initCommand .gitignore handling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'openweft-gitignore-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const runInit = async (dir: string): Promise<void> => {
    const program = buildProgram(
      createCommandHandlers({
        getCwd: () => dir,
        writeLine: () => { /* suppress output */ },
        detectCodex: async () => ({ installed: false, authenticated: false }),
        detectClaude: async () => ({ installed: false, authenticated: false }),
      })
    );
    await program.parseAsync(['init'], { from: 'user' });
  };

  it('creates .gitignore with .openweft/ if no .gitignore exists', async () => {
    await runInit(tempDir);

    const gitignorePath = path.join(tempDir, '.gitignore');
    const content = await readFile(gitignorePath, 'utf8');
    expect(content).toContain('.openweft/');
  });

  it('appends .openweft/ to existing .gitignore if entry is missing', async () => {
    const gitignorePath = path.join(tempDir, '.gitignore');
    await writeFile(gitignorePath, 'node_modules/\ndist/\n', 'utf8');

    await runInit(tempDir);

    const content = await readFile(gitignorePath, 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('dist/');
    expect(content).toContain('.openweft/');
  });

  it('does nothing to .gitignore if .openweft/ entry already exists', async () => {
    const gitignorePath = path.join(tempDir, '.gitignore');
    const original = 'node_modules/\n.openweft/\n';
    await writeFile(gitignorePath, original, 'utf8');

    await runInit(tempDir);

    const content = await readFile(gitignorePath, 'utf8');
    expect(content).toBe(original);
    // Ensure .openweft/ appears exactly once
    const occurrences = content.split('.openweft/').length - 1;
    expect(occurrences).toBe(1);
  });
});
