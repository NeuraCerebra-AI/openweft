import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  appendJsonLine,
  appendTextFile,
  pathExists,
  readTextFileIfExists,
  readTextFileWithRetry,
  writeJsonFileAtomic,
  writeTextFileAtomic
} from '../../src/fs/index.js';

describe('filesystem helpers', () => {
  it('retries once when a file is temporarily empty', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-files-'));
    const filePath = path.join(tempDirectory, 'prompt.md');

    await writeFile(filePath, '', 'utf8');
    setTimeout(() => {
      void writeFile(filePath, 'real content', 'utf8');
    }, 10);

    await expect(readTextFileWithRetry(filePath, { retryDelayMs: 50 })).resolves.toBe('real content');
  });

  it('writes text and json atomically', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-files-write-'));
    const textPath = path.join(tempDirectory, 'plain.txt');
    const jsonPath = path.join(tempDirectory, 'data.json');

    await writeTextFileAtomic(textPath, 'hello');
    await writeJsonFileAtomic(jsonPath, { ok: true });

    await expect(readTextFileWithRetry(textPath, { allowEmpty: true })).resolves.toBe('hello');
    await expect(readTextFileWithRetry(jsonPath, { allowEmpty: true })).resolves.toContain('"ok": true');
  });

  it('supports optional reads, existence checks, and jsonl appends', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'openweft-files-extra-'));
    const missingPath = path.join(tempDirectory, 'missing.txt');
    const jsonlPath = path.join(tempDirectory, 'costs.jsonl');

    await expect(pathExists(missingPath)).resolves.toBe(false);
    await expect(readTextFileIfExists(missingPath)).resolves.toBeNull();

    await appendTextFile(jsonlPath, 'first\n');
    await appendJsonLine(jsonlPath, { id: 1 });
    await appendJsonLine(jsonlPath, { id: 2 });

    await expect(pathExists(jsonlPath)).resolves.toBe(true);
    await expect(readTextFileIfExists(jsonlPath)).resolves.toBe('first\n{"id":1}\n{"id":2}\n');
  });
});
