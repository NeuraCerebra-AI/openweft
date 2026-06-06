import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectRuntimeDiagnostics } from '../../src/status/runtimeDiagnostics.js';

// A path-keyed override for readdir: when set, calling readdir on that exact
// path throws the supplied error (simulating a subdirectory becoming
// unreadable / disappearing mid-walk during concurrent cleanup).
const readdirThrowOnPath = { current: null as string | null };

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    default: actual,
    readdir: (async (dirPath: unknown, options?: unknown) => {
      if (
        typeof dirPath === 'string' &&
        readdirThrowOnPath.current !== null &&
        dirPath === readdirThrowOnPath.current
      ) {
        const error = new Error(
          `ENOENT: no such file or directory, scandir '${dirPath}'`
        ) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return (actual.readdir as (...args: unknown[]) => unknown)(dirPath, options);
    }) as typeof actual.readdir
  };
});

const tempDirs: string[] = [];

const makeTempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  readdirThrowOnPath.current = null;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('countResidueFiles concurrent-deletion tolerance', () => {
  it('counts residue files in nested subdirectories', async () => {
    const root = await makeTempDir('openweft-residue-count-');
    const codexHome = path.join(root, 'codex-home');
    await mkdir(path.join(codexHome, 'sessions'), { recursive: true });
    await writeFile(path.join(codexHome, 'a.sqlite'), 'x');
    await writeFile(path.join(codexHome, 'sessions', 'b.jsonl'), 'y');
    await writeFile(path.join(codexHome, 'sessions', 'c.txt'), 'z');

    const diagnostics = await collectRuntimeDiagnostics({
      repoRoot: root,
      checkpointFile: path.join(root, 'checkpoint.json'),
      checkpointBackupFile: path.join(root, 'checkpoint.json.backup'),
      codexHomeDir: codexHome,
      completedFeatures: []
    });

    expect(diagnostics.runtimeArtifacts.codexHomePresent).toBe(true);
    expect(diagnostics.runtimeArtifacts.residueFileCount).toBe(2);
  });

  it('tolerates a subdirectory readdir throwing mid-walk (no throw, partial count returned)', async () => {
    const root = await makeTempDir('openweft-residue-midwalk-');
    const codexHome = path.join(root, 'codex-home');
    const readableSub = path.join(codexHome, 'readable');
    const vanishingSub = path.join(codexHome, 'vanishing');
    await mkdir(readableSub, { recursive: true });
    await mkdir(vanishingSub, { recursive: true });
    await writeFile(path.join(codexHome, 'top.sqlite'), 'x');
    await writeFile(path.join(readableSub, 'r.jsonl'), 'y');
    await writeFile(path.join(vanishingSub, 'hidden.jsonl'), 'z');

    // Simulate concurrent cleanup: the recursive readdir on the "vanishing"
    // subdirectory races with deletion and throws ENOENT mid-walk. The
    // top-level codex-home readdir (and the readable subdir) still succeed.
    readdirThrowOnPath.current = vanishingSub;

    const diagnostics = await collectRuntimeDiagnostics({
      repoRoot: root,
      checkpointFile: path.join(root, 'checkpoint.json'),
      checkpointBackupFile: path.join(root, 'checkpoint.json.backup'),
      codexHomeDir: codexHome,
      completedFeatures: []
    });

    // codexHomePresent must remain true and the count must reflect the
    // readable residue files (top.sqlite + readable/r.jsonl = 2) instead of
    // collapsing to 0 because of an unguarded throw bubbling to the top-level
    // .catch(() => 0).
    expect(diagnostics.runtimeArtifacts.codexHomePresent).toBe(true);
    expect(diagnostics.runtimeArtifacts.residueFileCount).toBe(2);
  });
});
