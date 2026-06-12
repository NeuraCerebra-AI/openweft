import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildProgram } from '../../src/cli/buildProgram.js';
import { createCommandHandlers } from '../../src/cli/handlers.js';
import { OPENWEFT_PID_ARGV_MARKER, serializePidFileRecord } from '../../src/cli/pidFile.js';

const PROCESS_START_TIME = 'Wed Jun 10 09:00:00 2026';

const writePidRecord = async (repoRoot: string, pid: number): Promise<void> => {
  await mkdir(path.join(repoRoot, '.openweft'), { recursive: true });
  await writeFile(
    path.join(repoRoot, '.openweft', 'pid'),
    serializePidFileRecord({
      pid,
      startedAt: '2026-06-11T10:00:00.000Z',
      argvMarker: OPENWEFT_PID_ARGV_MARKER,
      processStartTime: PROCESS_START_TIME
    }),
    'utf8'
  );
};

describe('openweft CLI background flow', () => {
  const initialExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = initialExitCode;
  });

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
            await writePidRecord(repoRoot, 4321);
            return 4321;
          },
          isPidAlive: () => alive,
          getProcessStartTime: async () => PROCESS_START_TIME,
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
    expect(startOutput).toContain(
      "► Backgrounded (PID 4321). Use 'openweft status' to check progress; raw output is in .openweft/output.log."
    );
    const pidContent = await readFile(path.join(repoRoot, '.openweft', 'pid'), 'utf8');
    expect(JSON.parse(pidContent)).toMatchObject({
      pid: 4321,
      argvMarker: 'openweft'
    });

    alive = true;
    const statusOutput = await runCli(['status']);
    expect(statusOutput.join('\n')).toContain('Background: running (PID 4321)');

    const stopOutput = await runCli(['stop']);
    expect(sentSignal).toBe('SIGTERM');
    expect(stopOutput).toContain(
      'Sent SIGTERM to OpenWeft background process 4321. Waiting for the next phase-safe checkpoint...'
    );
    expect(stopOutput).toContain('OpenWeft background run stopped.');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('sets a non-zero exit code and kills recorded agent process groups when stop escalates to SIGKILL', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-bg-sigkill-e2e-'));
    const sentSignals: { pid: number; signal: string }[] = [];

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
          isPidAlive: () => true,
          getProcessStartTime: async () => PROCESS_START_TIME,
          sendSignal: (pid, signal) => {
            sentSignals.push({ pid, signal });
          },
          sleep: async () => {}
        })
      );

      await program.parseAsync(args, { from: 'user' });
      return output;
    };

    await runCli(['init']);
    await writePidRecord(repoRoot, 4321);
    await writeFile(
      path.join(repoRoot, '.openweft', 'agent-pids.json'),
      `${JSON.stringify({
        version: 1,
        entries: [
          {
            pid: 9999,
            pgid: 9999,
            command: 'codex',
            startedAt: '2026-06-11T10:00:00.000Z'
          }
        ]
      })}\n`,
      'utf8'
    );

    const stopOutput = await runCli(['stop']);
    expect(sentSignals[0]).toEqual({ pid: 4321, signal: 'SIGTERM' });
    if (process.platform !== 'win32') {
      // Escalation must target the agent process group before SIGKILLing the
      // orchestrator, so the in-flight codex/claude child cannot be orphaned.
      expect(sentSignals).toContainEqual({ pid: -9999, signal: 'SIGTERM' });
      expect(sentSignals).toContainEqual({ pid: -9999, signal: 'SIGKILL' });
    }
    expect(sentSignals).toContainEqual({ pid: 4321, signal: 'SIGKILL' });
    expect(stopOutput).toContain(
      'Background process 4321 did not exit after SIGTERM; sent SIGKILL and removed PID file.'
    );
    expect(stopOutput.some((line) => /agent subprocess/i.test(line))).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('refuses to signal a recorded PID that now belongs to a different process', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-bg-pid-reuse-e2e-'));
    const sentSignals: string[] = [];
    const output: string[] = [];

    const program = buildProgram(
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
        }),
        detectTmux: async () => false,
        isPidAlive: () => true,
        getProcessStartTime: async () => 'Thu Jun 11 11:11:11 2026',
        sendSignal: (_pid, signal) => {
          sentSignals.push(signal);
        },
        sleep: async () => {}
      })
    );

    await program.parseAsync(['init'], { from: 'user' });
    await writePidRecord(repoRoot, 4321);

    output.length = 0;
    await program.parseAsync(['stop'], { from: 'user' });

    expect(sentSignals).toEqual([]);
    expect(output.join('\n')).toMatch(/different process|PID reuse/i);
    await expect(readFile(path.join(repoRoot, '.openweft', 'pid'), 'utf8')).rejects.toThrow();
    expect(process.exitCode ?? 0).toBe(0);
  });
});
