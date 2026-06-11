# Wave 2 Findings: orchestrator-loop-semantics-validation

## Scope
Validated OpenWeft's real and dry orchestration loop semantics for the four requested claims:

1. Permanent failed non-rerunnable features do not short-circuit while other work remains.
2. Dry-run can report completed even with failed feature results.
3. Partial successful re-analysis updates can be lost if a later reanalysis aborts before the final checkpoint save.
4. Plan-score-phase-execute-merge-replan-checkpoint loop invariants.

No source code was changed. This report is the only file written.

## Files Inspected
- `/Users/warrencain/Documents/openweft/AGENTS.md`
- `/Users/warrencain/Documents/openweft/CLAUDE.md`
- `/Users/warrencain/Documents/openweft/README.md`
- `/Users/warrencain/Documents/openweft/ARCHITECTURE.md`
- `/Users/warrencain/Documents/openweft/package.json`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/wave-1-intelligence-summary.md`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/wave-1/orchestrator-correctness.md`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/wave-1/checkpoint-resume-stop-recovery.md`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/wave-1/planning-pipeline.md`
- `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/dryRun.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/finalization.ts`
- `/Users/warrencain/Documents/openweft/src/adapters/mock.ts`
- `/Users/warrencain/Documents/openweft/src/domain/scoring.ts`
- `/Users/warrencain/Documents/openweft/src/domain/phases.ts`
- `/Users/warrencain/Documents/openweft/src/domain/manifest.ts`
- `/Users/warrencain/Documents/openweft/src/domain/errors.ts`
- `/Users/warrencain/Documents/openweft/src/fs/paths.ts`
- `/Users/warrencain/Documents/openweft/src/config/schema.ts`
- `/Users/warrencain/Documents/openweft/src/cli/handlers.ts`
- `/Users/warrencain/Documents/openweft/tests/orchestrator/realRun.test.ts`
- `/Users/warrencain/Documents/openweft/tests/e2e/cli-dry-run.test.ts`
- `/Users/warrencain/Documents/openweft/tests/e2e/cli-real-mock.test.ts`
- `/Users/warrencain/Documents/openweft/tests/domain/scoring.test.ts`
- `/Users/warrencain/Documents/openweft/tests/domain/phases.test.ts`
- `/Users/warrencain/Documents/openweft/tests/domain/manifest.test.ts`

## Commands Run
- `wc -l README.md ARCHITECTURE.md package.json research-output/openweft-production-ux-review/wave-1-intelligence-summary.md research-output/openweft-production-ux-review/wave-1/orchestrator-correctness.md`
- `find research-output/openweft-production-ux-review -maxdepth 3 -type f | sort`
- `rg -n "while \(true\)|unresolved|failed|rerunEligible|scores.length|runPendingReanalysis|pendingMergeSummaries|saveCheckpoint\(|status = 'completed'|executePlannedFeatures|allSettled|groupFeaturesIntoPhases|scoreFeatures|checkpoint.status|currentState|re-analysis|adjustment-failed" src/orchestrator/realRun.ts src/orchestrator/dryRun.ts`
- `rg -n "groupFeaturesIntoPhases|findManifestOverlap|hot|scoreFeatures|calculate|blast|success|EWMA|hysteresis|parseManifest|assertLedger|lastKnownGood|repair" src/domain/scoring.ts src/domain/phases.ts src/domain/manifest.ts`
- `rg -n "failed|rerunEligible|dry-run|completed|re-analysis|pendingMergeSummaries|adjustment|recomputes future phases|persists pending merge summaries|aborts|stopped|scores.length|unresolved" tests/orchestrator/realRun.test.ts tests/e2e/cli-dry-run.test.ts tests/e2e/cli-real-mock.test.ts tests/orchestrator/*.test.ts tests/e2e/*.test.ts`
- `npm exec -- vitest run tests/orchestrator/realRun.test.ts tests/e2e/cli-dry-run.test.ts tests/domain/scoring.test.ts -t "reruns a failed feature|notifies when a feature fails after its full rerun budget is exhausted|does not schedule a full rerun after a fatal execution failure|fails adjustment when the agent drops the required ledger section|persists pending merge summaries in checkpoint when re-analysis aborts after a merge|replays pending merge summaries before restart execution resumes|batches merged summaries into one adjustment per remaining feature|recomputes future phases after re-analysis changes a remaining manifest|replays deferred re-analysis after recovering an already-merged feature|initializes the repo scaffold and runs a dry-run batch end to end|propagates cyclesSeen|scores and ranks queue features"` -> passed, 3 files, 13 tests passed, 71 skipped.
- `npm exec -- vitest run tests/domain/phases.test.ts tests/domain/manifest.test.ts -t "overlap|phase|hot|manifest|ledger|last-known-good|repair"` -> passed, 2 files, 14 tests passed.
- Direct dry-run failure probe with `runDryRunOrchestration()` and `MockAgentAdapter({ fixtures: { execution: { error: "forced dry-run execution failure" } } })` -> reproduced false-completed state:

