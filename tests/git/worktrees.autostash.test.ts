import { describe, expect, it, vi } from 'vitest';

describe('git auto-stash bookkeeping', () => {
  it('reports merged when only auto-stash drop fails after a successful restore', async () => {
    const commandLog: string[] = [];
    const stashEntries = [
      {
        ref: 'stash@{0}',
        oid: 'oid-auto-drop-fail',
        subject: 'On main: openweft: auto-stash before merging agent-drop-fail [token-auto]'
      }
    ];
    let mergeCompleted = false;

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
          throw new Error('stash drop failed');
        }
        throw new Error(`Unexpected stash command: ${args.join(' ')}`);
      }),
      merge: vi.fn(async () => {
        mergeCompleted = true;
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
          expect(args[2]).toBe('oid-auto-drop-fail');
          return 'Applied';
        }
        if (args[0] === 'diff' && args.includes('--diff-filter=U')) {
          return '';
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
      const result = await worktreesModule.mergeBranchIntoCurrent('/fake/repo', 'agent-drop-fail');

      expect(result.status).toBe('merged');
      if (result.status === 'merged') {
        expect(result.autoStash).toMatchObject({
          created: true,
          restored: true
        });
        expect(result.autoStash?.recoveryMessage).toContain('could not remove the stash entry');
      }
      expect(commandLog).toContain('raw stash apply oid-auto-drop-fail');
      expect(commandLog).toContain('stash drop stash@{0}');
    } finally {
      vi.doUnmock('node:crypto');
      vi.doUnmock('simple-git');
      vi.resetModules();
    }
  });
});
