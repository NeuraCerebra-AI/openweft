# Wave 3: Recovery and Planning Contract Matrix

## Scope

This Wave 3 pass resolves the product contract across the state seams validated in Wave 2:

- stopped/resume
- failed/rerunEligible
- skipped/planning-needs-review
- stale manifest fallback
- re-analysis aborts
- dry-run status
- fatal/setup failures

No source code was changed. This report uses the required docs, Wave 1/Wave 2 summaries, the four named Wave 2 validation reports, and targeted source/test-surface reads for line-level confirmation.

## Contract Position

OpenWeft's least surprising production contract should be:

1. `openweft start` is the default resume path for actionable unfinished work.
2. `stopped` means operator-paused, not permanently terminal, when planned work, pending queue entries, rerunnable failures, or pending merge summaries remain.
3. `failed && rerunEligible` is automatic recovery; `failed && !rerunEligible` is a manual-attention stop unless an explicit "continue unrelated work" product mode is added.
4. Planning format defects should become reviewable planning states, not silent consumption of queue intent.
5. A current, parseable manifest is the execution-scheduling contract. `last-known-good` is recovery evidence, not scheduling truth.
6. Re-analysis failures should localize to the affected feature/group and persist each successful adjustment before moving on.
7. Dry-run terminal status must mean what users think it means: no failed feature can coexist with "complete" success copy.
8. Setup failures must stay setup failures from subprocess runner through adapter, checkpoint, audit, status, and CLI copy.

## State Matrix

