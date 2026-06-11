# Wave 2: Git Prune / Auto-stash / Merge Safety Validation

## Scope
Validated the Wave 1 git safety claims for OpenWeft startup pruning, retained branch handling, dirty-tree auto-stash restore behavior, worktree lifecycle cleanup, merge conflict detection, and second-order risks from possible fixes. No source code was changed. The only repo write from this pass is this report.

## Files Inspected
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `ARCHITECTURE.md`
- `package.json`
- `research-output/openweft-production-ux-review/wave-1-intelligence-summary.md`
- `research-output/openweft-production-ux-review/wave-1/git-worktree-merge-safety.md`
- `research-output/openweft-production-ux-review/wave-1/orchestrator-correctness.md`
- `research-output/openweft-production-ux-review/wave-1/checkpoint-resume-stop-recovery.md`
- `research-output/openweft-production-ux-review/wave-1/tests-release-readiness.md`
- `src/git/worktrees.ts`
- `src/orchestrator/realRun.ts`
- `tests/git/worktrees.test.ts`
- `tests/git/worktrees.autostash.test.ts`
- `tests/orchestrator/realRun.test.ts`
- `tests/e2e/cli-real-mock.test.ts`
- `tests/e2e/cli-background.test.ts`
- `tests/e2e/cli-dry-run.test.ts`

## Commands Run
- `node -v` -> `v24.9.0`
- `npm -v` -> `11.6.0`
- `git status --short` -> pre-existing untracked `.ultra_work/`, `.ultra_work_first_draft_openweft_safety.md`, `bin/`, `research-output/`, and `skills/`.
- `npm exec -- vitest run tests/git/worktrees.test.ts tests/git/worktrees.autostash.test.ts` -> 2 files passed, 34 tests passed.
- `npm exec -- vitest run tests/orchestrator/realRun.test.ts -t "(prunes orphaned OpenWeft worktrees and branches before starting a new run|fails closed before pruning startup artifacts when the checkpoint is corrupted|records post-merge auto-stash restore failures with merge metadata|resolves merge conflicts through the orchestrator worktree retry path|recreates execution cleanly when a stale branch ref exists but the old worktree is gone|recreates execution cleanly when the checkpoint worktree path is missing but git still has the stale registration|marks a stale planned feature complete when its completion commit is already merged into main|recovers a reusable completed commit even when the checkpoint already marked the feature failed)"` -> 1 file passed, 8 tests passed, 68 skipped.
- `npm exec -- vitest run tests/e2e/cli-real-mock.test.ts tests/e2e/cli-background.test.ts tests/e2e/cli-dry-run.test.ts` -> 3 files passed, 4 tests passed.
- Temp-repo prune probe with `node --import tsx --input-type=module`: created a managed worktree and called `pruneOrphanedOpenWeftArtifacts()` with only `retainedBranchNames`. Result removed the worktree and deleted the supposedly retained branch.
- Static guard probe with `node --input-type=module`: confirmed the conflict block returns `autoStash: autoStashResult`, does not check `!autoStashResult.restored`, while the success block does throw `PostMergeAutoStashRestoreError` on failed restore.

## Validation Result Per Claim

### Claim 1: `retainedBranchNames` are computed but not used during orphan pruning
Result: Confirmed.

Evidence: `realRun.ts:292-313` computes retained worktree paths and retained branch names from actionable checkpoint features and passes both into `pruneOrphanedOpenWeftArtifacts()`. In `worktrees.ts:630-647`, `retainedBranchNames` is constructed, but the prune loop only checks `retainedWorktreePaths` before removing a listed managed worktree (`worktrees.ts:649-669`). The retained branch set is not consulted before `removeWorktree()` deletes the branch. The temp-repo probe confirmed this behavior: a branch passed only through `retainedBranchNames` was deleted.

Nuance: if the checkpoint still has a valid retained `worktreePath`, the path check protects the branch indirectly. The bug appears when branch retention is the only protection, for example path drift, missing/null path, or mismatched checkpoint state.

### Claim 2: conflict-path auto-stash restore failures are returned as ordinary conflict instead of higher-severity restore failure
Result: Confirmed.

