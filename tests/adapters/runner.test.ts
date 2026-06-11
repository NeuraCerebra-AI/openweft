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
});