| Product state | Current behavior | Desired behavior | User-facing copy | Backend invariant | Regression tests | Second-order risks |
|---|---|---|---|---|---|---|
| `stopped` with actionable work | `loadOrCreateCheckpoint()` reopens resumable `failed` checkpoints but not `stopped` checkpoints (`src/orchestrator/realRun.ts:846-856`). If the queue has no pending lines, planning returns unchanged (`src/orchestrator/realRun.ts:1494-1500`), then the main loop returns immediately on `status === 'stopped'` (`src/orchestrator/realRun.ts:3624-3630`). Wave 2 reproduced a restart with `executionRequests: 0` and feature `001` still `planned` (`recovery-stop-checkpoint-validation.md:60-63`). | `openweft start` should resume any stopped checkpoint with actionable work. If product chooses a permanent freeze semantics, it needs a separate command/copy, but that conflicts with current README recovery language. | `Stopped by user. Planned work remains: 1 feature. Run openweft start to resume execution.` If already invoked: `Resuming stopped run: 1 planned feature will execute.` | A stopped checkpoint is actionable when pending queue entries, planned features, executing features reset to planned, `failed && rerunEligible`, or pending merge summaries exist. That predicate must be shared by orchestrator and status. | Add real-run tests for stop-after-final-planning restart and stop-during-execution restart. Add status tests for stopped + pending queue, stopped + planned actionable work, and stopped + no actionable work. | Reopening stopped checkpoints changes stop semantics for users who expected freeze-forever. Audit may contain both `run.stopped` and later `run.completed`; dashboards must treat latest terminal event as authoritative. |
| `failed && rerunEligible === true` | Execution eligibility includes `planned` and `failed && rerunEligible` (`src/orchestrator/realRun.ts:451-460`). Execution failures can schedule full reruns and announce them (`src/orchestrator/realRun.ts:2891-2933`). However, the intended retry priority penalty is passed from real-run (`src/orchestrator/realRun.ts:1872-1881`) but dropped in `scoreQueue()` (`src/domain/scoring.ts:319-337`), even though `calculateSuccessLikelihood()` honors `successPenalty` (`src/domain/scoring.ts:173-192`). | Keep this as automatic recovery. Rerunnable failure should be visible as "will retry" and should receive the configured priority penalty so a just-failed feature does not keep an inflated queue position. | `Feature 001 failed but is retryable. OpenWeft will retry from a clean worktree on the next pass.` | `failed && rerunEligible` remains execution-eligible; attempts, last error, session scope, plan file, manifest, branch/worktree cleanup, and retry penalty are persisted before the next scheduling pass. | Existing rerun tests cover success on first/second full rerun (`tests/orchestrator/realRun.test.ts` names around 2891-2998). Add scoring regression that `scoreQueue()` lowers likelihood/priority when `successPenalty` is present. | Making penalty effective can reorder retries behind fresh work. That is probably desirable, but users may notice retries happen later than before. |
| `failed && rerunEligible === false` | Terminal failures are excluded from eligibility, but the unresolved-failure check only runs when `scores.length === 0` (`src/orchestrator/realRun.ts:3675-3689`). Wave 2 confirmed other planned work can continue after a permanent failure (`orchestrator-loop-semantics-validation.md:77-88`). Architecture says the loop breaks when unresolved failures remain (`ARCHITECTURE.md:63`). | Default to manual-attention stop before launching more agent work after a non-rerunnable failure. If product wants throughput-first continuation, docs/status must say `failed` does not stop unrelated work. | `Run needs attention. Feature 001 exhausted retries and will not run again automatically. Fix, retry, or skip it before OpenWeft launches more work.` | After each phase and before next scoring/execution, any `failed && !rerunEligible` feature stops the run after preserving pending merge summaries and checkpoint state. No unrelated execution starts unless an explicit continue-unrelated policy exists. | Add real-run test with several non-overlapping features and one terminal failed feature. Assert no later feature starts after the permanent failure under the chosen default. If continuation is chosen, assert docs/status copy and test the explicit mode. | Immediate stop preserves compute and trust but reduces batch throughput. Continuing unrelated work may be valid, but only if users see the failure early and know later work is intentionally proceeding. |
| Planning repair exhaustion currently stored as `skipped` | Stage 2 gets initial output plus two repair attempts (`src/orchestrator/planMarkdown.ts:47-140`). Recoverable planning failure becomes `status: 'skipped'`, `planFile: null`, `manifest: null`, `rerunEligible: false`, and the queue line is marked processed (`src/orchestrator/realRun.ts:1699-1763`). Wave 2 notes artifacts are preserved but the request is consumed from the active path (`planning-pipeline-resilience-validation.md:100-107`). | Replace terminal planning `skipped` with a distinct review state, either schema-level `planning-needs-review` or a derived status backed by `skipped + lastError + promptBFile/shadowPlan`. `skipped` should mean intentionally not run, not "planner failed contract." | `Planning needs review for feature 001. OpenWeft preserved the Work Brief and rejected plan. Retry planning after reviewing the last validation error.` | Queue intent is not silently consumed. The original request, Work Brief path, rejected/shadow plan path, last validation error, and retryability are durable. A feature needing planning review is not execution-eligible. | Update planning failure tests that currently expect `skipped` (`tests/orchestrator/realRun.test.ts` around invalid planning and missing ledger cases). Add a retry/review command or status predicate test once UX is chosen. | Adding a new checkpoint enum is a migration surface because schemas are strict (`src/state/checkpoint.ts:10-26`, `src/state/checkpoint.ts:38-63`). A derived status avoids migration but risks another hidden semantic layer if not documented. |
| Stale `last-known-good` manifest fallback | `parseManifestJson()` returns `method: 'last-known-good'` when current manifest parsing fails and a prior manifest exists (`src/domain/manifest.ts:147-188`). `repairPlanMarkdownIfNeeded()` extracts the shadow plan manifest but returns only markdown, manifest, and session, losing recovery provenance (`src/orchestrator/planMarkdown.ts:29-59`). Re-analysis passes shadow manifest and writes normalized adjusted plans from the recovered manifest (`src/orchestrator/realRun.ts:2298-2318`). Wave 2 probe accepted malformed current manifest and reused `src/old-boundary.ts` (`planning-pipeline-resilience-validation.md:90-98`). | `last-known-good` should be a review signal, not silent scheduling truth. Executable plans require a current parseable manifest after repair, unless an explicit operator override accepts stale boundaries. | `Manifest needs review. The current plan manifest is malformed; OpenWeft found a previous manifest for inspection but will not schedule from stale boundaries without review.` | Every executable planned feature has `manifestConfidence: current` or equivalent. Fallback provenance is persisted to checkpoint/audit/status. Stale fallback cannot enter phase grouping as if it were current. | Add tests for malformed adjusted manifest with a shadow manifest. Assert the feature becomes review-needed or the run stops with explicit stale-manifest copy instead of scheduling silently. Add parser/repair tests that preserve `recoveryMethod`. | Removing silent fallback can create more visible planning stops. Keeping fallback with review markers preserves safety but requires new UI/status affordances and possibly an override workflow. |
| Re-analysis content parse abort | Re-analysis runs only for remaining features whose manifests overlap merged paths (`src/orchestrator/realRun.ts:2181-2214`). Adapter-level adjustment failures are logged and can continue (`src/orchestrator/realRun.ts:2226-2282`). But if `adjustment.ok` returns malformed markdown, `assertLedgerSection()` or manifest parse throws and fails the whole orchestration (`src/orchestrator/realRun.ts:2298-2335`, `src/orchestrator/realRun.ts:3769-3787`). Successful earlier adjustment mutations are only checkpointed after the whole loop (`src/orchestrator/realRun.ts:2339-2342`). Wave 2 bounded this as stale metadata risk rather than merged-work loss (`wave-2-intelligence-summary.md:50-55`). | Convert adjustment content parse failures into durable per-feature/group review states. Save after each successful adjustment before proceeding. Stop only when overlap uncertainty makes later scheduling unsafe; otherwise continue provably non-overlapping work. | `Re-analysis needs review for feature 002. Merged changes touched files in its manifest, but the adjusted plan was malformed. OpenWeft preserved merged work and paused affected follow-up work.` | Plan file, shadow plan, checkpoint manifest, session id, pending merge summaries, and audit decisions are committed atomically per feature. Pending merge summaries are cleared only after every affected adjustment is durably handled. | Add multi-feature re-analysis test: adjustment for `002` succeeds and changes manifest, adjustment for `003` fails parser. Reload checkpoint and assert `002` survived, `003` is review-needed, and non-overlap feature behavior follows policy. | Continuing non-overlapping work requires a trustworthy overlap predicate. Overly broad continuation can undermine safety; overly broad pausing can reduce throughput and feel like old abort behavior under a new label. |
| Dry-run terminal status | Dry-run marks individual execution failures (`src/orchestrator/dryRun.ts:367-388`) but unconditionally writes `checkpoint.status = 'completed'` after phases (`src/orchestrator/dryRun.ts:404-407`). CLI prints `Dry run complete: planned X, completed Y` without failed count (`src/cli/handlers.ts:2412-2421`). Wave 2 reproduced `savedStatus: "completed"` with feature `001: "failed"` (`orchestrator-loop-semantics-validation.md:90-99`). | Dry-run status must be aggregate-truthful: `completed` only if every planned feature completed; `failed` or `needs-review` if any feature failed or planning contract failed. If "simulation finished" is the intended meaning, copy must say that separately. | Success: `Dry run passed: planned 2, completed 2, failed 0.` Failure: `Dry run failed: planned 1, completed 0, failed 1. No source changes were applied.` | Run status derives from feature states. CLI output, checkpoint status, and `openweft status` agree. Dry-run remains mock/scratch-only and cannot imply live-provider readiness. | Add dry-run unit/e2e using `MockAgentAdapter({ fixtures: { execution: { error: "boom" } } })`. Assert checkpoint `failed`, CLI failed count, and status output. Add docs/copy test if "simulation finished" semantics are chosen. | Scripts currently treating any dry-run process success as green may break. This is a useful break, but release notes should call it out. |
| Fatal/setup failures | Runner uses `execa(..., reject:false)` and normalizes undefined exit code to `0` when no signal exists (`src/adapters/runner.ts:20-37`). Fatal classifier includes auth, command-not-found, ENOENT, disk, config, and template patterns, but not permission strings (`src/domain/errors.ts:18-31`). Agent failures trigger worktree reset/retry (`src/orchestrator/realRun.ts:2544-2567`) while fatal failures halt (`src/orchestrator/realRun.ts:2509-2520`). Wave 2 reproduced missing commands as fake zero-exit parser failures and permission strings as `agent` (`adapter-diagnostic-classification-validation.md:65-93`). | Setup failures should be fatal/preflight, not agent mistakes. Missing binary, spawn failure, permission denied, API auth, missing env vars, invalid config, and template errors should halt before worktree reset/retry. Mock adapter should also honor the adapter-result contract for malformed dry-run execution. | `Setup failed: Codex CLI could not be started. Check that codex is installed and on PATH.` `Setup failed: permission denied while accessing repo/worktree. Check file permissions or sandbox settings.` | Runner preserves spawn metadata, undefined exit, error code, and short message. Adapter failures carry setup tier and best-effort session id. Permission errors classify fatal/preflight. Mock `runTurn()` catches parse/IO errors and returns `ok:false`. | Add runner missing-command test, Codex/Claude missing-spawn tests, permission classifier tests, orchestrator "permission does not retry" test, and mock malformed execution returns `ok:false` test. | Fixing only one layer can still mislead users. Runner, adapters, classifier, orchestrator retry policy, audit, and status copy must preserve the same setup-failed semantics end to end. |