```json
{
  "resultStatus": "completed",
  "resultCompleted": 0,
  "savedStatus": "completed",
  "featureStatuses": {
    "001": "failed"
  }
}
```

- Direct scoring penalty probe against `scoreQueue()` and `calculateSuccessLikelihood()` -> reproduced dropped penalty in wrapper:

```json
{
  "scoreQueueWithout": 0.95,
  "scoreQueueWithPenalty": 0.95,
  "directWithout": 0.95,
  "directWith": 0.7999999999999999
}
```

- Two attempted inline real-run probes for "failed feature continues while other work remains" failed before reaching product logic because `tsx -e` hit `ERR_PACKAGE_PATH_NOT_EXPORTED` for `unicorn-magic`. I did not use those failed probes as product evidence.

## Validation Result Per Claim

### Claim 1: permanent failed non-rerunnable features do not short-circuit while other work remains
Result: Confirmed by code path, not directly runtime-reproduced in an inline probe.

Evidence chain:
- Real-run eligibility is `planned` or `failed && rerunEligible`; permanently failed features are excluded from scoring and phasing at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:451-460`.
- The outer `while (true)` plans, replays pending re-analysis, scores, then executes while work remains at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3616-3717`.
- The unresolved failed feature check is only inside the `scores.length === 0` branch at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3675-3689`.
- If a mixed phase has one terminal failed feature and one successful feature, `terminalFailedCount / settled.length` must be greater than `0.5` to trip the circuit breaker. A 1-of-2 terminal failure does not trip it because `circuitBreakerTripped()` uses `>` at `/Users/warrencain/Documents/openweft/src/domain/errors.ts:70-76`.
- Successful features still merge and re-analysis runs after that mixed phase at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:2993-3577`.
- On the next loop, any remaining planned feature still scores and executes because the permanent failure is not checked until no scores remain.

This conflicts with the architecture statement that the loop breaks when "unresolved failures remain" at `/Users/warrencain/Documents/openweft/ARCHITECTURE.md:63`.

### Claim 2: dry-run can report completed even with failed feature results
Result: Confirmed by source and direct repro.

Evidence chain:
- Dry-run records failed features when adapter execution returns `ok: false` at `/Users/warrencain/Documents/openweft/src/orchestrator/dryRun.ts:367-387`.
- After all phases, dry-run unconditionally writes `checkpoint.status = 'completed'` at `/Users/warrencain/Documents/openweft/src/orchestrator/dryRun.ts:404-407`.
- The XState machine transitions from executing to completed on any successful return from `executePlannedFeatures()` at `/Users/warrencain/Documents/openweft/src/orchestrator/dryRun.ts:461-471`.
- The CLI reports only planned/completed counts from that result at `/Users/warrencain/Documents/openweft/src/cli/handlers.ts:2412-2421`.
- Direct probe produced `savedStatus: "completed"` and feature `001: "failed"`.
- Existing dry-run e2e coverage only checks happy path completion at `/Users/warrencain/Documents/openweft/tests/e2e/cli-dry-run.test.ts:48-83`.

### Claim 3: partial successful re-analysis updates can be lost if later reanalysis aborts before final checkpoint save
Result: Confirmed by code path; current tests cover adjacent recovery but not the exact multi-feature partial-success-then-fail case.

