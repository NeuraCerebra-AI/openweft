import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';

import {
  abortMerge,
  commitAllChanges,
  createWorktree,
  getAutoGcSetting,
  getHeadCommit,
  getWorktreeStatusSummary,
  hasChangesSince,
  listWorktrees,
  mergeBranchIntoCurrent,
  mergeBranchIntoWorktree,
  pruneOrphanedOpenWeftArtifacts,
  removeWorktree,
  resetWorktreeToHead,
  restoreAutoGc,
  setAutoGc
} from '../../src/git/index.js';
import { findReusableExecutionCommit } from '../../src/git/worktrees.js';

const createTempRepo = async (baseBranch = 'main'): Promise<string> => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-git-'));
  const git = simpleGit(repoRoot);

  await git.init(['-b', baseBranch]);
  await git.addConfig('user.name', 'OpenWeft Test');
  await git.addConfig('user.email', 'openweft@example.com');
  await writeFile(path.join(repoRoot, 'src.txt'), 'value = 1\n', 'utf8');
  await writeFile(path.join(repoRoot, 'secondary.txt'), 'secondary = 1\n', 'utf8');
  await git.add(['src.txt', 'secondary.txt']);
  await git.commit('initial commit');

  return repoRoot;
};

const samePath = async (left: string, right: string): Promise<boolean> => {
  return (await realpath(left)) === (await realpath(right));
};

const buildWorktreePath = (repoPath: string, label: string): string => {
  return path.join(path.dirname(repoPath), `${path.basename(repoPath)}-${label}`);
};

const commitChange = async (
  repoPath: string,
  fileContents: string,
  message: string,
  fileName = 'src.txt'
): Promise<void> => {
  const git = simpleGit(repoPath);
  await writeFile(path.join(repoPath, fileName), fileContents, 'utf8');
  await git.add([fileName]);
  await git.commit(message);
};

