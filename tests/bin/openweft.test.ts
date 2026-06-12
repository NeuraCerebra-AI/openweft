import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const binEntry = path.join(repoRoot, 'src', 'bin', 'openweft.ts');

const BIN_TIMEOUT_MS = 30_000;

describe('openweft bin entrypoint', () => {
  it('exits 1 with a clean stderr message when a command fails', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'openweft-bin-e2e-'));

    const result = await execa(tsxBin, [binEntry, 'status'], {
      cwd,
      reject: false
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('OpenWeft is not initialized here. Run "openweft init" first.');
    // The error boundary should print the message, not a raw stack trace.
    expect(result.stderr).not.toMatch(/^\s+at /m);
  }, BIN_TIMEOUT_MS);
});