Evidence chain:
- `runPendingReanalysis()` loops remaining eligible features and mutates feature checkpoint state after a successful live adjustment at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:2298-2318`.
- It writes the adjusted plan file and shadow plan before updating the in-memory checkpoint at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:2309-2318`.
- The checkpoint is only saved after the whole re-analysis loop when `pendingMergeSummaries` is cleared at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:2339-2342`.
- If a later adjustment parse fails, the catch path appends audit and throws at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:2326-2335`.
- The top-level catch reloads the checkpoint from disk, marks it failed, and saves it at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3769-3787`, so earlier in-memory successful adjustment metadata can be overwritten by the older disk checkpoint.
- Existing tests prove pending merge summaries survive one adjustment failure and are replayed on restart at `/Users/warrencain/Documents/openweft/tests/orchestrator/realRun.test.ts:2641-2828`, but they do not assert that a prior successful adjustment in the same reanalysis batch is durable before a later adjustment throws.

### Claim 4: plan-score-phase-execute-merge-replan-checkpoint loop invariants
Result: Mostly valid on the happy/retry/recovery paths, with three confirmed semantic gaps above and one additional scoring feedback gap.

Invariant map:
- Documented loop: Queue -> Plan -> Score -> Phase -> Execute -> Merge -> Re-plan -> Checkpoint at `/Users/warrencain/Documents/openweft/README.md:110-120` and `/Users/warrencain/Documents/openweft/ARCHITECTURE.md:11-63`.
- Planning creates durable Work Briefs/plans with manifest and ledger expectations, matching `/Users/warrencain/Documents/openweft/README.md:124-150`.
- Score/phase uses only execution-eligible features, updates queue ordering, and groups phases by manifest overlap/hot-file isolation at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:1841-1907`, `/Users/warrencain/Documents/openweft/src/domain/phases.ts:19-67`, and `/Users/warrencain/Documents/openweft/src/domain/manifest.ts:239-244`.
- Execution uses an all-settled phase barrier at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:2830-2886`.
- Successful merges append pending merge summaries, mark features completed, and save checkpoints per merge at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3493-3515`.
- Re-analysis runs after each phase and then saves queue-management state at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3538-3577`.
- Tests confirm phase recomputation after manifest-changing re-analysis at `/Users/warrencain/Documents/openweft/tests/orchestrator/realRun.test.ts:3532-3624`.

Weak spots:
- Unresolved permanent failures are only terminal when no scores remain.
- Dry-run final status ignores failed feature states.
- Re-analysis success is not checkpointed per feature before later failures.
- `realRun.ts` passes `successPenalty` for failed rerunnable features at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:1872-1881`, but `scoreQueue()` drops that field before calling `scoreQueueFeatures()` at `/Users/warrencain/Documents/openweft/src/domain/scoring.ts:319-337`. The lower-level likelihood function supports the penalty at `/Users/warrencain/Documents/openweft/src/domain/scoring.ts:173-192`, but the wrapper omits it.

## Findings

### Finding 1
- Severity: High
- Area: Real orchestrator unresolved-failure stop semantics
- Evidence: Permanent failed features are excluded from eligibility at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:451-460`, while unresolved failures are checked only when `scores.length === 0` at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3675-3689`. Mixed-phase failures can avoid the circuit breaker because it trips only when failed ratio is greater than 0.5 at `/Users/warrencain/Documents/openweft/src/domain/errors.ts:70-76`. The architecture says the loop breaks when unresolved failures remain at `/Users/warrencain/Documents/openweft/ARCHITECTURE.md:63`.
- User impact: A run can keep spending agent turns on later queued work after a feature has permanently failed. The operator may not learn that the batch is doomed until unrelated work drains.
- Recommended fix: After each phase and before scoring the next loop, detect any `status === 'failed' && !rerunEligible` feature. Persist pending merge/reanalysis state, mark the run failed or paused, and stop before launching more work. If the desired product behavior is "continue unrelated work," update README/architecture/status wording and tests to make that contract explicit.
- Confidence: High.
- What would disconfirm: A formal product decision that permanent feature failures should not stop unrelated work, plus docs/tests that explicitly bless continuing after `failed && !rerunEligible`.

### Finding 2
- Severity: Medium
- Area: Dry-run terminal status
- Evidence: Dry-run writes per-feature failures at `/Users/warrencain/Documents/openweft/src/orchestrator/dryRun.ts:381-387`, then unconditionally marks the run completed at `/Users/warrencain/Documents/openweft/src/orchestrator/dryRun.ts:404-407`. Direct probe reproduced `savedStatus: "completed"` with feature `001: "failed"`. The current e2e dry-run test covers only all-completed output at `/Users/warrencain/Documents/openweft/tests/e2e/cli-dry-run.test.ts:59-83`.
- User impact: `openweft start --dry-run` can become a false-green preflight. A script or user can see "Dry run complete" even when zero features completed.
- Recommended fix: Derive dry-run terminal status from feature states. If any feature is `failed`, set checkpoint status to `failed`, have `runDryRunOrchestration()` reject or return failed status consistently, and update CLI output to say planned/completed/failed.
- Confidence: High.
- What would disconfirm: A documented design that dry-run intentionally means "pipeline simulation finished" rather than "feature simulation succeeded," with status output changed to avoid success wording.