Evidence: In `mergeBranchIntoCurrent()`, a merge conflict aborts the base merge, calls `restoreAutoStash()`, then returns `status: 'conflict'` with `autoStash: autoStashResult` (`worktrees.ts:891-918`). Unlike the clean-merge path, it does not check `!autoStashResult.restored`. The clean-merge path throws `PostMergeAutoStashRestoreError` when restore fails (`worktrees.ts:921-931`). The orchestrator only handles the typed restore failure in catch blocks (`realRun.ts:3019-3037`, `realRun.ts:3349-3369`); ordinary conflict results immediately enter the conflict-resolution loop (`realRun.ts:3038-3370`).

### Claim 3: worktree lifecycle/merge safety and conflict detection behavior
Result: Mostly validated, with the two gaps above.

Evidence: Existing tests cover create/list/remove worktrees, branch deletion on explicit removal, refusal to remove arbitrary non-worktree paths, stale managed directory cleanup, detached branch preservation, clean merges, dirty-tree auto-stash on clean merges, ordinary conflict returns with merge state aborted, merge-into-worktree conflict preservation, conflict-marker sanity checks, reusable completion recovery, final durability downgrades, and e2e mock-backed CLI merge flows. The focused git, orchestrator, and e2e slices all passed in this run.

Residual gap: existing tests do not cover branch-only retention during prune, nor conflict-plus-auto-stash-restore-failure returning a severity distinct from ordinary merge conflict.

### Claim 4: fixes could cause second-order branch leakage, user-change loss, or clutter
Result: Confirmed as a design risk for both fixes.

Branch retention is not free. `createOrResetFeatureWorktree()` currently deletes a stale branch when a checkpoint has `branchName` but the worktree is missing (`realRun.ts:1910-1935`). Existing tests assert rerun succeeds in stale branch/worktree cases (`tests/orchestrator/realRun.test.ts:4777-4841`). If prune starts preserving branch-only state without a branch-head reuse policy or expiration, OpenWeft can accumulate stale branches or hit branch-name collisions on rerun.

Auto-stash escalation is safer for user changes, but it changes run flow. A failed stash restore after a conflict means the base repo may contain partially restored or unmerged user changes. Treating it as a normal agent-resolvable merge conflict risks user-change loss or confusing prompts. Treating it as fatal preserves safety but must produce a clear operator recovery message and avoid burying unrelated completed merge state.

## Findings

### High - Startup Prune Ignores Retained Branch Names
- Severity: High
- Area: Git cleanup / resume safety
- Evidence: `retainedBranchNames` is created in `worktrees.ts:643-647` but is never used in the prune decision. Listed managed worktrees are retained only by normalized path (`worktrees.ts:649-657`) and otherwise removed with their branch (`worktrees.ts:659-669`). Startup passes checkpoint branch names into this API (`realRun.ts:308-313`), so the API surface promises retention that the implementation does not honor.
- User impact: a startup cleanup can delete an OpenWeft-managed branch that the checkpoint still names as actionable if path retention is absent or stale. That can remove the only easy pointer to a completed-but-not-merged worker commit and force rerun or manual recovery.
- Recommended fix: make branch retention part of the prune predicate. For listed managed worktrees, skip prune when either normalized path is retained or `worktree.branch` is in `retainedBranchNames`. Add audit data for branch-retained/path-missing cases. Then decide whether branch-only recovery should inspect branch HEAD for an `openweft: complete feature <id>` commit before any later rerun deletes the branch.
- Confidence: High.
- What would disconfirm: a proven invariant that every actionable checkpoint feature with `branchName` always has a correct, retained, listed `worktreePath` at startup, and that branch-only retention is intentionally dead API. Current stale-worktree tests and recovery code do not establish that invariant.

### High - Conflict Auto-stash Restore Failure Is Downgraded To Ordinary Merge Conflict
- Severity: High
- Area: Dirty-tree merge safety / user-change preservation
- Evidence: `restoreAutoStash()` returns `{ restored: false, recoveryMessage }` when stash apply fails or leaves unmerged files (`worktrees.ts:202-224`). The clean-merge path throws a typed `PostMergeAutoStashRestoreError` (`worktrees.ts:921-931`), but the conflict path returns `status: 'conflict'` with the failed auto-stash result (`worktrees.ts:900-918`). The orchestrator does not inspect `merged.autoStash` before conflict resolution (`realRun.ts:3038-3370`).
- User impact: OpenWeft can ask an agent to resolve an ordinary feature merge conflict while the base repo also has a failed restoration of the user's pre-existing uncommitted work. The stash remains recoverable, but the severity and next action are hidden behind the normal conflict path.
- Recommended fix: add a distinct restore-failure result or typed error for conflict-path stash restore failure. It should stop normal conflict resolution, mark the feature/run failed or blocked with a specific failure stage, preserve the stash recovery message, and avoid claiming an agent-resolvable feature conflict until the operator's pre-existing changes are safe.
- Confidence: High.
- What would disconfirm: caller-side handling that already inspects `merged.autoStash.restored === false` before conflict resolution. I found none.