## Findings

### Finding 1: `stopped` currently means both operator pause and terminal dead-end

- Severity: P1
- Area: stop/resume recovery
- Evidence: README advertises recovery after interruptions and resume from durable artifacts (`README.md:219-236`); `openweft stop` is documented as "finish the current phase, then stop" (`README.md:273-301`). Source reopens only failed checkpoints with unfinished work (`src/orchestrator/realRun.ts:846-856`), returns unchanged when the queue has no pending lines (`src/orchestrator/realRun.ts:1494-1500`), and then returns immediately on `stopped` (`src/orchestrator/realRun.ts:3624-3630`). Wave 2 reproduced a stopped checkpoint with one planned feature and zero execution requests on restart (`recovery-stop-checkpoint-validation.md:60-63`).
- User impact: A user can safely stop after planning, run `openweft start`, and see no work execute even though a planned feature remains. That directly undermines the recovery promise.
- Recommended fix: Make `openweft start` reopen stopped checkpoints with actionable work to `in-progress` before the early return, or add an explicit frozen-run command and update all docs/copy. The lower-friction contract is resumable `stopped`.
- Confidence: High.
- What would disconfirm: A documented product decision that `stopped` is intentionally permanent, plus a visible operator path for unfreezing or discarding stopped checkpoints.

