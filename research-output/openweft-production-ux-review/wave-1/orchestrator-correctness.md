# Wave 1 Findings: orchestrator-correctness

## Scope
Production orchestration loop only: `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts`, `/Users/warrencain/Documents/openweft/src/orchestrator/dryRun.ts`, `/Users/warrencain/Documents/openweft/src/orchestrator/finalization.ts`, `/Users/warrencain/Documents/openweft/src/orchestrator/audit.ts`, `/Users/warrencain/Documents/openweft/src/orchestrator/approval.ts`, `/Users/warrencain/Documents/openweft/src/orchestrator/planMarkdown.ts`, `/Users/warrencain/Documents/openweft/src/domain/scoring.ts`, `/Users/warrencain/Documents/openweft/src/domain/phases.ts`, `/Users/warrencain/Documents/openweft/src/domain/editSummary.ts`, `/Users/warrencain/Documents/openweft/src/domain/errors.ts`, `/Users/warrencain/Documents/openweft/tests/orchestrator`, `/Users/warrencain/Documents/openweft/tests/e2e/cli-real-mock.test.ts`, `/Users/warrencain/Documents/openweft/tests/e2e/cli-dry-run.test.ts`, plus the repo docs and config surface that define the loop contract.

## Files Inspected
- `/Users/warrencain/Documents/openweft/AGENTS.md`
- `/Users/warrencain/Documents/openweft/CLAUDE.md`
- `/Users/warrencain/Documents/openweft/README.md`
- `/Users/warrencain/Documents/openweft/ARCHITECTURE.md`
- `/Users/warrencain/Documents/openweft/package.json`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/00_research_target_matrix.md`
- `/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/dryRun.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/finalization.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/approval.ts`
- `/Users/warrencain/Documents/openweft/src/orchestrator/planMarkdown.ts`
- `/Users/warrencain/Documents/openweft/src/domain/scoring.ts`
- `/Users/warrencain/Documents/openweft/src/domain/phases.ts`
- `/Users/warrencain/Documents/openweft/src/domain/editSummary.ts`
- `/Users/warrencain/Documents/openweft/src/domain/errors.ts`
- `/Users/warrencain/Documents/openweft/tests/orchestrator/planMarkdown.test.ts`
- `/Users/warrencain/Documents/openweft/tests/orchestrator/approval.test.ts`
- `/Users/warrencain/Documents/openweft/tests/orchestrator/realRun.test.ts`
- `/Users/warrencain/Documents/openweft/tests/e2e/cli-real-mock.test.ts`
- `/Users/warrencain/Documents/openweft/tests/e2e/cli-dry-run.test.ts`

## Commands Run
- `/opt/homebrew/bin/node ./node_modules/.bin/vitest run /Users/warrencain/Documents/openweft/tests/orchestrator/realRun.test.ts -t "re-analysis|merge conflict|stop|retry|resumes repo-scoped adjustment sessions|recomputes future phases after re-analysis changes a remaining manifest|replays deferred re-analysis after recovering an already-merged feature"` -> passed (`1` file, `76` tests selected/skipped, `76` passed)
- `/opt/homebrew/bin/node ./node_modules/.bin/vitest run /Users/warrencain/Documents/openweft/tests/e2e/cli-dry-run.test.ts /Users/warrencain/Documents/openweft/tests/e2e/cli-real-mock.test.ts` -> passed (`2` files, `3` tests passed)

## Findings

1. **Severity: High**
   - **Area:** Top-level stop condition in the real orchestration loop
   - **Evidence:** The architecture says the loop breaks when unresolved failures remain (`/Users/warrencain/Documents/openweft/ARCHITECTURE.md:63`, `/Users/warrencain/Documents/openweft/ARCHITECTURE.md:655-683`), but `runRealWorkflow()` only checks for unresolved failed features in the `scores.length === 0` branch (`/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3675-3689`). While any planned or rerunnable work still exists, the loop keeps planning/scoring/executing more work (`/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3616-3703`).
   - **User impact:** A permanent feature failure does not stop the run immediately. OpenWeft can keep spending compute on later queued work and only report failure after the queue drains, which makes the run look healthier than it is and delays operator attention.
   - **Recommended fix:** Short-circuit the outer loop once there is any `failed && !rerunEligible` feature, after persisting the current checkpoint and any deferred merge/reanalysis state.
   - **Confidence:** High
   - **What would disconfirm:** If the intended contract is actually "continue unrelated queued work after permanent failures" and the docs/tests are updated to say that explicitly.

2. **Severity: Medium**
   - **Area:** Dry-run terminal status reporting
   - **Evidence:** In `executePlannedFeatures()`, individual feature failures are recorded (`/Users/warrencain/Documents/openweft/src/orchestrator/dryRun.ts:367-387`), but the machine still unconditionally sets `checkpoint.status = 'completed'` after the phase loop (`/Users/warrencain/Documents/openweft/src/orchestrator/dryRun.ts:404-407`). The current e2e dry-run test only exercises the happy path (`/Users/warrencain/Documents/openweft/tests/e2e/cli-dry-run.test.ts:48-94`).
   - **User impact:** `openweft start --dry-run` can report success even when one or more mock turns failed. That makes dry-run a false-green preflight signal if users rely on it to validate the pipeline.
   - **Recommended fix:** Derive the final dry-run status from per-feature results and downgrade the checkpoint to `failed` when any feature ends in failure, or document the always-green behavior if that is intentional.
   - **Confidence:** High
   - **What would disconfirm:** A deliberate design decision that dry-run ignores feature-level failures and always reports completion, backed by docs and tests.

3. **Severity: Medium**
   - **Area:** Reanalysis durability and checkpoint persistence
   - **Evidence:** `runPendingReanalysis()` mutates feature state inside the loop but only persists the checkpoint once at the end (`/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:2175-2344`, especially `2284-2318` and `2339-2342`). If a later reanalysis turn aborts, `runRealOrchestration()` reloads from disk in the catch path (`/Users/warrencain/Documents/openweft/src/orchestrator/realRun.ts:3770-3785`), so earlier successful reanalysis updates that were still only in memory can be lost.
   - **User impact:** A mid-reanalysis abort can discard earlier successful plan adjustments from the checkpoint, even though the plan file may already have been rewritten. That makes restart/recovery less trustworthy and can force extra work on the next run.
   - **Recommended fix:** Save the checkpoint after each successful reanalysis update, or otherwise make partial reanalysis progress durable before any later turn can abort the batch.
   - **Confidence:** Medium-High
   - **What would disconfirm:** Another persistence path that restores partial per-feature reanalysis updates on abort, or an explicit transactional design that intentionally discards them.

## Backend Correctness Map
- **Plan/score/phase pipeline:** Mostly sound. The loop structure, phasing, and scoring contracts match the docs, and the focused orchestrator tests passed.
- **Approval and stop handling:** Generally correct on the exercised paths. The approval controller and stop-aware orchestration tests passed, but the unresolved-failure stop gate is still missing.
- **Recovery and resume:** Strong in the common case, including queue restoration and deferred merge replay. The weak spot is partial reanalysis durability when a later turn aborts.
- **Dry-run parity:** Not fully aligned with real-run semantics because dry-run still reports success after feature-level failures.

## Domino / Second-Order Risks
- Stopping immediately on unresolved failures will strand later queue items until the user resumes, so the UX should make the pause obvious and show what remains queued.
- Fixing dry-run to surface failures may change expectations for scripts that currently treat `--dry-run` as always-green.
- Persisting reanalysis progress incrementally adds a bit more checkpoint I/O, but it protects restart fidelity and avoids replaying stale manifests.
- If the loop starts stopping earlier on permanent failures, status output and queue retention should explain whether the run paused, failed, or left work pending.

###COMPLETE###
