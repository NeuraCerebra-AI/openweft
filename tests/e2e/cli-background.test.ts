import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildProgram } from '../../src/cli/buildProgram.js';
import { createCommandHandlers } from '../../src/cli/handlers.js';

describe('openweft CLI background flow', () => {
  it('writes a PID file, reports background status, and stops cleanly', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-bg-e2e-'));
    let alive = true;
    let sentSignal: string | null = null;

    const runCli = async (args: string[]): Promise<string[]> => {
      const output: string[] = [];
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
          detectTmux: async () => false,
          spawnBackground: async () => {
            await writeFile(path.join(repoRoot, '.openweft', 'pid'), '4321\n', 'utf8');
            return 4321;
          },
          isPidAlive: () => alive,
          sendSignal: (_pid, signal) => {
            sentSignal = signal;
            alive = false;
          },
          sleep: async () => {}
        })
      );

      await program.parseAsync(args, { from: 'user' });
      return output;
    };

    await runCli(['init']);

    const startOutput = await runCli(['start', '--bg']);
    expect(startOutput).toContain("► Backgrounded (PID 4321). Use 'openweft status' to check progress.");
    expect(await readFile(path.join(repoRoot, '.openweft', 'pid'), 'utf8')).toBe('4321\n');

    alive = true;
    const statusOutput = await runCli(['status']);
    expect(statusOutput.join('\n')).toContain('Background: running (PID 4321)');

    const stopOutput = await runCli(['stop']);
    expect(sentSignal).toBe('SIGTERM');
    expect(stopOutput).toContain(
      'Sent SIGTERM to OpenWeft background process 4321. Waiting for the current phase to finish...'
    );
    expect(stopOutput).toContain('OpenWeft background run stopped.');
  });
});
