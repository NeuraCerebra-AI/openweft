# Wave 2: Recovery / Stop / Checkpoint Validation

## Scope

Validated Wave 1 recovery and stop claims against the current OpenWeft tree. This pass was read-only for source code; the only repo write is this report. Focus areas were stopped checkpoint restart semantics, checkpoint backup seeding, status rendering for stopped states, and executing-to-planned crash recovery.

## Files Inspected

- `/Users/warrencain/Documents/openweft/AGENTS.md`
- `/Users/warrencain/Documents/openweft/CLAUDE.md`
- `/Users/warrencain/Documents/openweft/README.md`
- `/Users/warrencain/Documents/openweft/ARCHITECTURE.md`
- `/Users/warrencain/Documents/openweft/package.json`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/wave-1-intelligence-summary.md`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/wave-1/checkpoint-resume-stop-recovery.md`
- `/Users/warrencain/Documents/openweft/src/state/checkpoint.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/stop.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/finalization.ts`
- `/Users/warrencain/Documents/openweft/src/status/renderStatus.ts`
- `/Users/warrencain/Documents/openweft/src/status/runtimeDiagnostics.ts`
- `/Users/warrencain/Documents/openweft/src/ui/styledOutput.tsx`
- `/Users/warrencain/Documents/openweft/src/cli/handlers.ts`
- `/Users/warrencain/Documents/openweft/src/cli/buildProgram.ts`
- `/Users/warrencain/Documents/openweft/tests/state/checkpoint.test.ts`
- `/Users/warrencain/Documents/openweft/tests/status/renderStatus.test.ts`
- `/Users/warrencain/Documents/openweft/tests/orchestrator/realRun.test.ts`
- `/Users/warrencain/Documents/openweft/tests/e2e/cli-background.test.ts`
- `/Users/warrencain/Documents/openweft/tests/e2e/cli-real-mock.test.ts`

## Commands Run

- `wc -l AGENTS.md CLAUDE.md README.md ARCHITECTURE.md package.json research-output/openweft-production-ux-review/wave-1-intelligence-summary.md research-output/openweft-production-ux-review/wave-1/checkpoint-resume-stop-recovery.md`
  - Summary: confirmed required context sizes: 1,826 total lines.
- `sed -n ...` / `nl -ba ...` reads over required docs, source, status, CLI, and tests.
  - Summary: source path inspection only; no source modifications.
- `rg --files src/status tests/state tests/e2e tests/orchestrator | sort`
  - Summary: relevant status/test surface is `src/status/renderStatus.ts`, `src/status/runtimeDiagnostics.ts`, `tests/state/checkpoint.test.ts`, `tests/status/renderStatus.test.ts`, `tests/e2e/cli-background.test.ts`, `tests/e2e/cli-real-mock.test.ts`, `tests/e2e/cli-dry-run.test.ts`, and `tests/orchestrator/realRun.test.ts`.
- `npm exec -- vitest run tests/state/checkpoint.test.ts tests/status/renderStatus.test.ts`
  - Summary: 2 files passed; 17 tests passed.
- `npm exec -- vitest run tests/orchestrator/realRun.test.ts -t "(recovers planned work after a crash that happens after queue rewrite|repairs a missing promptBFile|replays pending merge summaries before restart execution resumes|marks a stale planned feature complete|reuses a completed feature commit|treats quit-driven approval cancellation|stops after the current planning item|does not start an execution retry after stop is requested|writes a terminal run.stopped audit)"`
  - Summary: 1 file passed; 10 tests passed, 66 skipped.
- `npm exec -- vitest run tests/e2e/cli-background.test.ts tests/e2e/cli-real-mock.test.ts`
  - Summary: 2 files passed; 3 tests passed.
- `npm exec -- vitest run tests/orchestrator/realRun.test.ts -t "(recreates execution cleanly when the checkpoint worktree path is missing|recovers a reusable completed commit even when the checkpoint already marked the feature failed|reuses an interrupted execution commit even after a prior restart already rewrote the feature back to planned)"`
  - Summary: 1 file passed; 3 tests passed, 73 skipped.
- `npm exec -- tsx --eval ...` backup probe
  - Summary: first attempt failed because `tsx --eval` used CJS output and rejected top-level `await`; reran wrapped in an async function.
