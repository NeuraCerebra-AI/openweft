import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scrubCodexHomeCredentials } from '../../src/orchestrator/finalization.js';

const makeTempDir = async (): Promise<string> => mkdtemp(path.join(os.tmpdir(), 'openweft-scrub-'));

describe('scrubCodexHomeCredentials', () => {
  it('removes nested auth.json files and reports counts', async () => {
    const codexHomeDir = await makeTempDir();
    const workerA = path.join(codexHomeDir, '001');
    const workerB = path.join(codexHomeDir, '002', 'nested');
    await mkdir(workerA, { recursive: true });
    await mkdir(workerB, { recursive: true });

    const authA = path.join(workerA, 'auth.json');
    const authB = path.join(workerB, 'auth.json');
    await writeFile(authA, '{"token":"secret-a"}\n', 'utf8');
    await writeFile(authB, '{"token":"secret-b"}\n', 'utf8');
    // A non-credential file with a similar name must be left untouched.
    const keep = path.join(workerA, 'auth.json.bak');
    await writeFile(keep, 'keep-me\n', 'utf8');

    const result = await scrubCodexHomeCredentials(codexHomeDir);

    expect(result).toEqual({ removed: 2, remaining: 0 });
    await expect(access(authA)).rejects.toThrow();
    await expect(access(authB)).rejects.toThrow();
    // Non-credential file must still be present.
    await expect(access(keep)).resolves.toBeUndefined();
  });

  it('does not follow or remove through a symlink named auth.json', async () => {
    const codexHomeDir = await makeTempDir();
    const outsideDir = await makeTempDir();

    // A real credential outside the codex-home tree that a symlink points at.
    const outsideTarget = path.join(outsideDir, 'auth.json');
    await writeFile(outsideTarget, '{"token":"outside"}\n', 'utf8');

    // A symlink inside codex-home named auth.json -> outside target. Must NOT be
    // followed or removed-through (the real outside file must survive).
    const linkPath = path.join(codexHomeDir, 'auth.json');
    await symlink(outsideTarget, linkPath);

    const result = await scrubCodexHomeCredentials(codexHomeDir);

    expect(result).toEqual({ removed: 0, remaining: 0 });
    // The symlink target outside the tree must remain intact.
    await expect(access(outsideTarget)).resolves.toBeUndefined();
    expect(await readFile(outsideTarget, 'utf8')).toContain('outside');
  });

  it('tolerates a missing directory (ENOENT) and returns zero counts', async () => {
    const codexHomeDir = path.join(os.tmpdir(), 'openweft-scrub-missing-does-not-exist-xyz');

    const result = await scrubCodexHomeCredentials(codexHomeDir);

    expect(result).toEqual({ removed: 0, remaining: 0 });
  });

  it('is idempotent — a second scrub finds nothing to remove', async () => {
    const codexHomeDir = await makeTempDir();
    const worker = path.join(codexHomeDir, '001');
    await mkdir(worker, { recursive: true });
    await writeFile(path.join(worker, 'auth.json'), '{"token":"secret"}\n', 'utf8');

    const first = await scrubCodexHomeCredentials(codexHomeDir);
    expect(first).toEqual({ removed: 1, remaining: 0 });

    const second = await scrubCodexHomeCredentials(codexHomeDir);
    expect(second).toEqual({ removed: 0, remaining: 0 });
  });
});