### Finding 2: Non-rerunnable feature failure has no settled product contract

- Severity: High
- Area: real orchestrator failure semantics
- Evidence: Architecture says the loop breaks when unresolved failures remain (`ARCHITECTURE.md:63`). Current code excludes terminal failed features from eligibility (`src/orchestrator/realRun.ts:451-460`) but checks unresolved failures only after there are no scores left (`src/orchestrator/realRun.ts:3675-3689`). Wave 2 confirmed later work can continue while a permanent failure exists (`orchestrator-loop-semantics-validation.md:77-88`).
- User impact: OpenWeft may spend additional agent turns after a feature is already permanently failed, while the operator expects a manual-attention stop.
- Recommended fix: Choose and encode the default. For production trust, stop after each phase if any `failed && !rerunEligible` feature exists. If throughput-first continuation is preferred, make it explicit in docs, status, and tests.
- Confidence: High.
- What would disconfirm: A formal product policy and regression tests proving continuation after terminal feature failure is intentional and clearly surfaced.

### Finding 3: Retryable failure works, but retry scoring feedback is disconnected

- Severity: Medium
- Area: failed/rerunEligible scheduling
- Evidence: Rerunnable failures are execution-eligible (`src/orchestrator/realRun.ts:451-460`) and full reruns are scheduled/announced (`src/orchestrator/realRun.ts:2916-2933`). Real-run passes `successPenalty` for failed features (`src/orchestrator/realRun.ts:1872-1881`), and the scoring primitive honors it (`src/domain/scoring.ts:173-192`), but `scoreQueue()` drops it when mapping into `scoreQueueFeatures()` (`src/domain/scoring.ts:319-337`). Wave 2 probe reproduced no priority effect (`orchestrator-loop-semantics-validation.md:62-70`).
- User impact: Failed work can keep an artificially high retry priority, causing wasted retries or poor ordering after a failure.
- Recommended fix: Add `successPenalty` to the score wrapper input path and test that failed rerunnable features rank lower than equivalent fresh planned features.
- Confidence: High.
- What would disconfirm: A deliberate decision that retry penalties should not affect orchestrator queue scoring, followed by removing the unused real-run pass-through.

### Finding 4: Planning repair exhaustion is mislabeled as `skipped`

- Severity: Medium-high
- Area: planning pipeline recovery UX
- Evidence: After repair exhaustion, runtime writes `status: 'skipped'`, null plan/manifest, `rerunEligible: false`, and marks the queue line processed (`src/orchestrator/realRun.ts:1699-1763`). The strict checkpoint enum has only `pending`, `planned`, `executing`, `completed`, `failed`, and `skipped` (`src/state/checkpoint.ts:10-17`). Wave 2 confirmed useful artifacts may be preserved but the default operator path is not retry (`planning-pipeline-resilience-validation.md:100-107`).
- User impact: A user request can leave the active pipeline because the model missed a formatting contract. The word `skipped` sounds intentional, not "needs review."
- Recommended fix: Add or derive `planning-needs-review`, preserve retryability and artifact paths, and surface exact next action. Reserve `skipped` for intentional no-op/user skip semantics.
- Confidence: High.
- What would disconfirm: User research or telemetry showing operators consistently understand current `skipped` planning failures and requeue them without lost intent.

