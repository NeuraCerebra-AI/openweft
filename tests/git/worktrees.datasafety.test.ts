import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';
import { simpleGit, type SimpleGit } from 'simple-git';

import {
  assertNoUnresolvedConflictState,
  getWorktreeStatusSummary,
  mergeBranchIntoCurrent,
  pruneOrphanedOpenWeftArtifacts,
  removeWorktree
} from '../../src/git/worktrees.js';

const execFileAsync = promisify(execFile);

const runGit = async (cwd: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
};

const initRepo = async (repoRoot: string, baseBranch = 'main'): Promise<SimpleGit> => {
  const git = simpleGit(repoRoot);
  await git.init(['-b', baseBranch]);
  await git.addConfig('user.name', 'OpenWeft Test');
  await git.addConfig('user.email', 'openweft@example.com');
  await git.addConfig('commit.gpgsign', 'false');
  return git;
};

const createTempRepo = async (baseBranch = 'main'): Promise<{ repoRoot: string; git: SimpleGit }> => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-ds-'));
  const git = await initRepo(repoRoot, baseBranch);
  await writeFile(path.join(repoRoot, 'src.txt'), 'value = 1\n', 'utf8');
  await git.add(['src.txt']);
  await git.commit('initial commit');
  return { repoRoot, git };
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await readdir(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      // It's a file, not a dir, but it exists.
      await readFile(target);
      return true;
    }
    return false;
  }
};

describe('B1: createAutoStash must not proceed with merge on a dirty tree when stash no-ops', () => {
  it('does not silently merge with a dirty submodule that stash push -u cannot capture', async () => {
    // A dirty submodule: `git status` reports `M sub`, but `git stash push -u`
    // says "No local changes to save" and creates no stash entry.
    const { repoRoot, git } = await createTempRepo();

    // Build a submodule source repo.
    const subSource = await mkdtemp(path.join(os.tmpdir(), 'openweft-ds-sub-'));
    const subGit = await initRepo(subSource);
    await writeFile(path.join(subSource, 's.txt'), 'sub = 1\n', 'utf8');
    await subGit.add(['s.txt']);
    await subGit.commit('sub init');

    await runGit(repoRoot, ['-c', 'protocol.file.allow=always', 'submodule', 'add', subSource, 'sub']);
    await git.commit('add submodule');

    // Create a branch to merge that is genuinely mergeable (no conflict).
    await git.checkoutLocalBranch('feature');
    await writeFile(path.join(repoRoot, 'feature.txt'), 'feature\n', 'utf8');
    await git.add(['feature.txt']);
    await git.commit('feature commit');
    await git.checkout('main');

    // Now dirty the submodule. `git status` reports it; `git stash push -u` won't capture it.
    await writeFile(path.join(repoRoot, 'sub', 's.txt'), 'sub = DIRTY\n', 'utf8');

    const statusBefore = await git.status();
    expect(statusBefore.files.length).toBeGreaterThan(0); // tree IS dirty

    // Confirm stash push -u no-ops on this state (sanity check of the hazard).
    const stashOut = await git.stash(['push', '-u', '-m', 'probe']);
    expect(stashOut).toContain('No local changes to save');

    // SAFE behavior: the merge path must not silently treat the tree as clean.
    // It must either fail-safe (throw) rather than merge over uncaptured dirty work.
    await expect(mergeBranchIntoCurrent(repoRoot, 'feature')).rejects.toThrow();

    // And the dirty submodule change must be preserved on disk.
    const subContent = await readFile(path.join(repoRoot, 'sub', 's.txt'), 'utf8');
    expect(subContent).toContain('DIRTY');
  });
});

