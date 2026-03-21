import path from 'node:path';
import { readdir, realpath, rm } from 'node:fs/promises';

import { simpleGit, type GitResponseError, type MergeSummary, type SimpleGit } from 'simple-git';

import { buildEditSummary, type EditSummary } from '../domain/editSummary.js';

export interface WorktreeRecord {
  path: string;
  head: string;
  branch: string | null;
  locked: boolean;
  prunable: string | null;
}

export interface CreateWorktreeInput {
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  startPoint?: string;
}

export interface MergeConflictDetail {
  file: string;
  reason: string;
}

export interface MergeSuccess {
  status: 'merged';
  branch: string;
  preMergeCommit: string;
  mergeCommit: string;
  editSummary: EditSummary;
}

export interface StagedMergeSuccess {
  status: 'staged';
  branch: string;
  preMergeCommit: string;
  mergeHeadCommit: string;
  editSummary: EditSummary;
}

export interface MergeConflict {
  status: 'conflict';
  branch: string;
  preMergeCommit: string;
  conflicts: MergeConflictDetail[];
}

export type MergeBranchResult = MergeSuccess | MergeConflict;
export type MergeBranchIntoWorktreeResult = StagedMergeSuccess | MergeConflict;

export interface WorktreeStatusSummary {
  ahead: number;
  behind: number;
  dirty: boolean;
  changedFiles: string[];
}

export interface RemoveWorktreeInput {
  repoRoot: string;
  worktreePath: string;
  branchName?: string | null;
  force?: boolean;
}

export interface PruneOrphanedOpenWeftArtifactsInput {
  repoRoot: string;
  worktreesDir: string;
  retainedWorktreePaths?: readonly (string | null | undefined)[];
  retainedBranchNames?: readonly (string | null | undefined)[];
}

export interface PruneOrphanedOpenWeftArtifactsResult {
  removedWorktreePaths: string[];
  removedBranchNames: string[];
}

export interface ReusableExecutionCommit {
  kind: 'reusable' | 'already-merged';
  branchName: string;
  worktreePath: string;
}

const createGit = (baseDir: string): SimpleGit => simpleGit(baseDir);
const normalizePathForComparison = (value: string): string => {
  const normalized = value.replace(/\\/g, '/');
  return process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized;
};

const normalizeExistingPath = async (value: string): Promise<string> => {
  try {
    return await realpath(value);
  } catch {
    return path.resolve(value);
  }
};

const isWithinDirectory = (candidatePath: string, directoryPath: string): boolean => {
  return candidatePath === directoryPath || candidatePath.startsWith(`${directoryPath}${path.sep}`);
};

const parsePorcelainWorktrees = (output: string): WorktreeRecord[] => {
  const records = output
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block) => {
      const parsed: WorktreeRecord = {
        path: '',
        head: '',
        branch: null,
        locked: false,
        prunable: null
      };

      for (const line of block.split('\n')) {
        const [key, ...rest] = line.split(' ');
        const value = rest.join(' ').trim();

        switch (key) {
          case 'worktree':
            parsed.path = value;
            break;
          case 'HEAD':
            parsed.head = value;
            break;
          case 'branch':
            parsed.branch = value.replace(/^refs\/heads\//, '');
            break;
          case 'locked':
            parsed.locked = true;
            break;
          case 'prunable':
            parsed.prunable = value || null;
            break;
          default:
            break;
        }
      }

      return parsed;
    });

  return records.filter((record) => record.path !== '');
};

export const getHeadCommit = async (repoRoot: string): Promise<string> => {
  return createGit(repoRoot).revparse(['HEAD']);
};

export const listWorktrees = async (repoRoot: string): Promise<WorktreeRecord[]> => {
  const output = await createGit(repoRoot).raw(['worktree', 'list', '--porcelain']);
  return parsePorcelainWorktrees(output);
};