### Finding 5: Stale manifest fallback violates the scheduling safety story when silent

- Severity: High
- Area: manifest fallback / phase safety
- Evidence: Manifest parser can fall back to `last-known-good` (`src/domain/manifest.ts:181-185`); repair returns only normalized markdown/manifest/session, not recovery provenance (`src/orchestrator/planMarkdown.ts:52-59`); re-analysis can normalize and persist an adjusted plan using the shadow manifest (`src/orchestrator/realRun.ts:2298-2318`). Wave 2's probe accepted malformed current manifest and reused an old boundary (`planning-pipeline-resilience-validation.md:90-98`).
- User impact: The scheduler can reason from stale file boundaries, weakening the claim that manifest overlap prevents unsafe parallel work.
- Recommended fix: Preserve manifest parse method through repair/re-analysis, audit it, and treat `last-known-good` as review-required unless an explicit operator override permits stale-boundary scheduling.
- Confidence: High.
- What would disconfirm: Replay evidence showing every fallback occurs only when current plan intent is otherwise unchanged and stale manifest paths match actual intended/current edits.

### Finding 6: Re-analysis parse failures are too global and not durable enough per feature

- Severity: Medium-high
- Area: post-merge re-analysis
- Evidence: Re-analysis correctly filters to overlap (`src/orchestrator/realRun.ts:2181-2214`). Adapter-level failures are per-feature and continue (`src/orchestrator/realRun.ts:2226-2282`), but successful adapter output with bad ledger/manifest throws (`src/orchestrator/realRun.ts:2298-2335`) and the top-level catch marks the run failed after loading older checkpoint state (`src/orchestrator/realRun.ts:3769-3787`). Per-feature success is checkpointed only after the whole re-analysis loop (`src/orchestrator/realRun.ts:2339-2342`). Wave 2 narrowed this to stale metadata risk, not merged-work loss (`wave-2-intelligence-summary.md:50-55`).
- User impact: One malformed adjusted plan can fail the whole run after successful merges and can leave plan files, shadow plans, and checkpoint metadata out of sync on resume.
- Recommended fix: Persist each successful re-analysis update before the next feature. Convert parse failures into `adjustment-needs-review` for the affected overlapping feature/group, preserving pending merge summaries until review is resolved.
- Confidence: High for current behavior; medium-high for exact continuation policy.
- What would disconfirm: A regression test proving earlier successful adjustment checkpoint metadata survives a later parse throw in the same batch, or a deliberate safety policy that any adjustment parse failure must stop all later work with clear status copy.

### Finding 7: Dry-run can be false green

- Severity: Medium
- Area: dry-run status contract
- Evidence: Dry-run records failed feature states (`src/orchestrator/dryRun.ts:367-388`) but then unconditionally sets run status to `completed` (`src/orchestrator/dryRun.ts:404-407`). CLI prints "Dry run complete" with planned/completed counts only (`src/cli/handlers.ts:2412-2421`). Wave 2 reproduced completed checkpoint with feature `001` failed (`orchestrator-loop-semantics-validation.md:90-99`).
- User impact: A user or script can treat dry-run as green even when feature simulation failed.
- Recommended fix: Derive dry-run status and CLI copy from aggregate feature states. Include failed count. If "simulation finished" is the intended status, rename the copy so it does not imply success.
- Confidence: High.
- What would disconfirm: A documented dry-run definition that "completed" means only "the simulator finished," plus user-facing copy that clearly distinguishes simulator completion from feature success.

### Finding 8: Setup failures can masquerade as agent/content failures