### Finding 3
- Severity: Medium
- Area: Re-analysis durability and checkpoint atomicity
- Evidence: Live re-analysis can write adjusted plan files and mutate in-memory feature state at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:2309-2318`, but checkpoint persistence waits until the entire batch completes at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:2339-2342`. A later parse error throws at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:2326-2335`; the top-level catch reloads older disk state and saves that as failed at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3769-3787`.
- User impact: A restart can see adjusted plan files on disk but stale checkpoint manifest/session metadata. That weakens the recovery promise and can cause repeated or inconsistent re-analysis.
- Recommended fix: Save the checkpoint after each successful re-analysis feature update before moving to the next remaining feature. Alternatively, stage adjustment results transactionally and only promote plan/shadow files after a checkpoint save succeeds.
- Confidence: Medium-high.
- What would disconfirm: A test showing successful earlier re-analysis updates survive a later adjustment parse throw in the same batch, including checkpoint manifest/session fields and plan file consistency.

### Finding 4
- Severity: Medium
- Area: Scoring feedback for failed rerunnable features
- Evidence: `scoreAndPhaseCheckpoint()` tries to penalize failed features with `successPenalty: feature.status === 'failed' ? 0.15 : 0` at `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:1872-1881`. `calculateSuccessLikelihood()` honors `successPenalty` at `/Users/warrencain/Documents/openweft/src/domain/scoring.ts:173-192`. But `scoreQueue()` maps its inputs to `scoreQueueFeatures()` without forwarding `successPenalty` at `/Users/warrencain/Documents/openweft/src/domain/scoring.ts:319-337`. Direct probe showed `scoreQueueWithPenalty` stayed `0.95`, while direct penalized likelihood dropped to `0.8`.
- User impact: Rerunnable failed features keep their unpenalized priority, so the scheduler may keep promoting work that just failed. This can waste retry cycles and worsen the "failed feature keeps running while later work remains" behavior.
- Recommended fix: Add `successPenalty?: number` to `ScoreableFeature`, pass it through in `scoreQueue()`, and add a regression that `scoreQueue([{ successPenalty: 0.15 }])` lowers success likelihood and priority versus the same feature without penalty.
- Confidence: High.
- What would disconfirm: A deliberate decision that `successPenalty` is only for direct `scoreQueueFeatures()` callers and should not affect orchestrator scoring, followed by removal of the dead pass-through in `realRun.ts`.

## Proposed Regression Tests
- Add a real-run test with at least five non-overlapping features, `maxParallelAgents: 2`, and a feature-specific adapter failure for `001`. Assert that after `001` exhausts reruns and becomes `failed/rerunEligible: false`, no later feature begins execution unless the documented contract is changed to "continue unrelated work."
- Add a dry-run unit or e2e test using `MockAgentAdapter({ fixtures: { execution: { error: "boom" } } })`. Assert checkpoint status is `failed`, the failed feature remains failed, CLI output reports failed count, and `runDryRunOrchestration()` does not present a successful terminal state.
- Add a re-analysis durability test with three remaining overlapping features: adjustment for `002` succeeds and changes its manifest, adjustment for `003` throws due to invalid ledger. Reload checkpoint and assert `002`'s manifest/session/lastError update survived, or assert no adjusted plan file was promoted if the operation is intentionally transactional.
- Add a scoring test that calls `scoreQueue()` with and without `successPenalty` and expects a lower `successLikelihood`/priority when the penalty is present.
- Add a loop-invariant test around phase recomputation plus failure state: after a phase with one success and one rerunnable failure, pending merge summaries are replayed before the next execution, failed features carry an actual priority penalty, and terminal failed features are handled according to the chosen stop/continue contract.

## Domino Risks
- Stopping immediately on permanent failures will preserve compute but can leave unrelated queued work unrun; status/help output must explain whether the user should fix, skip, or resume.
- Continuing unrelated work may be a valid batch-throughput choice, but then docs should stop promising that unresolved failures break the loop immediately.
- Fixing dry-run status can break scripts that currently treat any completed dry-run process as green. The CLI should make the new failed count explicit.
- Per-feature re-analysis checkpoint saves increase write frequency, but the state is small and the durability gain is meaningful.
- Making `successPenalty` effective can reorder retries versus fresh planned work; that is probably desirable, but release notes should mention scheduling behavior may become less eager to retry failed work immediately.
- Re-analysis transactional fixes must keep plan files, shadow plans, checkpoint manifests, and pending merge summaries in sync. A partial fix could trade lost checkpoint updates for stale plan files instead.

###COMPLETE###
