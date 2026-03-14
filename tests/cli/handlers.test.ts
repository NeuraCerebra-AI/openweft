import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildProgram } from '../../src/cli/buildProgram.js';
import { createCommandHandlers } from '../../src/cli/handlers.js';
import type { TmuxSpawnInput } from '../../src/tmux/index.js';

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