const listStashEntries = async (repoPath: string): Promise<string[]> => {
  const output = await simpleGit(repoPath).raw(['stash', 'list']);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const hasMergeHead = async (repoPath: string): Promise<boolean> => {
  try {
    await simpleGit(repoPath).revparse(['--verify', 'MERGE_HEAD']);
    return true;
  } catch {
    return false;
  }
};

describe('git worktree infrastructure', () => {
  let repoRoot = '';

  beforeEach(async () => {
    repoRoot = await createTempRepo();
  });

  it('creates, lists, and removes worktrees', async () => {
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-1');

    const created = await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-1'
    });

    expect(created.branch).toBe('agent-1');
    const listed = await listWorktrees(repoRoot);
    expect(
      await Promise.all(listed.map(async (entry) => samePath(entry.path, worktreePath))).then((matches) =>
        matches.some(Boolean)
      )
    ).toBe(true);

    await removeWorktree(repoRoot, worktreePath);
    const afterRemoval = await listWorktrees(repoRoot);
    expect(
      await Promise.all(
        afterRemoval.map(async (entry) => samePath(entry.path, worktreePath).catch(() => false))
      ).then((matches) => matches.some(Boolean))
    ).toBe(false);
  });

  it('uses the current HEAD when no explicit start point is provided', async () => {
    const masterRepoRoot = await createTempRepo('master');
    const worktreePath = buildWorktreePath(masterRepoRoot, 'wt-agent-master');

    const created = await createWorktree({
      repoRoot: masterRepoRoot,
      worktreePath,
      branchName: 'agent-master'
    });

    expect(created.branch).toBe('agent-master');
  });

  it('disables and restores gc.auto', async () => {
    const previous = await getAutoGcSetting(repoRoot);
    await setAutoGc(repoRoot, '0');
    expect(await getAutoGcSetting(repoRoot)).toBe('0');

    await restoreAutoGc(repoRoot, previous);
    expect(await getAutoGcSetting(repoRoot)).toBe(previous);
  });

  it('merges a worktree branch and builds an edit summary', async () => {
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-merge');
    await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-merge'
    });

    await commitChange(worktreePath, 'value = 2\n', 'agent change');

    const result = await mergeBranchIntoCurrent(repoRoot, 'agent-merge');

    expect(result.status).toBe('merged');
    if (result.status === 'merged') {
      expect(result.editSummary.total_files_changed).toBe(1);
      expect(result.editSummary.total_lines_added).toBe(1);
      expect(result.editSummary.total_lines_removed).toBe(1);
    }
  });

  it('reports conflicts in priority-ordered merges and continues later clean merges', async () => {
    const branchAPath = buildWorktreePath(repoRoot, 'wt-agent-a');
    const branchBPath = buildWorktreePath(repoRoot, 'wt-agent-b');
    const branchCPath = buildWorktreePath(repoRoot, 'wt-agent-c');

    await createWorktree({
      repoRoot,
      worktreePath: branchAPath,
      branchName: 'agent-a'
    });
    await createWorktree({
      repoRoot,
      worktreePath: branchBPath,
      branchName: 'agent-b'
    });
    await createWorktree({
      repoRoot,
      worktreePath: branchCPath,
      branchName: 'agent-c'
    });

    await commitChange(branchAPath, 'value = 2\n', 'agent a change');
    await commitChange(branchBPath, 'value = 3\n', 'agent b change');
    await commitChange(branchCPath, 'secondary = 2\n', 'agent c change', 'secondary.txt');

    const mergeResults = [
      await mergeBranchIntoCurrent(repoRoot, 'agent-a'),
      await mergeBranchIntoCurrent(repoRoot, 'agent-b'),
      await mergeBranchIntoCurrent(repoRoot, 'agent-c')
    ];
    const successful = mergeResults.filter((result) => result.status === 'merged');
    const failed = mergeResults.filter((result) => result.status === 'conflict');

    expect(successful).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.conflicts[0]?.file).toBe('src.txt');
    expect(successful.map((entry) => entry.branch)).toEqual(['agent-a', 'agent-c']);
    expect(await readFile(path.join(repoRoot, 'secondary.txt'), 'utf8')).toBe('secondary = 2\n');
  });

  it('can stage a merge into a worktree for conflict resolution', async () => {
    const branchAPath = buildWorktreePath(repoRoot, 'wt-agent-stage-a');
    const branchBPath = buildWorktreePath(repoRoot, 'wt-agent-stage-b');

    await createWorktree({
      repoRoot,
      worktreePath: branchAPath,
      branchName: 'agent-stage-a'
    });
    await createWorktree({
      repoRoot,
      worktreePath: branchBPath,
      branchName: 'agent-stage-b'
    });

    await commitChange(branchAPath, 'value = 2\n', 'agent stage a');
    await commitChange(branchBPath, 'value = 3\n', 'agent stage b');

    const merged = await mergeBranchIntoCurrent(repoRoot, 'agent-stage-a');
    expect(merged.status).toBe('merged');

    const beforeStage = await getHeadCommit(branchBPath);
    const stagedConflict = await mergeBranchIntoWorktree(branchBPath, 'main');
    expect(stagedConflict.status).toBe('conflicted');
    expect(await getHeadCommit(branchBPath)).toBe(beforeStage);
    if (stagedConflict.status === 'conflicted') {
      expect(stagedConflict.conflicts[0]?.file).toBe('src.txt');
      expect(stagedConflict.mergeHeadCommit).not.toBe(beforeStage);
      const mergeHeadCommit = (await simpleGit(branchBPath).revparse(['MERGE_HEAD'])).trim();
      expect(mergeHeadCommit).toBe(stagedConflict.mergeHeadCommit);
    }

    await abortMerge(branchBPath);
  });

  it('returns staged merge details for a clean merge into a worktree', async () => {
    const branchAPath = buildWorktreePath(repoRoot, 'wt-agent-clean-a');
    const branchBPath = buildWorktreePath(repoRoot, 'wt-agent-clean-b');

    await createWorktree({
      repoRoot,
      worktreePath: branchAPath,
      branchName: 'agent-clean-a'
    });
    await createWorktree({
      repoRoot,
      worktreePath: branchBPath,
      branchName: 'agent-clean-b'
    });

    await commitChange(branchAPath, 'secondary = 2\n', 'agent clean a', 'secondary.txt');
    await commitChange(branchBPath, 'value = 4\n', 'agent clean b');

    const merged = await mergeBranchIntoCurrent(repoRoot, 'agent-clean-a');
    expect(merged.status).toBe('merged');

    const beforeStage = await getHeadCommit(branchBPath);
    const stagedMerge = await mergeBranchIntoWorktree(branchBPath, 'main');

    expect(stagedMerge.status).toBe('staged');
    expect(await getHeadCommit(branchBPath)).toBe(beforeStage);
    if (stagedMerge.status === 'staged') {
      expect(stagedMerge.mergeHeadCommit).not.toBe(beforeStage);
      expect(stagedMerge.editSummary.total_files_changed).toBe(1);
      expect(stagedMerge.editSummary.files[0]?.path).toBe('secondary.txt');
    }
  });

  it('returns new head commit values after merge', async () => {
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-head');
    await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-head'
    });

    const before = await getHeadCommit(repoRoot);
    await commitChange(worktreePath, 'value = 5\n', 'agent head change');
    const result = await mergeBranchIntoCurrent(repoRoot, 'agent-head');

    expect(result.status).toBe('merged');
    expect(await getHeadCommit(repoRoot)).not.toBe(before);
  });

  it('merges cleanly when main has uncommitted changes to a different file', async () => {
    const branchName = 'agent-dirty-different-file';
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-dirty-different-file');

    await createWorktree({
      repoRoot,
      worktreePath,
      branchName
    });

    await commitChange(worktreePath, 'value = 2\n', 'agent dirty different file');
    await writeFile(path.join(repoRoot, 'secondary.txt'), 'secondary = dirty\n', 'utf8');

    const result = await mergeBranchIntoCurrent(repoRoot, branchName);

    expect(result.status).toBe('merged');
    expect(await readFile(path.join(repoRoot, 'secondary.txt'), 'utf8')).toBe('secondary = dirty\n');
    expect(await readFile(path.join(repoRoot, 'src.txt'), 'utf8')).toBe('value = 2\n');
  });

  it('merges cleanly when main has untracked files', async () => {
    const branchName = 'agent-dirty-untracked';
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-dirty-untracked');

    await createWorktree({
      repoRoot,
      worktreePath,
      branchName
    });

    await commitChange(worktreePath, 'value = 2\n', 'agent dirty untracked');
    await writeFile(path.join(repoRoot, 'scratch.txt'), 'scratch = dirty\n', 'utf8');

    const result = await mergeBranchIntoCurrent(repoRoot, branchName);

    expect(result.status).toBe('merged');
    expect(await readFile(path.join(repoRoot, 'scratch.txt'), 'utf8')).toBe('scratch = dirty\n');

    const status = await simpleGit(repoRoot).status();
    expect(status.not_added).toContain('scratch.txt');
  });

  it('returns conflict and restores uncommitted changes when merge conflicts', async () => {
    const branchName = 'agent-dirty-conflict';
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-dirty-conflict');

    await createWorktree({
      repoRoot,
      worktreePath,
      branchName
    });

    await commitChange(worktreePath, 'value = 2\n', 'agent dirty conflict');
    await commitChange(repoRoot, 'value = 3\n', 'main dirty conflict');
    await writeFile(path.join(repoRoot, 'secondary.txt'), 'secondary = dirty\n', 'utf8');

    const result = await mergeBranchIntoCurrent(repoRoot, branchName);

    expect(result.status).toBe('conflict');
    expect(await readFile(path.join(repoRoot, 'secondary.txt'), 'utf8')).toBe('secondary = dirty\n');
    expect(await hasMergeHead(repoRoot)).toBe(false);
  });

  it('does not stash when working tree is clean', async () => {
    const branchName = 'agent-clean-no-stash';
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-clean-no-stash');

    await createWorktree({
      repoRoot,
      worktreePath,
      branchName
    });

    await commitChange(worktreePath, 'value = 2\n', 'agent clean no stash');

    const result = await mergeBranchIntoCurrent(repoRoot, branchName);

    expect(result.status).toBe('merged');
    expect(await listStashEntries(repoRoot)).toEqual([]);
  });

  it('leaves stash in list when pop conflicts with merge result', async () => {
    const branchName = 'agent-stash-pop-conflict';
    const stashMessage = `openweft: auto-stash before merging ${branchName}`;
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-stash-pop-conflict');

    await createWorktree({
      repoRoot,
      worktreePath,
      branchName
    });

    await commitChange(worktreePath, 'value = 2\n', 'agent stash pop conflict');
    await writeFile(path.join(repoRoot, 'src.txt'), 'value = 1\n// local scratch\n', 'utf8');

    const result = await mergeBranchIntoCurrent(repoRoot, branchName);
    const stashEntries = await listStashEntries(repoRoot);
    const srcContents = await readFile(path.join(repoRoot, 'src.txt'), 'utf8');
    const matchingStashes = stashEntries.filter((entry) => entry.includes(stashMessage));

    expect(result.status).toBe('merged');
    if (result.status === 'merged') {
      expect(result.autoStash?.created).toBe(true);
    }

    if (result.status === 'merged' && result.autoStash?.restored === false) {
      expect(matchingStashes).toHaveLength(1);
      expect(result.autoStash.recoveryMessage).toContain('git stash');
    } else {
      expect(srcContents).toContain('// local scratch\n');
    }
  });

  it('throws for non-conflict merge failures', async () => {
    await expect(mergeBranchIntoCurrent(repoRoot, 'missing-branch')).rejects.toThrow();
  });

  it('reuses a clean OpenWeft completion commit even when it changed files outside the manifest', async () => {
    const worktreesDir = path.join(repoRoot, '.openweft', 'worktrees');
    const worktreePath = path.join(worktreesDir, '001');
    const branchName = 'openweft-001-reuse';

    await mkdir(worktreesDir, { recursive: true });
    await createWorktree({
      repoRoot,
      worktreePath,
      branchName
    });

    await mkdir(path.join(worktreePath, 'src'), { recursive: true });
    await writeFile(path.join(worktreePath, 'src', 'target.ts'), 'export const target = 1;\n', 'utf8');
    await writeFile(path.join(worktreePath, 'src', 'extra.ts'), 'export const extra = 1;\n', 'utf8');
    const worktreeGit = simpleGit(worktreePath);
    await worktreeGit.add(['src/target.ts', 'src/extra.ts']);
    await worktreeGit.commit('openweft: complete feature 001');

    const reusable = await findReusableExecutionCommit({
      repoRoot,
      worktreesDir,
      worktreePath,
      branchName,
      baseBranch: 'main',
      expectedCommitMessage: 'openweft: complete feature 001'
    });

    expect(reusable).toEqual({
      kind: 'reusable',
      branchName,
      worktreePath
    });
  });

  it('aborts merge state before returning a conflict from mergeBranchIntoCurrent', async () => {
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-conflict-state');

    await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-conflict-state'
    });

    await commitChange(worktreePath, 'value = 2\n', 'agent conflict state');
    await commitChange(repoRoot, 'value = 3\n', 'main conflict state');

    const result = await mergeBranchIntoCurrent(repoRoot, 'agent-conflict-state');
    expect(result.status).toBe('conflict');

    const status = await simpleGit(repoRoot).status();
    expect(status.files).toHaveLength(0);
  });

  it('force-removes dirty worktrees and deletes the feature branch for reuse', async () => {
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-reuse');

    await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-reuse'
    });

    await writeFile(path.join(worktreePath, 'scratch.txt'), 'temp\n', 'utf8');
    await writeFile(path.join(worktreePath, 'src.txt'), 'value = dirty\n', 'utf8');

    await removeWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-reuse',
      force: true
    });

    const recreated = await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-reuse'
    });

    expect(recreated.branch).toBe('agent-reuse');
  });

  it('prunes orphaned OpenWeft worktrees, branches, and stray directories while preserving retained artifacts', async () => {
    const worktreesDir = path.join(repoRoot, '.openweft', 'worktrees');
    const retainedPath = path.join(worktreesDir, '001');
    const orphanPath = path.join(worktreesDir, '999');
    const strayPath = path.join(worktreesDir, 'stray');

    await createWorktree({
      repoRoot,
      worktreePath: retainedPath,
      branchName: 'openweft-001-retained'
    });
    await createWorktree({
      repoRoot,
      worktreePath: orphanPath,
      branchName: 'openweft-999-orphan'
    });
    await mkdir(strayPath, { recursive: true });
    await writeFile(path.join(strayPath, 'note.txt'), 'orphan\n', 'utf8');

    const result = await pruneOrphanedOpenWeftArtifacts({
      repoRoot,
      worktreesDir,
      retainedWorktreePaths: [retainedPath],
      retainedBranchNames: ['openweft-001-retained']
    });

    expect(result.removedWorktreePaths.some((removedPath) => removedPath.endsWith(`${path.sep}999`))).toBe(true);
    expect(result.removedWorktreePaths.some((removedPath) => removedPath.endsWith(`${path.sep}stray`))).toBe(true);
    expect(result.removedWorktreePaths.some((removedPath) => removedPath.endsWith(`${path.sep}001`))).toBe(false);
    expect(result.removedBranchNames).toContain('openweft-999-orphan');
    expect(result.removedBranchNames).not.toContain('openweft-001-retained');

    const listed = await listWorktrees(repoRoot);
    expect(
      await Promise.all(listed.map(async (entry) => samePath(entry.path, retainedPath).catch(() => false))).then(
        (matches) => matches.some(Boolean)
      )
    ).toBe(true);
    expect(
      await Promise.all(listed.map(async (entry) => samePath(entry.path, orphanPath).catch(() => false))).then(
        (matches) => matches.some(Boolean)
      )
    ).toBe(false);

    const branches = await simpleGit(repoRoot).branchLocal();
    expect(branches.all).toContain('openweft-001-retained');
    expect(branches.all).not.toContain('openweft-999-orphan');
    await expect(readFile(path.join(strayPath, 'note.txt'), 'utf8')).rejects.toThrow();
  });

  it('reports worktree status relative to the base ref', async () => {
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-status');
    await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-status'
    });

    await writeFile(path.join(worktreePath, 'src.txt'), 'value = dirty\n', 'utf8');
    const summary = await getWorktreeStatusSummary(worktreePath);

    expect(summary.dirty).toBe(true);
    expect(summary.changedFiles).toContain('src.txt');
    expect(summary.ahead).toBe(0);
  });

  it('detects committed or dirty changes since the base commit', async () => {
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-delta');
    const created = await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-delta'
    });

    expect(await hasChangesSince(worktreePath, created.head)).toBe(false);

    await writeFile(path.join(worktreePath, 'src.txt'), 'value = dirty\n', 'utf8');
    expect(await hasChangesSince(worktreePath, created.head)).toBe(true);

    await resetWorktreeToHead(worktreePath);
    await commitChange(worktreePath, 'value = 9\n', 'agent delta commit');
    expect(await hasChangesSince(worktreePath, created.head)).toBe(true);
  });

  it('commits all tracked changes when requested', async () => {
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-commit');
    const created = await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-commit'
    });

    await writeFile(path.join(worktreePath, 'src.txt'), 'value = committed\n', 'utf8');
    const commit = await commitAllChanges(worktreePath, 'checkpoint worktree changes');

    expect(commit).not.toBeNull();
    expect(await hasChangesSince(worktreePath, created.head)).toBe(true);
  });

  it('stages all changes including new untracked files when no paths are specified', async () => {
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-untracked');
    await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-untracked'
    });

    await writeFile(path.join(worktreePath, 'scratch.txt'), 'temp\n', 'utf8');
    const commit = await commitAllChanges(worktreePath, 'include all worker output');

    expect(commit).not.toBeNull();
    const status = await simpleGit(worktreePath).status();
    expect(status.not_added).not.toContain('scratch.txt');
  });

  it('can stage manifest-listed new files without picking up other untracked files', async () => {
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-manifest-stage');
    await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-manifest-stage'
    });

    await mkdir(path.join(worktreePath, 'src'), { recursive: true });
    await writeFile(path.join(worktreePath, 'src', 'created.ts'), 'export const value = 1;\n', 'utf8');
    await writeFile(path.join(worktreePath, 'scratch.txt'), 'temp\n', 'utf8');
    const commit = await commitAllChanges(
      worktreePath,
      'stage only manifest files',
      ['src/created.ts']
    );

    expect(commit).not.toBeNull();
    const status = await simpleGit(worktreePath).status();
    expect(status.not_added).toContain('scratch.txt');
    expect(status.not_added).not.toContain('src/created.ts');
  });

  it('resets dirty worktrees back to HEAD for retries', async () => {
    const worktreePath = buildWorktreePath(repoRoot, 'wt-agent-reset');
    await createWorktree({
      repoRoot,
      worktreePath,
      branchName: 'agent-reset'
    });

    await writeFile(path.join(worktreePath, 'src.txt'), 'value = dirty\n', 'utf8');
    await writeFile(path.join(worktreePath, 'scratch.txt'), 'temp\n', 'utf8');
    await resetWorktreeToHead(worktreePath);

    const status = await simpleGit(worktreePath).status();
    expect(status.files).toHaveLength(0);
  });

  it('restores the exact auto-stash entry when a newer stash appears before restore', async () => {
    const commandLog: string[] = [];
    const stashEntries = [
      {
        ref: 'stash@{0}',
        oid: 'oid-auto',
        subject: 'On main: openweft: auto-stash before merging agent-precise [token-auto]'
      }
    ];
    let mergeCompleted = false;

    const updateStashRefs = (): void => {
      stashEntries.forEach((entry, index) => {
        entry.ref = `stash@{${index}}`;
      });
    };

    const fakeGit = {
      status: vi.fn(async () => ({
        files: [{ path: 'secondary.txt', index: ' ', working_dir: 'M' }]
      })),
      stash: vi.fn(async (args: string[]) => {
        commandLog.push(`stash ${args.join(' ')}`);
        if (args[0] === 'push') {
          return 'Saved working directory and index state';
        }
        if (args[0] === 'drop') {
          const entryIndex = stashEntries.findIndex((entry) => entry.ref === args[1]);
          if (entryIndex >= 0) {
            stashEntries.splice(entryIndex, 1);
            updateStashRefs();
          }
          return 'Dropped';
        }
        if (args[0] === 'pop') {
          throw new Error('plain stash pop should not be used when an exact stash is tracked');
        }
        throw new Error(`Unexpected stash command: ${args.join(' ')}`);
      }),
      merge: vi.fn(async (_args: string[]) => {
        mergeCompleted = true;
        stashEntries.unshift({
          ref: 'stash@{0}',
          oid: 'oid-external',
          subject: 'On main: external hook stash'
        });
        updateStashRefs();
      }),
      revparse: vi.fn(async (args: string[]) => {
        if (args[0] === 'HEAD') {
          return mergeCompleted ? 'merge-commit' : 'pre-merge-commit';
        }
        throw new Error(`Unexpected revparse: ${args.join(' ')}`);
      }),
      raw: vi.fn(async (args: string[]) => {
        commandLog.push(`raw ${args.join(' ')}`);
        if (args[0] === 'stash' && args[1] === 'list') {
          return stashEntries.map((entry) => `${entry.ref}\0${entry.oid}\0${entry.subject}`).join('\n');
        }
        if (args[0] === 'stash' && args[1] === 'apply') {
          expect(args[2]).toBe('oid-auto');
          return 'Applied';
        }
        if (args[0] === 'diff-tree' && args.includes('--name-status')) {
          return 'M\tsrc.txt\n';
        }
        if (args[0] === 'diff-tree' && args.includes('--numstat')) {
          return '1\t1\tsrc.txt\n';
        }
        throw new Error(`Unexpected raw command: ${args.join(' ')}`);
      })
    };

    vi.resetModules();
    vi.doMock('node:crypto', () => ({
      randomUUID: () => 'token-auto'
    }));
    vi.doMock('simple-git', () => ({
      simpleGit: vi.fn(() => fakeGit)
    }));

    try {
      const worktreesModule = await import('../../src/git/worktrees.js');
      const result = await worktreesModule.mergeBranchIntoCurrent('/fake/repo', 'agent-precise');

      expect(result.status).toBe('merged');
      if (result.status === 'merged') {
        expect(result.autoStash).toMatchObject({
          created: true,
          restored: true,
          recoveryMessage: null
        });
      }
      expect(commandLog).toContain('raw stash apply oid-auto');
      expect(commandLog).toContain('stash drop stash@{1}');
      expect(commandLog).not.toContain('stash pop');
    } finally {
      vi.doUnmock('node:crypto');
      vi.doUnmock('simple-git');
      vi.resetModules();
    }
  });
});