- Async backup probe using `saveCheckpoint()` in a temp directory.
  - Summary: output showed `"backupExistsAfterFirstSave": false` and `"loadedSource": "primary"`.
- Temp-repo stopped restart probe using `node --import tsx --input-type=module`.
  - Summary: first run stopped after planning one feature with `pendingRequests: 0` and `queuePending: 0`; second `runRealOrchestration()` returned `status: "stopped"`, made no adapter calls, and made `executionRequests: 0`.
- Status rendering probe using `renderStatusReport()`.
  - Summary: stopped-with-pending-queue and stopped-ready-to-execute both render raw counts and planned features, but no next-action distinction.
- `git status --short`
  - Summary: repo already has unrelated untracked paths; no source edits were made by this pass.

## Validation Result Per Claim

1. Stopped checkpoint with planned/execution-eligible features and empty pending queue can dead-end on next start/resume: Confirmed.
   - Source trace: `planPendingRequests()` returns without changing status when the queue has no pending lines (`src/orchestrator/realRun.ts:1489-1500`). `loadOrCreateCheckpoint()` reopens resumable `failed` checkpoints but not `stopped` checkpoints (`src/orchestrator/realRun.ts:846-856`). The main loop immediately returns on any stopped checkpoint before scoring or execution (`src/orchestrator/realRun.ts:3624-3630`).
   - Runtime probe: stopped after planning one feature; restart made zero adapter calls and zero execution requests while feature `001` remained `planned`.

2. First checkpoint save does not seed backup: Confirmed.
   - Source trace: `saveCheckpoint()` only writes `.backup` when a previous primary checkpoint was read (`src/state/checkpoint.ts:267-284`).
   - Runtime probe: after the first save, `backupExistsAfterFirstSave` was `false`.

3. Status/rendering should distinguish stopped-with-pending-queue from stopped-ready-to-execute: Confirmed as a UX/diagnostic gap, with nuance.
   - Nuance: if the queue file still has pending requests, `planPendingRequests()` can set the checkpoint back to `in-progress` before the stopped early return (`src/orchestrator/realRun.ts:1494-1518`). The harder dead end is stopped + no pending queue + planned features.
   - Current non-TTY status shows `Status: stopped`, `Pending Queue`, and `Planned`, but no explanation of whether `start` will continue or immediately return (`src/status/renderStatus.ts:99-110`). The TTY card similarly renders phase, diagnostics, pending requests, and agents without a next-action distinction (`src/ui/styledOutput.tsx:31-60`).

4. Crash recovery/reset semantics from executing to planned: Mostly confirmed working for crash/resume, but it inherits the stopped dead-end when stop converts the run to `stopped`.
   - Source trace: on load, unresolved `executing` features are reset to `planned` and session IDs are cleared when no reusable/already-merged completion is proven (`src/orchestrator/realRun.ts:881-956`).
   - Tests cover reusable completion, dirty/stale worktree reruns, missing worktree recreation, and deferred re-analysis replay. Focused test slices passed.
   - Caveat: a stop during execution also leaves an eligible planned feature in a `stopped` run, so the reset is correct but the restart path can still strand it.

## Findings

### Finding 1

- Severity: P1
- Area: orchestrator stop/resume
- Evidence: `loadOrCreateCheckpoint()` reactivates only failed checkpoints with unfinished work (`src/orchestrator/realRun.ts:846-856`), not stopped checkpoints. `runRealWorkflow()` returns immediately when `context.checkpoint.status === 'stopped'` (`src/orchestrator/realRun.ts:3624-3630`). A temp-repo probe reproduced the failure: after a final planning stop, restart returned `stopped`, made no adapter calls, had `executionRequests: 0`, and left feature `001` as `planned` with empty pending queue.
- User impact: a user can do the safe thing, stop a run after planning or during an active turn, then run `openweft start` expecting recovery. Instead, OpenWeft exits without executing the already-planned work. From the outside, it looks like the queue is recoverable, but the run is stranded.
- Recommended fix: define stopped resume semantics explicitly. If `status === 'stopped'` and there are execution-eligible features, pending merge summaries, or pending queue items, `start` should either reopen the checkpoint to `in-progress` or refuse with a clear "stopped by user; run openweft resume/clear" action. Given current docs say `start` resumes, the lower-friction fix is to reopen stopped checkpoints with actionable work before the early return.
- Confidence: High.
- What would disconfirm the finding: an explicit product decision that `stopped` is a permanent terminal freeze and `openweft start` is intentionally not a resume path for stopped checkpoints, plus a documented/manual operator command for unfreezing them.

