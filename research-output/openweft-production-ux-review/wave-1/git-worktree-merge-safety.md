# git-worktree-merge-safety

## Scope
Reviewed merge and recovery safety across `src/git/worktrees.ts`, merge call sites in `src/orchestrator/realRun.ts`, finalization in `src/orchestrator/finalization.ts`, merge durability checks in `src/status/runtimeDiagnostics.ts`, and the git-related tests under `tests/git`, `tests/e2e`, and the relevant `tests/orchestrator/realRun.test.ts` slices. Also read `AGENTS.md`, `CLAUDE.md`, `README.md`, `ARCHITECTURE.md`, `package.json`, and `research-output/openweft-production-ux-review/00_research_target_matrix.md`.

## Files Inspected
- `/Users/warrencain/Documents/openweft/AGENTS.md`
- `/Users/warrencain/Documents/openweft/CLAUDE.md`
- `/Users/warrencain/Documents/openweft/README.md`
- `/Users/warrencain/Documents/openweft/ARCHITECTURE.md`
- `/Users/warrencain/Documents/openweft/package.json`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/00_research_target_matrix.md`
- `/Users/warrencain/Documents/openweft/src/git/worktrees.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/finalization.ts`
- `/Users/warrencain/Documents/openweft/src/status/runtimeDiagnostics.ts`
- `/Users/warrencain/Documents/openweft/tests/git/worktrees.test.ts`
- `/Users/warrencain/Documents/openweft/tests/git/worktrees.autostash.test.ts`
- `/Users/warrencain/Documents/openweft/tests/e2e/cli-real-mock.test.ts`
- `/Users/warrencain/Documents/openweft/tests/orchestrator/realRun.test.ts`

## Commands Run
- `/opt/homebrew/bin/node ./node_modules/vitest/vitest.mjs run tests/git/worktrees.test.ts` - 33 tests passed.
- `/opt/homebrew/bin/node ./node_modules/vitest/vitest.mjs run tests/git/worktrees.autostash.test.ts` - 1 test passed.
- `/opt/homebrew/bin/node ./node_modules/vitest/vitest.mjs run tests/e2e/cli-real-mock.test.ts` - 6 tests passed, 70 skipped.
- `/opt/homebrew/bin/node ./node_modules/vitest/vitest.mjs run tests/orchestrator/realRun.test.ts -t "(writes a terminal run.completed audit and cleans codex-home on success|downgrades a completed run to failed when a completed feature has no merge commit|downgrades a completed run to failed when final head no longer contains the completed merge commit|downgrades a completed run to failed when codex-home cleanup does not stick)"` - 4 tests passed, 72 skipped.
- Note: `npx`/`npm` were not on PATH in this shell, so I used the absolute Homebrew Node binary directly.

## Findings

### High - Cleanup/Recovery: retained branch names are ignored during orphan pruning
- Evidence: `src/orchestrator/realRun.ts` passes both retained worktree paths and retained branch names into `pruneOrphanedOpenWeftArtifacts` at startup, but `src/git/worktrees.ts` computes `retainedBranchNames` and never reads it. The removal path still deletes the branch when a worktree is removed. See [`realRun.ts:308`](</Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:308>) and [`worktrees.ts:643`](</Users/warrencain/Documents/openweft/src/git/worktrees.ts:643>) plus [`worktrees.ts:619`](</Users/warrencain/Documents/openweft/src/git/worktrees.ts:619>).
- User impact: a startup cleanup can delete a branch that the checkpoint still wants to keep for recovery, which can break resume/reuse and make a partially completed feature harder or impossible to recover.
- Recommended fix: make branch retention part of the prune decision, not just path retention. Preserve any branch in `retainedBranchNames` even if the worktree path is missing or stale, and add a regression test for the branch-retained-but-path-missing case.
- Confidence: high.
- What would disconfirm: a guarantee that active features can never exist with a retained branch name and no retained worktree path. The current recovery/update paths already show branch and worktree fields can diverge.

### Medium - Merge Recovery: conflict-path auto-stash restore failures are downgraded to a plain conflict
- Evidence: `mergeBranchIntoCurrent()` throws `PostMergeAutoStashRestoreError` when stash restore fails after a clean merge, but in the conflict branch it restores the stash and still returns `status: 'conflict'` even if `restored` is false. `realRun.ts` then only checks for `merged.status === 'conflict'` and does not inspect `autoStash` before entering conflict resolution. See [`worktrees.ts:900`](</Users/warrencain/Documents/openweft/src/git/worktrees.ts:900>), [`worktrees.ts:921`](</Users/warrencain/Documents/openweft/src/git/worktrees.ts:921>), and [`realRun.ts:3038`](</Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3038>).
- User impact: if a dirty-tree merge also breaks stash restoration, OpenWeft can proceed as though it is handling an ordinary merge conflict while the repo root is still in a partially restored or conflicted state.
- Recommended fix: mirror the success-path guard in the conflict branch and throw when `autoStashResult.restored` is false, or add explicit caller-side handling of that failure before conflict resolution starts. Add a regression test for the conflict-plus-stash-restore-failure case.
- Confidence: medium.
- What would disconfirm: a documented design choice that conflict-path stash restoration failures are intentionally recoverable and handled elsewhere. I did not find any caller-side handling of `autoStash` for this path.

## Merge Safety Map
- `createWorktree` / `removeWorktree`: create and tear down isolated worker branches and directories. Residual risk: cleanup currently honors retained paths, but not retained branch names.
- `mergeBranchIntoCurrent`: handles dirty-tree auto-stash, conflict detection, merge commit capture, and edit summaries. Residual risk: stash restore failures on conflict are not escalated.
- `mergeBranchIntoWorktree`: preserves merge state for conflict-resolution turns via `MERGE_HEAD` instead of aborting immediately.
- `assertNoUnresolvedConflictState`: checks unresolved index entries and conflict-marker residue before a feature is treated as repaired.
- `finalizeRun` + `runtimeDiagnostics`: re-check merge commit reachability at the end of the run and downgrade completed runs when the recorded merge commits are missing or no longer reachable from final HEAD.

## Domino / Second-Order Risks
- If startup pruning drops a retained branch, recovery can fall back to reruns instead of reuse, which increases duplicate work and can erase the cleanest recovery anchor for a feature.
- If conflict-path stash restoration fails but is treated as a normal merge conflict, later retries can stack on a dirty base tree and produce confusing or misleading conflict-resolution prompts.
- Final durability verification is strong, but it only protects the completed merge commits that still exist. It cannot recover a branch that got deleted earlier in startup cleanup.

## Recommended Follow-Up
1. Wire `retainedBranchNames` into the orphan-prune logic and add a regression test where a retained branch survives even when its worktree path is absent.
2. Decide whether conflict-path auto-stash restoration failure should be a hard failure. If yes, surface it the same way the clean-merge path does and add a regression test.
3. Re-run the four targeted test commands above after the fix, plus one resume/prune smoke for a checkpoint with an actionable feature and a missing worktree path.

###COMPLETE###