### Medium - Existing Worktree/Merge Safety Is Strong But Edge-case Coverage Is Incomplete
- Severity: Medium
- Area: Worktree lifecycle and conflict detection tests
- Evidence: `tests/git/worktrees.test.ts` covers ordinary conflict detection and abort cleanup (`tests/git/worktrees.test.ts:156-194`, `490-507`), staged conflict preservation for worktree resolution (`196-229`), dirty-tree successful auto-stash behavior (`348-387`), clean-merge failed restore escalation (`428-449`), and prune behavior for retained paths and detached branches (`595-661`). `tests/orchestrator/realRun.test.ts` covers startup orphan pruning (`3292-3381`), typed post-merge stash restore failure handling (`3782-3879`), and conflict retry orchestration (`3881-3980`). Focused tests passed.
- User impact: common lifecycle and conflict behavior is protected, but the exact Wave 2 safety bugs can survive green tests because they sit between existing assertions.
- Recommended fix: add narrow regression tests for the missing branches: branch-only retention during prune and conflict-path auto-stash failed restore escalation.
- Confidence: High.
- What would disconfirm: existing hidden tests outside this repo that already cover those two edge cases.

## Proposed Regression Tests
- `tests/git/worktrees.test.ts`: `preserves a retained branch during orphan pruning even when retainedWorktreePaths is empty`. Create a managed worktree, call prune with `retainedBranchNames` only, and assert the branch is not deleted. Decide whether the worktree should also remain listed; if recovery depends on the worktree, preserve both.
- `tests/git/worktrees.test.ts` or `tests/git/worktrees.autostash.test.ts`: mock `simple-git` so merge throws a conflict, merge abort succeeds, `stash apply` fails, and assert `mergeBranchIntoCurrent()` returns/throws a higher-severity restore failure instead of `{ status: 'conflict' }`.
- `tests/orchestrator/realRun.test.ts`: mock `mergeBranchIntoCurrent()` to return `status: 'conflict'` plus `autoStash: { created: true, restored: false }`, and assert no conflict-resolution adapter turn is started. The checkpoint/audit should record a stash-restore failure stage with recovery text.
- `tests/orchestrator/realRun.test.ts`: seed a checkpoint with actionable feature `branchName` retained but missing/mismatched `worktreePath`; verify startup prune does not delete the branch before recovery policy decides whether to reuse or rerun.
- Optional branch-head recovery test: when the worktree is gone but the retained branch HEAD has exact subject `openweft: complete feature <id>` and real changed paths, verify OpenWeft can merge/recover without rerunning, or explicitly deletes it with an audit event if branch-only reuse is out of scope.

## Domino Risks
- Branch leakage: honoring every retained branch name without expiry or status gating can leave stale `openweft-*` branches around forever.
- Branch-name collisions: preserving a branch that `createWorktree(... -b branchName ...)` later tries to recreate can make reruns fail unless the rerun path either reuses, renames, or intentionally deletes the branch after safety checks.
- False recovery confidence: branch-only preservation is not useful unless recovery can inspect branch HEAD or reconnect a worktree. Otherwise the system keeps clutter without improving recovery.
- User-change loss: conflict-path stash restore failure is more severe than feature merge conflict because it involves pre-existing operator changes, not just agent output. Normal conflict-resolution prompts should not proceed in a dirty or unmerged base tree.
- Operator interruption: escalating stash restore failure will stop more runs. The fix should make the message actionable: stash identifier, recovery command guidance, affected feature, and whether the feature branch/worktree remain intact.
- Checkpoint timing: successful merge cleanup saves the feature completion before removing the worktree and nulling branch/worktree fields, then persists again later during queue-management (`realRun.ts:3506-3534`, `3546-3571`). A crash in that window can leave stale completed-feature branch/path fields. This is lower risk than actionable-feature pruning because completed features are not retained at startup, but status and diagnostics should tolerate it.
- Audit semantics: if prune starts skipping branch-retained worktrees, `repo.orphans.pruned` counts may drop. Add a separate `repo.orphans.retained` or similar audit payload so lower cleanup counts do not look like missed cleanup.

###COMPLETE###