export const findReusableExecutionCommit = async (input: {
  repoRoot: string;
  worktreesDir: string;
  worktreePath: string | null;
  branchName: string | null;
  baseBranch: string;
  expectedCommitMessage: string;
}): Promise<ReusableExecutionCommit | null> => {
  try {
    if (!input.worktreePath || !input.branchName) {
      return null;
    }

    const normalizedWorktreesDir = await normalizeExistingPath(input.worktreesDir);
    const normalizedWorktreePath = await normalizeExistingPath(input.worktreePath);
    if (!isWithinDirectory(normalizedWorktreePath, normalizedWorktreesDir)) {
      return null;
    }

    let matchingWorktree: WorktreeRecord | undefined;
    for (const worktree of await listWorktrees(input.repoRoot)) {
      const normalizedListedPath = await normalizeExistingPath(worktree.path);
      if (normalizedListedPath === normalizedWorktreePath) {
        matchingWorktree = worktree;
        break;
      }
    }

    if (!matchingWorktree || matchingWorktree.branch !== input.branchName) {
      return null;
    }

    const status = await getWorktreeStatusSummary(input.worktreePath, input.baseBranch);
    if (status.dirty) {
      return null;
    }

    const headSubject = (await createGit(input.worktreePath).raw(['log', '-1', '--pretty=%s'])).trim();
    if (headSubject !== input.expectedCommitMessage) {
      return null;
    }

    const changedPaths = (await createGit(input.worktreePath).raw(['diff-tree', '-r', '--no-commit-id', '--name-only', 'HEAD']))
      .split('\n')
      .map((entry) => normalizePathForComparison(entry.trim()))
      .filter(Boolean);
    if (changedPaths.length === 0) {
      return null;
    }

    if (status.ahead === 1) {
      return {
        kind: 'reusable',
        branchName: input.branchName,
        worktreePath: input.worktreePath
      };
    }

    const alreadyMerged = await createGit(input.worktreePath)
      .raw(['merge-base', '--is-ancestor', 'HEAD', input.baseBranch])
      .then(() => true)
      .catch(() => false);
    if (!alreadyMerged) {
      return null;
    }

    return {
      kind: 'already-merged',
      branchName: input.branchName,
      worktreePath: input.worktreePath
    };
  } catch {
    return null;
  }
};

export const createWorktree = async (input: CreateWorktreeInput): Promise<WorktreeRecord> => {
  const git = createGit(input.repoRoot);
  const worktreeAddArgs = [
    'worktree',
    'add',
    '-b',
    input.branchName,
    input.worktreePath
  ];

  if (input.startPoint) {
    worktreeAddArgs.push(input.startPoint);
  }

  await git.raw(worktreeAddArgs);

  const worktrees = await listWorktrees(input.repoRoot);
  const expectedPath = await normalizeExistingPath(input.worktreePath);
  let created: WorktreeRecord | undefined;

  for (const worktree of worktrees) {
    if ((await normalizeExistingPath(worktree.path)) === expectedPath) {
      created = worktree;
      break;
    }
  }

  if (!created) {
    throw new Error(`Worktree was not created at ${input.worktreePath}`);
  }

  return created;
};

const resolveRemoveWorktreeInput = (
  input: RemoveWorktreeInput | string,
  worktreePath?: string
): RemoveWorktreeInput => {
  if (typeof input === 'string') {
    if (!worktreePath) {
      throw new Error('worktreePath is required when removeWorktree() is called with string arguments.');
    }

    return {
      repoRoot: input,
      worktreePath,
      force: true
    };
  }

  return {
    force: true,
    ...input
  };
};

const isMissingBranchError = (error: unknown): boolean => {
  return error instanceof Error && /branch.+not found|not a valid branch/i.test(error.message);
};

export const removeWorktree = async (
  input: RemoveWorktreeInput | string,
  worktreePath?: string
): Promise<void> => {
  const resolved = resolveRemoveWorktreeInput(input, worktreePath);
  const git = createGit(resolved.repoRoot);
  const removeArgs = ['worktree', 'remove'];

  if (resolved.force) {
    removeArgs.push('--force');
  }

  removeArgs.push(resolved.worktreePath);

  try {
    await git.raw(removeArgs);
  } catch {
    await rm(resolved.worktreePath, { recursive: true, force: true });
    await git.raw(['worktree', 'prune']);
  }

  await git.raw(['worktree', 'prune']);

  if (resolved.branchName) {
    try {
      await git.deleteLocalBranch(resolved.branchName, true);
    } catch (error) {
      if (!isMissingBranchError(error)) {
        throw error;
      }
    }
  }
};

