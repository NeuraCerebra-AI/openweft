import { access, appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import type { RuntimePaths } from './paths.js';

export const ensureDirectory = async (directoryPath: string): Promise<void> => {
  await mkdir(directoryPath, { recursive: true });
};

export const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const ensureRuntimeDirectories = async (paths: RuntimePaths): Promise<void> => {
  await Promise.all([
    ensureDirectory(paths.openweftDir),
    ensureDirectory(paths.featureRequestsDir),
    ensureDirectory(paths.worktreesDir),
    ensureDirectory(paths.shadowPlansDir),
    ensureDirectory(paths.evolvedPlansDir),
    ensureDirectory(paths.promptBArtifactsDir)
  ]);
};

export const readTextFileWithRetry = async (
  filePath: string,
  options: {
    retryDelayMs?: number;
    allowEmpty?: boolean;
  } = {}
): Promise<string> => {
  const retryDelayMs = options.retryDelayMs ?? 100;
  const allowEmpty = options.allowEmpty ?? false;

  const firstRead = await readFile(filePath, 'utf8');
  if (allowEmpty || firstRead.trim().length > 0) {
    return firstRead;
  }

  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  const secondRead = await readFile(filePath, 'utf8');

  if (allowEmpty || secondRead.trim().length > 0) {
    return secondRead;
  }

  throw new Error(`Template empty after retry: ${filePath}`);
};

export const readTextFileIfExists = async (filePath: string): Promise<string | null> => {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

export const writeTextFileAtomic = async (filePath: string, content: string): Promise<void> => {
  await ensureDirectory(path.dirname(filePath));
  await writeFileAtomic(filePath, content, { encoding: 'utf8', fsync: true });
};

export const appendTextFile = async (filePath: string, content: string): Promise<void> => {
  await ensureDirectory(path.dirname(filePath));
  await appendFile(filePath, content, 'utf8');
};

export const writeJsonFileAtomic = async <T>(filePath: string, value: T): Promise<void> => {
  await writeTextFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const appendJsonLine = async <T>(filePath: string, value: T): Promise<void> => {
  await appendTextFile(filePath, `${JSON.stringify(value)}\n`);
};
