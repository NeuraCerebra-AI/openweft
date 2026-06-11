# checkpoint-resume-stop-recovery

## Scope
Reviewed the recovery surface only: `src/state/checkpoint.ts`, `src/orchestrator/stop.ts`, `src/orchestrator/finalization.ts`, the resume/stop paths in `src/orchestrator/realRun.ts`, `src/status/runtimeDiagnostics.ts`, `tests/state`, `tests/orchestrator`, `tests/e2e`, plus the repo docs and `research-output/openweft-production-ux-review/00_research_target_matrix.md`. No source edits were made.

## Files Inspected
- `AGENTS.md`, `CLAUDE.md`, `README.md`, `ARCHITECTURE.md`, `package.json`
- `research-output/openweft-production-ux-review/00_research_target_matrix.md`
- `src/state/checkpoint.ts`, `src/orchestrator/stop.ts`, `src/orchestrator/finalization.ts`
- `src/orchestrator/realRun.ts`, especially the load/resume, planning stop, execution stop, and post-run finalize branches
- `src/status/runtimeDiagnostics.ts`
- `tests/state/checkpoint.test.ts`
- `tests/orchestrator/realRun.test.ts`
- `tests/e2e/cli-background.test.ts`, `tests/e2e/cli-real-mock.test.ts`
- `tests/status/renderStatus.test.ts`

## Commands Run
- `rg --files | rg 'matrix|target'` to locate the target matrix file
- `/opt/homebrew/bin/npm exec -- vitest run tests/state/checkpoint.test.ts tests/e2e/cli-background.test.ts tests/e2e/cli-real-mock.test.ts -t "(saves and loads a checkpoint from the primary file|falls back to the backup file when the primary is corrupted|stops after the current planning item when a stop is requested during planning|does not start an execution retry after stop is requested during an active turn|writes a terminal run.stopped audit and preserves codex-home on stop|writes a terminal run.completed audit and cleans codex-home on success|downgrades a completed run to failed when a completed feature has no merge commit|downgrades a completed run to failed when codex-home cleanup does not stick)"`
- `/opt/homebrew/bin/npm exec -- vitest run tests/orchestrator/realRun.test.ts -t "(recovers planned work after a crash that happens after queue rewrite but before the planning checkpoint is saved|repairs a missing promptBFile from the canonical artifact before execution resumes|repairs a missing promptBFile from a legacy prompt-b artifact before execution resumes|recovers a reusable interrupted execution even if its Work Brief artifact is missing|persists pending merge summaries in checkpoint when re-analysis aborts after a merge|replays pending merge summaries before restart execution resumes|treats quit-driven approval cancellation as a stopped run instead of a failure|remembers first-only approval across checkpoint resume|stops after the current planning item when a stop is requested during planning|does not start an execution retry after stop is requested during an active turn|writes a terminal run.stopped audit and preserves codex-home on stop|writes a terminal run.completed audit and cleans codex-home on success|downgrades a completed run to failed when a completed feature has no merge commit|downgrades a completed run to failed when final head no longer contains the completed merge commit|downgrades a completed run to failed when codex-home cleanup does not stick)"`

Focused test results:
- State/e2e subset: 2 passed, 11 skipped across 3 files
- Orchestrator subset: 15 passed, 61 skipped in 1 file

## Findings
### High | Area: orchestrator stop/resume
- Evidence: `planPendingRequests()` marks the checkpoint `stopped` when a stop is requested at the end of planning ([`realRun.ts`](</Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:1826>), lines 1826-1833). `runRealWorkflow()` then returns immediately on any stopped checkpoint before scoring or execution ([`realRun.ts`](</Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3624>), lines 3624-3630). `loadOrCreateCheckpoint()` only promotes `failed` checkpoints back to `in-progress`; it never reactivates a stopped checkpoint even when there are already planned features and no queue items left ([`realRun.ts`](</Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:846>), lines 846-856).
- User impact: if the user stops on the last planning turn, or stops after the queue has already been fully planned, a later `openweft start` can exit immediately and leave the planned features stranded. The run looks resumable, but the current state machine never reaches execution again without manual checkpoint surgery.
- Recommended fix: allow a stopped checkpoint with execution-eligible features and an empty pending queue to re-enter `in-progress`, or gate the early return on there still being unplanned queue items.
- Confidence: High
- What would disconfirm: if stop is intentionally a permanent freeze until a human manually edits the checkpoint or queue.

### Medium | Area: state/checkpoint
- Evidence: `saveCheckpoint()` only writes the `.backup` file when a previous primary checkpoint already exists ([`checkpoint.ts`](</Users/warrencain/Documents/openweft/src/state/checkpoint.ts:267>), lines 267-284). On a fresh run, the first durable checkpoint write skips the backup branch entirely.
- User impact: a corruption or partial write immediately after the first save has no backup snapshot to fall back to, which weakens the crash-recovery story exactly when the run first becomes durable.
- Recommended fix: seed the backup on the first write, or mirror every save into both primary and backup when the backup file is absent.
- Confidence: High
- What would disconfirm: if the intended contract is that the first checkpoint is seed-only and backup recovery only starts after a later save.

## Recovery State Map
- `planning` stop: queue rewrite and checkpoint save happen, status becomes `stopped`, and planned features remain in the checkpoint.
- `execution` stop: the current turn aborts back to `planned`, the checkpoint is marked `stopped`, and rerun retries are suppressed for that turn.
- `re-analysis` stop: `pendingMergeSummaries` are preserved so the next run can replay the adjustment pass.
- `finalization`: completed runs can be downgraded to `failed` if merge durability or codex-home cleanup fails.

## Domino / Second-Order Risks
- A stopped run with no pending queue can look resumable but actually be dead-ended by the current early return.
- The missing first backup makes the checkpoint layer more fragile than the README/architecture imply.
- Finalization can change a run from completed to failed after the fact, so status tools need to distinguish execution failure from post-run integrity failure.

## Recommended Follow-Up
- Add a regression test that stops on the final planning item, restarts with an empty queue, and verifies execution still resumes.
- Add a regression test or assertion that the first checkpoint save seeds a backup snapshot.
- Consider a status message that explains the difference between `stopped with pending queue` and `stopped but ready to execute`.

###COMPLETE###