- Severity: High
- Area: adapter diagnostics / fatal setup classification
- Evidence: Runner maps undefined exit code to `0` in some spawn-failure cases (`src/adapters/runner.ts:20-37`). Fatal patterns omit permission strings (`src/domain/errors.ts:18-31`). Agent failures reset/retry worktrees (`src/orchestrator/realRun.ts:2544-2567`) while fatal failures halt (`src/orchestrator/realRun.ts:2509-2520`). Wave 2 reproduced missing backend commands as fake zero-exit parser failures and permission variants as `agent` (`adapter-diagnostic-classification-validation.md:65-93`).
- User impact: Missing CLI binaries, PATH problems, or permission denials can look like model-output failures. Users waste retries instead of fixing local setup.
- Recommended fix: Preserve spawn metadata in runner results, classify missing command/undefined exit/permission denied as setup-fatal, and make adapters emit direct setup copy. Also catch mock parse/IO errors into `ok:false` so dry-run follows the same contract.
- Confidence: High.
- What would disconfirm: Current dependency behavior changing so spawn failures always produce nonzero exit and meaningful stderr before adapter parsing, plus tests proving permission denials are rewritten before retry policy sees them.

### Finding 9: First checkpoint backup is not seeded

- Severity: P2
- Area: checkpoint durability
- Evidence: `saveCheckpoint()` only writes backup when a previous primary exists (`src/state/checkpoint.ts:267-284`), while README says checkpoint has a `.backup` fallback and load prefers primary then backup (`README.md:223-235`). Wave 2 probe showed `backupExistsAfterFirstSave: false` (`recovery-stop-checkpoint-validation.md:64-67`).
- User impact: The first recoverable checkpoint has no backup redundancy. If it is corrupted, recovery fails at the earliest durable state.
- Recommended fix: On first save, seed backup with the same validated checkpoint. Later saves can keep previous-snapshot semantics, but status copy should make first-save mirror vs previous snapshot clear.
- Confidence: High.
- What would disconfirm: A documented contract that first-save backup absence is intentional, with README/status avoiding any implication that the first checkpoint has a fallback.

## Proposed Regression Plan

1. `tests/orchestrator/realRun.test.ts`: stopped after final planning with no pending queue restarts and executes planned work.
2. `tests/orchestrator/realRun.test.ts`: stopped during execution resets eligible work to planned and restart executes, not immediate `stopped`.
3. `tests/status/renderStatus.test.ts`: stopped-state recovery line for pending queue, planned actionable work, rerunnable failure, pending merge summaries, and no actionable work.
4. `tests/orchestrator/realRun.test.ts`: terminal `failed && !rerunEligible` stops before unrelated later execution under default contract.
5. `tests/domain/scoring.test.ts`: `scoreQueue()` forwards `successPenalty`.
6. `tests/orchestrator/realRun.test.ts`: planning repair exhaustion becomes `planning-needs-review` or derived review state, not silent non-rerunnable skip.
7. `tests/domain/manifest.test.ts` and `tests/orchestrator/planMarkdown.test.ts`: `last-known-good` provenance is returned and preserved.
8. `tests/orchestrator/realRun.test.ts`: malformed adjusted manifest with shadow manifest cannot silently schedule stale boundaries.
9. `tests/orchestrator/realRun.test.ts`: multi-feature re-analysis saves successful feature adjustment before a later adjustment parse failure.
10. `tests/e2e/cli-dry-run.test.ts`: failed mock execution produces failed dry-run status and failed-count CLI copy.
11. `tests/adapters/runner.test.ts`: missing command/spawn failure is nonzero or setup-fatal with actionable message.
12. `tests/domain/errors.test.ts`: `Permission denied`, `EACCES`, `EPERM`, and `Operation not permitted` classify setup-fatal.
13. `tests/orchestrator/realRun.test.ts`: permission/setup failure does not enter agent retry or full-rerun path.
14. `tests/adapters/mock.test.ts`: malformed execution prompt resolves `ok:false` instead of throwing.
15. `tests/state/checkpoint.test.ts`: first `saveCheckpoint()` writes both primary and backup and can load backup if primary corrupts.

## Release Readiness Implication

This matrix supports a "near-ready, not broad-production-ready" verdict until the P1/high contract mismatches are fixed or explicitly documented:

- Stop/resume dead-end is a release blocker for a recovery product.
- Silent stale-manifest scheduling is a release blocker for a manifest-driven scheduler.
- Fatal/setup misclassification is a release blocker for first-run/operator trust.
- Dry-run false green is a confidence blocker for release rehearsal.
- Planning `skipped` and re-analysis abort semantics are high-priority UX/recovery blockers unless intentionally reframed with status and retry workflows.

###COMPLETE###