export const pruneOrphanedOpenWeftArtifacts = async (
  input: PruneOrphanedOpenWeftArtifactsInput
): Promise<PruneOrphanedOpenWeftArtifactsResult> => {
  const removedWorktreePaths = new Set<string>();
  const removedBranchNames = new Set<string>();
  const normalizedWorktreesDir = await normalizeExistingPath(input.worktreesDir);
  const retainedWorktreePaths = new Set(
    await Promise.all(
      (input.retainedWorktreePaths ?? [])
        .filter((worktreePath): worktreePath is string => typeof worktreePath === 'string' && worktreePath.length > 0)
        .map((worktreePath) => normalizeExistingPath(worktreePath))
    )
  );
  const retainedBranchNames = new Set(
    (input.retainedBranchNames ?? []).filter(
      (branchName): branchName is string => typeof branchName === 'string' && branchName.length > 0
    )
  );

  const listedWorktrees = await listWorktrees(input.repoRoot);
  for (const worktree of listedWorktrees) {
    const normalizedWorktreePath = await normalizeExistingPath(worktree.path);
    if (!isWithinDirectory(normalizedWorktreePath, normalizedWorktreesDir)) {
      continue;
    }
    if (retainedWorktreePaths.has(normalizedWorktreePath)) {
      continue;
    }

    await removeWorktree({
      repoRoot: input.repoRoot,
      worktreePath: worktree.path,
      branchName: worktree.branch,
      force: true
    });
    removedWorktreePaths.add(worktree.path);
    if (worktree.branch) {
      removedBranchNames.add(worktree.branch);
    }
  }

  const remainingManagedWorktrees = new Set(
    await Promise.all(
      (await listWorktrees(input.repoRoot))
        .filter(async () => true)
        .map(async (worktree) => {
          const normalizedWorktreePath = await normalizeExistingPath(worktree.path);
          return isWithinDirectory(normalizedWorktreePath, normalizedWorktreesDir)
            ? normalizedWorktreePath
            : null;
        })
    ).then((paths) => paths.filter((worktreePath): worktreePath is string => worktreePath !== null))
  );

  const managedDirectoryEntries = await readdir(input.worktreesDir, { withFileTypes: true }).catch(() => []);
  for (const entry of managedDirectoryEntries) {
    const entryPath = path.join(input.worktreesDir, entry.name);
    const normalizedEntryPath = await normalizeExistingPath(entryPath);
    if (retainedWorktreePaths.has(normalizedEntryPath) || remainingManagedWorktrees.has(normalizedEntryPath)) {
      continue;
    }

    await rm(entryPath, { recursive: true, force: true });
    removedWorktreePaths.add(entryPath);
  }

  const activeManagedBranches = new Set(
    (await listWorktrees(input.repoRoot))
      .flatMap((worktree) => {
        const normalizedWorktreePath = path.resolve(worktree.path);
        if (!isWithinDirectory(normalizedWorktreePath, normalizedWorktreesDir) || !worktree.branch) {
          return [];
        }
        return [worktree.branch];
      })
  );
  const localBranches = await createGit(input.repoRoot).branchLocal();
  for (const branchName of localBranches.all) {
    if (!branchName.startsWith('openweft-')) {
      continue;
    }
    if (retainedBranchNames.has(branchName) || activeManagedBranches.has(branchName)) {
      continue;
    }

    try {
      await createGit(input.repoRoot).deleteLocalBranch(branchName, true);
      removedBranchNames.add(branchName);
    } catch (error) {
      if (!isMissingBranchError(error)) {
        throw error;
      }
    }
  }

  return {
    removedWorktreePaths: [...removedWorktreePaths].sort(),
    removedBranchNames: [...removedBranchNames].sort()
  };
};

