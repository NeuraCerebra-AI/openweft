import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const binEntry = fileURLToPath(new URL('../../src/bin/openweft.ts', import.meta.url));
const tsxBin = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));

/**
 * D1: the CLI entrypoint must turn expected handler errors into a clean,
 * single-line message and a non-zero exit code — NOT a raw V8 stack trace.
 */
describe('openweft CLI error handling (D1)', () => {
  const runCli = async (args: string[]) => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-err-'));
    return execa(tsxBin, [binEntry, ...args], {
      cwd,
      reject: false,
      env: { ...process.env, NO_COLOR: '1' }
    });
  };

  it('prints a clean message (no stack trace) and exits non-zero for an expected error', async () => {
    const result = await runCli(['add', 'build a feature']);

    // Non-zero exit code.
    expect(result.exitCode).not.toBe(0);

    const combined = `${result.stdout}\n${result.stderr}`;

    // The human-readable message must be present.
    expect(combined).toContain('OpenWeft is not initialized here. Run "openweft init" first.');

    // It must NOT include a raw V8 stack trace / code frame.
    expect(combined).not.toMatch(/^\s*at\s+.+:\d+:\d+\)?$/m);
    expect(combined).not.toContain('handlers.ts:');
    expect(combined).not.toMatch(/throw new Error\(/);
  }, 30000);
});