### Finding 2

- Severity: P2
- Area: state/checkpoint durability
- Evidence: `saveCheckpoint()` catches a missing primary as "No current primary checkpoint to back up yet" and skips backup creation (`src/state/checkpoint.ts:267-284`). The backup exists only after a second save has a previous primary to copy. The focused probe printed `"backupExistsAfterFirstSave": false`.
- User impact: the first durable checkpoint has no fallback. If the first primary checkpoint becomes unreadable, `loadCheckpoint()` has no valid backup and fails closed, weakening the recovery promise at the moment the run first becomes recoverable.
- Recommended fix: seed the backup on first save when no backup exists, probably by writing the same validated checkpoint to both primary and backup. Then keep later saves as previous-snapshot backup if that semantics is intentional.
- Confidence: High.
- What would disconfirm the finding: a documented contract that `.backup` is strictly "previous primary only" and is intentionally absent for the first checkpoint, with UI/docs avoiding any implication that the first checkpoint has backup redundancy.

### Finding 3

- Severity: P2
- Area: status and operator recovery UX
- Evidence: `renderStatusReport()` renders raw lines for `Status`, `Pending Queue`, `Processed Queue Entries`, and planned features (`src/status/renderStatus.ts:99-110`). The TTY `StatusCard` renders phase, diagnostics, pending requests, and agents, but not stopped-state semantics (`src/ui/styledOutput.tsx:31-60`). The status probe showed stopped-with-pending-queue and stopped-ready-to-execute differ only by counts, not by recovery guidance.
- User impact: users cannot tell whether a stopped run will resume planning, resume execution, or immediately return without work. This makes the P1 dead-end harder to diagnose and risks users manually editing checkpoint/queue files.
- Recommended fix: add a derived recovery line to both non-TTY and TTY status. Example states: `Stopped: pending queue remains; start will continue planning`, `Stopped: planned work remains; start will resume execution`, and `Stopped: no actionable work remains`. Keep this line backed by the same execution-eligible predicate used by the orchestrator.
- Confidence: High for non-TTY status; Medium-high for TTY status because source inspection shows no semantic line, but I did not render a live TTY screenshot.
- What would disconfirm the finding: another status/help path outside `renderStatusReport()` and `StatusCard` that is always shown to users and explains these stopped-state differences before they rerun.

## Proposed Regression Tests

1. Add an orchestrator test that stops after the final planning item with one queue request, verifies `pendingRequests.length === 0` and feature status `planned`, then calls `runRealOrchestration()` again and expects execution to run and the feature to complete.
2. Add an orchestrator test that stops during an active execution turn, verifies the feature is reset to `planned`, then restarts and expects execution to run rather than returning `stopped`.
3. Add a checkpoint persistence test: after the first `saveCheckpoint()`, assert that `checkpoint.json.backup` exists and can load if the primary is corrupted.
4. Add non-TTY status tests for stopped + pending queue, stopped + planned actionable work, and stopped + no actionable work.
5. Add a TTY/status-card unit test or snapshot for the same stopped-state recovery label.

## Domino Risks / Second-Order Effects

- Reopening stopped checkpoints changes stop semantics. If any user expects `stop` to mean "freeze forever," docs and status output need to make the new behavior explicit.
- Reopening stopped checkpoints must avoid duplicate planning. The fix should use queue processed IDs and existing checkpoint features as the source of truth.
- If first-save backup mirrors the primary, the status line `Backup Semantics: previous snapshot by design` becomes imprecise for the first save. It may need wording like `Backup Semantics: first-save mirror or previous snapshot`.
- Finalization already records `run.stopped`; after a later successful resume, audit consumers may see both `run.stopped` and `run.completed` for one checkpoint lineage. That is fine if documented, but dashboards should treat the latest terminal event as authoritative.
- Any status-derived "start will resume" line should share the orchestrator predicate for actionable work; duplicating that logic loosely could create a new mismatch.

###COMPLETE###