export const setAutoGc = async (repoRoot: string, value: string): Promise<void> => {
  await createGit(repoRoot).raw(['config', '--local', 'gc.auto', value]);
};

export const getAutoGcSetting = async (repoRoot: string): Promise<string | null> => {
  try {
    const value = await createGit(repoRoot).raw(['config', '--get', '--local', 'gc.auto']);
    return value.trim() || null;
  } catch {
    return null;
  }
};

export const restoreAutoGc = async (repoRoot: string, previousValue: string | null): Promise<void> => {
  const git = createGit(repoRoot);
  if (previousValue === null) {
    try {
      await git.raw(['config', '--local', '--unset', 'gc.auto']);
    } catch {
      // Nothing to unset.
    }
    return;
  }

  await git.raw(['config', '--local', 'gc.auto', previousValue]);
};

export const getWorktreeStatusSummary = async (
  repoRoot: string,
  baseRef = 'HEAD'
): Promise<WorktreeStatusSummary> => {
  const git = createGit(repoRoot);
  const output = await git.raw(['status', '--porcelain', '--branch']);
  const lines = output.split(/\r?\n/).filter(Boolean);
  const branchLine = lines[0] ?? '';
  const changedFiles = lines
    .slice(1)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);

  const aheadMatch = branchLine.match(/\[ahead (\d+)(?:,|])?/);
  const behindMatch = branchLine.match(/\bbehind (\d+)\]/);

  let ahead = aheadMatch?.[1] ? Number.parseInt(aheadMatch[1], 10) : 0;
  let behind = behindMatch?.[1] ? Number.parseInt(behindMatch[1], 10) : 0;

  if (baseRef !== 'HEAD') {
    const countOutput = await git.raw(['rev-list', '--left-right', '--count', `${baseRef}...HEAD`]);
    const [behindCount, aheadCount] = countOutput
      .trim()
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10));

    ahead = typeof aheadCount === 'number' && Number.isFinite(aheadCount) ? aheadCount : 0;
    behind = typeof behindCount === 'number' && Number.isFinite(behindCount) ? behindCount : 0;
  }

  return {
    ahead,
    behind,
    dirty: changedFiles.length > 0,
    changedFiles
  };
};

export const hasChangesSince = async (repoRoot: string, baseRef: string): Promise<boolean> => {
  const [headCommit, baseCommit, status] = await Promise.all([
    getHeadCommit(repoRoot),
    createGit(repoRoot).revparse([baseRef]),
    getWorktreeStatusSummary(repoRoot)
  ]);

  return headCommit.trim() !== baseCommit.trim() || status.dirty;
};

export const commitAllChanges = async (
  repoRoot: string,
  message: string,
  pathsToStage?: readonly string[]
): Promise<string | null> => {
  const git = createGit(repoRoot);
  const normalizedPaths = [...new Set((pathsToStage ?? []).filter((path) => path.length > 0))];

  if (normalizedPaths.length > 0) {
    await git.add(normalizedPaths);
  } else {
    await git.add(['-A']);
  }

  const stagedPaths = (await git.diff(['--cached', '--name-only']))
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean);
  if (stagedPaths.length === 0) {
    return null;
  }

  await git.commit(message);
  return getHeadCommit(repoRoot);
};

export const resetWorktreeToHead = async (repoRoot: string): Promise<void> => {
  const git = createGit(repoRoot);
  await git.raw(['reset', '--hard', 'HEAD']);
  await git.raw(['clean', '-fd']);
};

export const buildEditSummaryForRange = async (
  repoRoot: string,
  branch: string,
  preMergeCommit: string,
  mergeCommit: string
): Promise<EditSummary> => {
  const git = createGit(repoRoot);
  const [nameStatusOutput, numstatOutput] = await Promise.all([
    git.raw(['diff-tree', '-r', '--no-commit-id', '--name-status', '-M', preMergeCommit, mergeCommit]),
    git.raw(['diff-tree', '-r', '--no-commit-id', '--numstat', '-M', preMergeCommit, mergeCommit])
  ]);

  return buildEditSummary({
    mergeCommit,
    branch,
    preMergeCommit,
    nameStatusOutput,
    numstatOutput
  });
};