describe('B2: restoreAutoStash must not leave conflict markers in the working tree on partial apply', () => {
  it('restores a clean tree (changes kept safe in the stash) when stash apply conflicts post-merge', async () => {
    const { repoRoot, git } = await createTempRepo();
    await writeFile(path.join(repoRoot, 'f.txt'), 'line1\nline2\nline3\n', 'utf8');
    await git.add(['f.txt']);
    await git.commit('add f');

    // Branch that changes line2 (will conflict with the local uncommitted change to line2).
    await git.checkoutLocalBranch('feature');
    await writeFile(path.join(repoRoot, 'f.txt'), 'line1\nMERGED\nline3\n', 'utf8');
    await git.add(['f.txt']);
    await git.commit('feature changes line2');
    await git.checkout('main');

    // Local uncommitted change to the same line -> will conflict with the merge result.
    await writeFile(path.join(repoRoot, 'f.txt'), 'line1\nLOCAL\nline3\n', 'utf8');

    const result = await mergeBranchIntoCurrent(repoRoot, 'feature').catch((error) => error);

    // Whatever the surfaced outcome, the working tree must NOT contain conflict markers.
    const content = await readFile(path.join(repoRoot, 'f.txt'), 'utf8');
    expect(content).not.toContain('<<<<<<<');
    expect(content).not.toContain('>>>>>>>');
    expect(content).not.toContain('=======');

    // The tree must be clean (no half-applied / unmerged paths).
    const status = await git.status();
    expect(status.conflicted).toHaveLength(0);
    expect(status.files.filter((file) => file.index === 'U' || file.working_dir === 'U')).toHaveLength(0);

    // The user's changes must remain recoverable in a stash entry.
    const stashList = await git.raw(['stash', 'list']);
    expect(stashList).toContain('openweft: auto-stash');

    void result;
  });
});

describe('B3: removeWorktree fallback rm must require a real worktree, not just a path under worktreesDir', () => {
  it('refuses to rm -rf an unrelated directory that merely sits under worktreesDir', async () => {
    const { repoRoot } = await createTempRepo();
    const worktreesDir = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-wts`);
    await mkdir(worktreesDir, { recursive: true });

    // A directory under worktreesDir that is NOT a git worktree, holding precious data.
    const precious = path.join(worktreesDir, 'unrelated-precious');
    await mkdir(precious, { recursive: true });
    await writeFile(path.join(precious, 'keep.txt'), 'PRECIOUS UNRELATED DATA', 'utf8');

    // `git worktree remove` will fail (not a working tree). The fallback must NOT nuke it.
    await expect(
      removeWorktree({ repoRoot, worktreePath: precious, worktreesDir, force: true })
    ).rejects.toThrow();

    expect(await pathExists(path.join(precious, 'keep.txt'))).toBe(true);
    const kept = await readFile(path.join(precious, 'keep.txt'), 'utf8');
    expect(kept).toContain('PRECIOUS');
  });

  it('still falls back to rm -rf for a real managed worktree whose directory is intact', async () => {
    const { repoRoot, git } = await createTempRepo();
    const worktreesDir = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-wts2`);
    await mkdir(worktreesDir, { recursive: true });
    const wtPath = path.join(worktreesDir, 'wt-a');

    await git.raw(['worktree', 'add', '-b', 'feat-a', wtPath]);
    expect(await pathExists(path.join(wtPath, '.git'))).toBe(true);

    await removeWorktree({ repoRoot, worktreePath: wtPath, branchName: 'feat-a', worktreesDir, force: true });
    expect(await pathExists(wtPath)).toBe(false);
  });
});

describe('B4: pruneOrphanedOpenWeftArtifacts must fail safe when the retained set is unknown/empty', () => {
  it('does not delete unrelated directories under worktreesDir when retained set is empty', async () => {
    const { repoRoot } = await createTempRepo();
    const worktreesDir = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-wts3`);
    await mkdir(worktreesDir, { recursive: true });

    const orphan = path.join(worktreesDir, 'unrelated-precious');
    await mkdir(orphan, { recursive: true });
    await writeFile(path.join(orphan, 'keep.txt'), 'PRECIOUS UNMERGED WORK', 'utf8');

    const result = await pruneOrphanedOpenWeftArtifacts({
      repoRoot,
      worktreesDir,
      retainedWorktreePaths: [],
      retainedBranchNames: []
    });

    // The unrelated dir must survive.
    expect(await pathExists(path.join(orphan, 'keep.txt'))).toBe(true);
    expect(result.removedWorktreePaths).not.toContain(orphan);
  });

  it('still prunes a genuine orphaned OpenWeft worktree directory left behind after detach', async () => {
    const { repoRoot, git } = await createTempRepo();
    const worktreesDir = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-wts4`);
    await mkdir(worktreesDir, { recursive: true });
    const wtPath = path.join(worktreesDir, 'wt-orphan');

    await git.raw(['worktree', 'add', '-b', 'feat-orphan', wtPath]);
    // Detach the worktree from git's registry but leave the directory on disk (orphan).
    await git.raw(['worktree', 'remove', '--force', wtPath]).catch(() => undefined);
    await mkdir(wtPath, { recursive: true });
    // Re-create the .git marker so it looks like a leftover managed worktree directory.
    await writeFile(path.join(wtPath, '.git'), 'gitdir: /nonexistent\n', 'utf8');

    const result = await pruneOrphanedOpenWeftArtifacts({
      repoRoot,
      worktreesDir,
      retainedWorktreePaths: ['placeholder-keep-something'],
      retainedBranchNames: ['placeholder']
    });

    expect(await pathExists(wtPath)).toBe(false);
    expect(result.removedWorktreePaths.map((p) => path.basename(p))).toContain('wt-orphan');
  });
});

