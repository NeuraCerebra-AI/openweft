import { getDefaultConfig } from '../config/index.js';
import { pathExists, writeTextFileAtomic } from './files.js';
import { buildRuntimePaths } from './paths.js';

/**
 * Ensure a queue file exists; create it with a header comment if it doesn't.
 */
export const ensureQueueFile = async (queueFile: string): Promise<void> => {
  if (!(await pathExists(queueFile))) {
    await writeTextFileAtomic(queueFile, '# OpenWeft feature queue\n');
  }
};

/**
 * Write a starter file at the given path only if it doesn't already exist.
 * Returns true if a new file was created, false if it already existed.
 */
export const ensureStarterFile = async (filePath: string, content: string): Promise<boolean> => {
  if (await pathExists(filePath)) {
    return false;
  }

  await writeTextFileAtomic(filePath, `${content.trimEnd()}\n`);
  return true;
};

/**
 * Build a RuntimePaths object using the default config values for a given cwd.
 */
export const buildDefaultRuntimePaths = (cwd: string) => {
  const defaults = getDefaultConfig();
  return buildRuntimePaths({
    repoRoot: cwd,
    configDirectory: cwd,
    featureRequestsDir: defaults.featureRequestsDir,
    queueFile: defaults.queueFile,
    promptA: defaults.prompts.promptA,
    planAdjustment: defaults.prompts.planAdjustment,
  });
};
