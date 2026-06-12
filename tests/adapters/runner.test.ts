import { describe, expect, it } from 'vitest';

import { createExecaCommandRunner } from '../../src/adapters/runner.js';

describe('execa runner', () => {
  it('does not kill a subprocess solely because an idle timeout hint elapsed', async () => {
    const runner = createExecaCommandRunner();

    const result = await runner({
      command: 'node',
      args: ['-e', "setTimeout(() => console.log('done'), 250);"],
      cwd: process.cwd(),
      idleTimeoutMs: 50
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('done');
  });

  it('does not time out while a subprocess keeps emitting output', async () => {
    const runner = createExecaCommandRunner();

    const result = await runner({
      command: 'node',
      args: [
        '-e',
        "let count = 0; const timer = setInterval(() => { console.log(`tick-${count}`); count += 1; if (count === 4) { clearInterval(timer); setTimeout(() => process.exit(0), 10); } }, 40);"
      ],
      cwd: process.cwd(),
      idleTimeoutMs: 120
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('tick-0');
    expect(result.stdout).toContain('tick-3');
  });

  it('preserves spawn failure metadata and never reports missing commands as exit 0', async () => {
    const runner = createExecaCommandRunner();

    const result = await runner({
      command: 'openweft-command-that-does-not-exist',
      args: [],
      cwd: process.cwd()
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.errorCode).toBeTruthy();
    expect(result.errorMessage).toMatch(/openweft-command-that-does-not-exist|ENOENT|not found/i);
    expect(result.failed).toBe(true);
  });

  it('reports spawned child pids to lifecycle hooks and detaches children into their own process group', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const spawned: { pid: number; command: string }[] = [];
    const exited: number[] = [];
    const runner = createExecaCommandRunner({
      detached: true,
      onSpawn: (child) => {
        spawned.push(child);
      },
      onExit: (pid) => {
        exited.push(pid);
      }
    });

    const runnerPromise = runner({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 800);'],
      cwd: process.cwd()
    });

    for (let attempt = 0; attempt < 100 && spawned.length === 0; attempt += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    }
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.command).toBe('node');

    // detached: true makes the child its own process group leader, so the
    // pgid the OS reports for it must equal its own pid.
    const { execa } = await import('execa');
    const psResult = await execa('ps', ['-o', 'pgid=', '-p', String(spawned[0]?.pid)], {
      reject: false
    });
    expect(Number.parseInt(psResult.stdout.trim(), 10)).toBe(spawned[0]?.pid);

    const result = await runnerPromise;
    expect(result.exitCode).toBe(0);
    expect(exited).toEqual(spawned.map((child) => child.pid));
  });

  it('still notifies onExit when the child fails', async () => {
    const exited: number[] = [];
    const runner = createExecaCommandRunner({
      onExit: (pid) => {
        exited.push(pid);
      }
    });

    const result = await runner({
      command: 'node',
      args: ['-e', 'process.exit(3);'],
      cwd: process.cwd()
    });

    expect(result.exitCode).toBe(3);
    expect(exited).toHaveLength(1);
  });
});