const buildEditSummaryForStagedMerge = async (
  repoRoot: string,
  branch: string,
  preMergeCommit: string,
  mergeHeadCommit: string
): Promise<EditSummary> => {
  const git = createGit(repoRoot);
  const [nameStatusOutput, numstatOutput] = await Promise.all([
    git.raw(['diff', '--cached', '--name-status', '-M', preMergeCommit]),
    git.raw(['diff', '--cached', '--numstat', '-M', preMergeCommit])
  ]);

  return buildEditSummary({
    mergeCommit: mergeHeadCommit,
    branch,
    preMergeCommit,
    nameStatusOutput,
    numstatOutput
  });
};

const extractMergeConflicts = (
  error: unknown
): MergeConflictDetail[] => {
  const mergeError = error as GitResponseError<MergeSummary>;
  return mergeError.git?.conflicts
    ?.filter((conflict) => conflict.file)
    .map((conflict) => ({
      file: conflict.file as string,
      reason: conflict.reason
    })) ?? [];
};

export const abortMerge = async (repoRoot: string): Promise<void> => {
  await createGit(repoRoot).merge(['--abort']);
};

const isMergeInProgress = async (gitDir: string): Promise<boolean> => {
  try {
    await createGit(gitDir).revparse(['--verify', 'MERGE_HEAD']);
    return true;
  } catch {
    return false;
  }
};

export const mergeBranchIntoCurrent = async (
  repoRoot: string,
  branch: string
): Promise<MergeBranchResult> => {
  const git = createGit(repoRoot);
  const preMergeCommit = await getHeadCommit(repoRoot);

  try {
    await git.merge(['--no-ff', '--no-edit', branch]);
    const mergeCommit = await getHeadCommit(repoRoot);

    return {
      status: 'merged',
      branch,
      preMergeCommit,
      mergeCommit,
      editSummary: await buildEditSummaryForRange(repoRoot, branch, preMergeCommit, mergeCommit)
    };
  } catch (error) {
    const conflicts = extractMergeConflicts(error);

    if (conflicts.length === 0) {
      throw error;
    }

    await abortMerge(repoRoot).catch(() => {
      // If Git already cleaned up the merge state, there is nothing left to abort.
    });

    if (await isMergeInProgress(repoRoot)) {
      throw new Error(`Failed to clean up merge state in ${repoRoot} after conflict on branch ${branch}.`);
    }

    return {
      status: 'conflict',
      branch,
      preMergeCommit,
      conflicts
    };
  }
};

export const mergeBranchIntoWorktree = async (
  worktreePath: string,
  branch: string
): Promise<MergeBranchIntoWorktreeResult> => {
  const git = createGit(worktreePath);
  const preMergeCommit = await getHeadCommit(worktreePath);

  try {
    await git.merge(['--no-ff', '--no-commit', branch]);
    const mergeHeadCommit = (await git.revparse(['MERGE_HEAD'])).trim();

    return {
      status: 'staged',
      branch,
      preMergeCommit,
      mergeHeadCommit,
      editSummary: await buildEditSummaryForStagedMerge(
        worktreePath,
        branch,
        preMergeCommit,
        mergeHeadCommit
      )
    };
  } catch (error) {
    const conflicts = extractMergeConflicts(error);

    if (conflicts.length === 0) {
      throw error;
    }

    try {
      await git.raw(['merge', '--abort']);
    } catch {
      // best-effort; ignore failure
    }

    if (await isMergeInProgress(worktreePath)) {
      throw new Error(`Failed to clean up merge state in ${worktreePath} after conflict on branch ${branch}.`);
    }

    return {
      status: 'conflict',
      branch,
      preMergeCommit,
      conflicts
    };
  }
};