describe('B5: assertNoUnresolvedConflictState must catch partial/staged conflict markers', () => {
  it('throws when a staged file still contains a stray <<<<<<< marker', async () => {
    const { repoRoot, git } = await createTempRepo();
    const fileContent = 'line1\n<<<<<<< HEAD\nresolved content\nline3\n';
    await writeFile(path.join(repoRoot, 'f.txt'), fileContent, 'utf8');
    await git.add(['f.txt']);
    // Staged -> ls-files -u is empty, so only the marker scan can catch it.

    await expect(assertNoUnresolvedConflictState(repoRoot, ['f.txt'])).rejects.toThrow();
  });

  it('throws when a staged file still contains a stray >>>>>>> marker', async () => {
    const { repoRoot, git } = await createTempRepo();
    await writeFile(path.join(repoRoot, 'g.txt'), 'a\nb\n>>>>>>> theirs\nc\n', 'utf8');
    await git.add(['g.txt']);

    await expect(assertNoUnresolvedConflictState(repoRoot, ['g.txt'])).rejects.toThrow();
  });

  it('does not throw for a cleanly resolved file with no markers', async () => {
    const { repoRoot, git } = await createTempRepo();
    await writeFile(path.join(repoRoot, 'h.txt'), 'a\nb\nc\n', 'utf8');
    await git.add(['h.txt']);

    await expect(assertNoUnresolvedConflictState(repoRoot, ['h.txt'])).resolves.toBeUndefined();
  });

  it('does not throw on legitimate content that merely mentions ======= in prose', async () => {
    const { repoRoot, git } = await createTempRepo();
    await writeFile(path.join(repoRoot, 'doc.txt'), 'Heading\n=======\nbody text\n', 'utf8');
    await git.add(['doc.txt']);

    await expect(assertNoUnresolvedConflictState(repoRoot, ['doc.txt'])).resolves.toBeUndefined();
  });
});

describe('B6: getWorktreeStatusSummary must report real file paths for renames and spaced paths', () => {
  it('reports the renamed destination path and unquoted spaced paths', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-ds-'));
    const git = await initRepo(repoRoot);
    await writeFile(path.join(repoRoot, 'old name.txt'), 'content\n', 'utf8');
    await git.add(['old name.txt']);
    await git.commit('init with spaced name');

    await git.mv('old name.txt', 'new name.txt');
    await writeFile(path.join(repoRoot, 'with space.txt'), 'x\n', 'utf8');

    const summary = await getWorktreeStatusSummary(repoRoot);

    expect(summary.dirty).toBe(true);
    // The renamed destination must appear as a real path, not garbled with `->` or quotes.
    expect(summary.changedFiles).toContain('new name.txt');
    expect(summary.changedFiles).toContain('with space.txt');
    for (const file of summary.changedFiles) {
      expect(file).not.toContain('->');
      expect(file.startsWith('"')).toBe(false);
      // Each reported path must resolve to a real file/dir on disk.
      const abs = path.join(repoRoot, file);
      expect(await pathExists(abs) || await realpath(abs).then(() => true).catch(() => false)).toBe(true);
    }
  });
});
