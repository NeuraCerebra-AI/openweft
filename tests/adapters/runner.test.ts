import { describe, expect, it } from 'vitest';

import { createExecaCommandRunner } from '../../src/adapters/runner.js';

describe('execa runner — signal propagation (D2)', () => {
  it('propagates the signal when a subprocess is killed by SIGKILL', async () => {
    const runner = createExecaCommandRunner();

    const result = await runner({
      // Self-terminate via SIGKILL: execa returns exitCode undefined + signal set.
      command: 'node',
      args: ['-e', 'process.kill(process.pid, "SIGKILL");'],
      cwd: process.cwd()
    });

    // exitCode is preserved (1) for backward compatibility...
    expect(result.exitCode).toBe(1);
    // ...but the signal must be surfaced so downstream classification can tell a
    // signal-kill (OOM/SIGKILL/SIGTERM) apart from an ordinary non-zero exit.
    expect((result as { signal?: string | null }).signal).toBe('SIGKILL');
  });

  it('reports a null signal and exitCode 0 for a clean exit', async () => {
    const runner = createExecaCommandRunner();

    const result = await runner({
      command: 'node',
      args: ['-e', 'process.exit(0);'],
      cwd: process.cwd()
    });

    expect(result.exitCode).toBe(0);
    expect((result as { signal?: string | null }).signal).toBeNull();
    expect((result as { timedOut?: boolean }).timedOut).toBe(false);
  });

  it('reports a null signal for an ordinary non-zero exit', async () => {
    const runner = createExecaCommandRunner();

    const result = await runner({
      command: 'node',
      args: ['-e', 'process.exit(3);'],
      cwd: process.cwd()
    });

    expect(result.exitCode).toBe(3);
    expect((result as { signal?: string | null }).signal).toBeNull();
  });
});

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
});
