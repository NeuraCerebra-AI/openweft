# Wave 3 Release Blocker Triage

## Scope

This is the final Wave 3 synthesis for the OpenWeft production-readiness and terminal UX review. It converts the Wave 2 validation reports into a ranked release-blocker and confidence-gap triage.

Evidence base read before synthesis:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `ARCHITECTURE.md`
- `package.json`
- `research-output/openweft-production-ux-review/wave-1-intelligence-summary.md`
- `research-output/openweft-production-ux-review/wave-2-intelligence-summary.md`
- all seven Wave 2 reports under `research-output/openweft-production-ux-review/wave-2/`

No source code was changed for this pass. This report is the only intended write.

## Final Verdict

Verdict: **near-ready, not production-ready for broad live-provider release yet**.

OpenWeft is a credible release candidate for repo/package quality: Wave 2 validated `release:check` through typecheck, 824 Vitest tests, build, packaged CLI smoke, and npm dry-run. The architecture, test suite, and common-path git/recovery coverage are strong enough that this is not a "not ready" codebase.

It is not fully production-ready because several P1 issues still affect the product's core promise: resumable fire-and-forget execution, safe manifest-driven scheduling, correct environment failure diagnosis, and dirty-tree/user-change protection. Current live Codex/Claude behavior is also unverified-current, so a real-provider-ready release claim needs an explicit live-smoke gate.

No P0 was found. The release decision should be:

- Package/internal RC: acceptable after `release:check`, with explicit caveats.
- Public/broad production claim: block until Phase 1 and Phase 2 below are fixed and verified.
- Codex-ready claim: block until current `smoke:live:codex:resume` evidence is recorded.
- Claude-ready claim: block until current `smoke:live:claude` evidence is recorded.

## Severity And Classification Key

- P0: do not ship any release artifact.
- P1: blocks broad production/live-provider readiness.
- P2: blocks polished 1.0/operator-trust readiness, but can ship only with explicit caveat or policy.
- P3: hardening/documentation item.

Classifications used below: code blocker, UX blocker, release-policy gate, confidence gap.

## Top 10 Blockers And Confidence Gaps

### 1. Stopped checkpoints can strand planned work

- Severity: P1
- Area: orchestrator stop/resume recovery
- Classification: code blocker, UX blocker
- Evidence: Wave 2 reproduced a stopped run with one planned feature, empty pending queue, zero execution requests on restart, and unchanged `stopped` status. Source evidence shows failed checkpoints can reopen, but stopped checkpoints are not reactivated, and the main loop returns early when checkpoint status is `stopped`.
- User impact: A user can stop safely after planning or during execution, then run `openweft start` expecting recovery. Instead, OpenWeft exits without executing already-planned work. This directly violates the mental model created by "start resumes" and weakens the recovery promise.
- Recommended fix: Define stopped resume semantics explicitly. Given current docs and UX, reopen `stopped` checkpoints when execution-eligible features, pending merge summaries, or pending queue items exist. If the product instead wants stopped to mean frozen forever, add a first-class unfreeze/resume command and status copy before returning.
- Confidence: High
- What would disconfirm: A documented product decision that `stopped` is intentionally terminal, plus a supported operator path to unfreeze or clear the checkpoint.

### 2. Silent `last-known-good` manifest fallback can schedule from stale file boundaries

- Severity: P1
- Area: planning manifest safety and phasing
- Classification: code blocker
- Evidence: Wave 2 confirmed malformed current manifests can fall back to a prior shadow-plan manifest via `last-known-good`; the recovery method is then discarded by repair/re-analysis return shapes. A probe accepted a malformed adjusted manifest and reused `src/old-boundary.ts`.
- User impact: Manifest overlap is OpenWeft's safety core. If stale file boundaries are silently accepted, two features can be scheduled as non-conflicting even though the current plan intended different files.
- Recommended fix: Treat `last-known-good` as a recovery signal, not a final scheduling truth. Preserve manifest recovery provenance in checkpoint/audit metadata. Require a current parseable manifest after repair for normal execution, or mark the feature `needs-review`/`manifestConfidence: stale` and stop it from parallel scheduling until an operator explicitly accepts the stale boundary.
- Confidence: High
- What would disconfirm: Replay/telemetry showing every fallback occurs only when current plan intent is unchanged and the prior manifest still exactly matches intended file boundaries.

### 3. Backend setup and permission failures masquerade as agent/content failures

- Severity: P1
- Area: adapter runner, error taxonomy, retry policy
- Classification: code blocker, UX blocker
- Evidence: Wave 2 probes showed a missing command returning `exitCode: 0`, missing `PATH` making Codex/Claude adapters report parser/content failures, and `Permission denied`, `EACCES`, `EPERM`, and `Operation not permitted` classifying as agent failures. These paths then enter retry/reset behavior instead of setup/preflight failure handling.
- User impact: Missing binaries, sandbox denials, filesystem permissions, or auth/access failures can look like malformed model output. Users waste retries and inspect the wrong layer.
- Recommended fix: Preserve spawn failure metadata from the runner, treat undefined/missing-command exit as nonzero setup failure, add permission/access patterns to fatal or preflight classification, and surface next-action copy such as "install/login/fix permissions before retrying." Keep session extraction on failure so recoverable provider failures can resume when a session handle exists.
- Confidence: High
- What would disconfirm: Current dependency/runtime behavior changing so missing commands always return nonzero with clear stderr before adapter parsing, and permission errors being rewritten before shared classification.

### 4. Conflict-path auto-stash restore failure is downgraded to ordinary merge conflict

- Severity: P1
- Area: dirty-tree merge safety and user-change preservation
- Classification: code blocker
- Evidence: Wave 2 found clean merge auto-stash restore failures throw a typed restore error, but merge-conflict paths return `status: "conflict"` even when `autoStash.restored === false`. The orchestrator then proceeds toward ordinary conflict resolution without inspecting that failed restore state.
- User impact: OpenWeft can ask an agent to resolve a feature conflict while the base repository also contains a failed restoration of the user's pre-existing uncommitted work. That risks confusing or damaging operator changes.
- Recommended fix: Add a distinct restore-failure result or typed error for conflict-path stash restore failure. Stop normal conflict resolution, preserve the stash recovery message, mark the run blocked/failed at the restore stage, and tell the operator how to recover before agent conflict resolution continues.
- Confidence: High
- What would disconfirm: Caller-side handling that already checks conflict results for `autoStash.restored === false` before launching conflict resolution. Wave 2 found none.

### 5. Startup prune ignores retained branch names

- Severity: P1
- Area: git cleanup and resume safety
- Classification: code blocker
- Evidence: Wave 2 confirmed `retainedBranchNames` are computed and passed into orphan pruning, but pruning only honors retained worktree paths. A temp-repo probe showed a branch retained only by name was deleted.
- User impact: Startup cleanup can delete the only easy branch pointer to completed-but-unmerged work when checkpoint path data is stale or absent. The system may force rerun or manual recovery instead of reusing a valid completion commit.
- Recommended fix: Include branch-name retention in the prune predicate. Add audit events for branch-retained/path-missing cases. Define branch-only recovery: inspect branch HEAD for an `openweft: complete feature <id>` commit before rerun, or explicitly expire/delete it with a clear audit reason.
- Confidence: High
- What would disconfirm: A proven invariant that every actionable checkpoint feature with a branch name always has a correct retained worktree path, making branch-only retention intentionally dead API.

### 6. Live-provider readiness is not current-validated by the release gate

- Severity: P1
- Area: release policy and provider validation
- Classification: release-policy gate, confidence gap
- Evidence: Wave 2 ran/inspected `release:check` and found it covers typecheck, tests, build, packaged CLI smoke, and npm dry-run. Live Codex/Claude scripts exist but are not part of `release:check` or CI. Historical Codex resume-smoke context exists, but no current live Codex or Claude smoke was run in Wave 2.
- User impact: A release can be package-valid but fail first real provider execution due to CLI auth drift, output schema drift, session/resume behavior, rate limits, or backend-specific command differences.
- Recommended fix: Keep `release:check` as the automated package gate. Add a release SOP requiring current live smoke before any real-provider-ready claim: `smoke:live:codex:resume` for Codex readiness, `smoke:live:claude` for Claude readiness, and both for both-backend claims. Record command, date/time, backend, timeout, checkpoint status, created content, and temp repo disposition.
- Confidence: High for gate absence, medium-high for provider gap severity
- What would disconfirm: An external release SOP from the same release window that already requires and records current live smoke results before publish/announcement.

### 7. Re-analysis and checkpoint durability still have single-write windows

- Severity: P2
- Area: checkpoint durability and post-merge re-analysis
- Classification: code blocker, confidence gap
- Evidence: Wave 2 confirmed re-analysis can write adjusted plan/shadow files and mutate in-memory feature state before the checkpoint is saved. A later adjustment parse error can reload older disk state and leave checkpoint metadata stale relative to plan files. Separately, the first checkpoint save does not seed `.backup`, so the earliest recoverable state has no fallback.
- User impact: A restart after a malformed adjustment or first-checkpoint corruption can see inconsistent recovery state. Merged work is not lost, but the recovery story becomes harder to trust and can repeat malformed adjustment loops.
- Recommended fix: Save checkpoint after each successful re-analysis feature update, or stage adjustment results transactionally and promote plan files only after checkpoint persistence succeeds. Seed the backup on first checkpoint save, with status wording that explains first-save mirror versus previous-snapshot semantics.
- Confidence: Medium-high
- What would disconfirm: A regression test proving earlier successful re-analysis updates survive later adjustment parse failure in both checkpoint metadata and plan files, plus a documented decision that first-save backup absence is intentional.

### 8. Ledger strictness and planning repair exhaustion consume user requests too aggressively

- Severity: P2
- Area: planning contract, ledger UX, queue semantics
- Classification: code blocker, UX blocker
- Evidence: Wave 2 confirmed the parser requires exact `## Ledger` plus exact h3 headings in one section, while prompt/work-protocol guidance says protocol-format imperfections should not abandon actionable work. After repair exhaustion, planning errors mark the feature `skipped`, non-rerunnable, and the queue item processed.
- User impact: One malformed model response can remove a user request from the active pipeline even when enough content exists for review or manual repair. The artifact remains, but the default operator path no longer says "retry this feature."
- Recommended fix: Split planning validation into hard gates, repairable gates, and review-required gates. Keep current parseable manifest and safe paths as hard gates. Normalize or synthesize ledger anchors when semantic content exists. Replace terminal `skipped` with `planning-needs-review` or `blocked-planning-contract`, keep the request retryable, and surface the rejected shadow plan path plus retry action.
- Confidence: High
- What would disconfirm: A product decision that exact parser-compatible ledger anchors are intentionally a hard safety gate, plus removal of contradictory "no protocol-only failure" prompt language.

### 9. Terminal health semantics can overstate run success

- Severity: P2
- Area: real/dry orchestrator terminal state and scheduling feedback
- Classification: code blocker, confidence gap
- Evidence: Wave 2 confirmed dry-run can save and return `completed` while a feature is `failed`. It also confirmed permanent non-rerunnable failures are only checked when no eligible scores remain, despite architecture language saying unresolved failures break the loop. A scoring probe showed `successPenalty` is dropped by the wrapper before reaching lower-level scoring.
- User impact: Dry-run can be false green, real runs can continue after a terminal feature failure without an explicit product contract, and failed rerunnable work can keep unpenalized priority. Operators get a healthier signal than the underlying feature state deserves.
- Recommended fix: Derive dry-run terminal status from feature states and show failed counts. Choose and document the permanent-failure contract: stop immediately for trust, or continue unrelated work for throughput with explicit status copy. Pass `successPenalty` through `scoreQueue()` and test retry priority ordering.
- Confidence: High
- What would disconfirm: A documented design that dry-run "completed" means only "simulation process finished", not feature success, plus CLI/status copy that makes that distinction unmistakable.

### 10. Terminal diagnostics expose facts without enough progressive next-action guidance

- Severity: P2
- Area: terminal UX, CLI status, help, history, onboarding
- Classification: UX blocker
- Evidence: Wave 2 confirmed `StatusBar` and `MeterBar` repeat phase/tokens/time, help/footer teach shortcuts rather than operational meaning, history/detail screens preserve only ID/request/commit, background output omits `.openweft/output.log`, status lacks clear stopped/resumable guidance, and onboarding lacks auth-mode plus final preflight clarity.
- User impact: OpenWeft exposes valuable recovery facts, but operators must infer what happened, what it means, and what safe action comes next. This makes the P1/P2 backend issues harder to diagnose and makes a powerful terminal product feel more brittle than it is.
- Recommended fix: Add a shared `diagnosticSummary + meaning + nextAction + details` model for CLI and TUI. Collapse duplicate telemetry into one health strip. Add state-specific help/status lines for stopped, failed, background, resumable, durability, auth, and permission states. Enrich history/detail with optional outcome metadata and add onboarding auth/preflight clarity.
- Confidence: High for source/static-render evidence; medium-high without real terminal screenshot suite
- What would disconfirm: Constrained real-terminal screenshots or user testing showing current duplicate telemetry and shortcut-only guidance remain clear at 80x24 and narrow widths.

## Minimal Implementation Phase Order

### Phase 1: Core safety blockers

Fix first because these protect user work and core orchestration truth.

Scope:

- Finding 1: stopped checkpoint resume semantics.
- Finding 2: silent stale manifest fallback.
- Finding 3: missing-command/permission classification and failure-session preservation.
- Finding 4: conflict-path auto-stash restore escalation.
- Finding 5: retained branch-name pruning.
- Finding 7 first-save checkpoint backup seeding.

Test additions:

- Orchestrator restart test: stop after final planning item, restart, assert planned execution runs.
- Orchestrator restart test: stop during execution, assert execution resets to planned and restarts.
- Manifest test: malformed current manifest with shadow manifest must not silently schedule without stale/review marker.
- Adapter runner tests: missing command produces nonzero/fatal/preflight setup failure with actionable message.
- Error classifier tests: permission variants classify as fatal/preflight/setup.
- Codex/Claude tests: failure stdout/stderr with session/thread IDs returns failure with preserved session ID.
- Git test: branch-only retained feature is not pruned before recovery policy.
- Git/orchestrator test: conflict plus failed auto-stash restore does not start conflict-resolution adapter turn.
- Checkpoint test: first `saveCheckpoint()` writes a loadable backup.

### Phase 2: Planning, re-analysis, and run-health semantics

Fix second because these convert remaining brittle contracts into explicit operator states.

Scope:

- Finding 7 re-analysis per-feature persistence or transactionality.
- Finding 8 ledger normalization and `planning-needs-review`.
- Finding 9 dry-run failed status, permanent-failure contract, and `successPenalty`.
- Prompt contract centralization for parser-facing manifest/ledger requirements.

Test additions:

- Re-analysis test: feature `002` adjustment succeeds, feature `003` adjustment parse fails, and `002` remains durable in checkpoint and plan state.
- Re-analysis policy test: parse failure localizes to affected overlapping feature/group or intentionally stops with clear safety status.
- Ledger normalization tests: accepted case/spacing/split forms if tolerant mode is chosen.
- Planning exhaustion test: malformed plan becomes `planning-needs-review`, remains retryable, and status shows rejected artifact path.
- Dry-run failure test: mock execution failure yields checkpoint/run status `failed` and CLI failed count.
- Permanent-failure contract test: after terminal feature failure, no later execution starts unless the chosen policy explicitly allows it.
- Scoring test: `scoreQueue()` with `successPenalty` lowers success likelihood/priority.
- Prompt-contract tests: Stage 2, repair, adjustment, docs/default templates share one minimal machine-contract block or generated constant.

### Phase 3: Release confidence gates

Fix third because policy can be added without altering core logic, but it must be in place before any public readiness claim.

Scope:

- Finding 6 live-provider SOP.
- Optional packaged installed CLI dry-run smoke.
- npm version reproducibility hardening.

Test additions:

- Release-readiness test: `release:check` remains package-only and does not imply live-provider readiness.
- Script/readiness test: release checklist names Codex resume smoke and Claude smoke as separate gates.
- Packaged CLI smoke extension: installed tarball runs `init`, `add`, and `start --dry-run` in a temp repo.
- CI/release test or docs check: Node `>=24` and npm `11.6.0` are asserted or Corepack-activated.

Manual validation gates:

- `npm run release:check`
- `OPENWEFT_LIVE_SMOKE_TIMEOUT_MS=<timeout> npm run smoke:live:codex:resume`
- `npm run smoke:live:claude`

### Phase 4: Progressive terminal UX

Fix fourth because it reduces operator confusion and makes the safety fixes visible.

Scope:

- Finding 10 progressive diagnostics and next-action model.
- Copy-only quick wins for status, background, stop, help, footer, model menu, completion/failure screens.
- Dashboard compaction and history/detail enrichment.
- Onboarding auth-mode and final preflight clarity.

Test additions:

- Shared diagnostic helper tests for stopped, failed, paused, background, resumable, durability, auth, permission, and completed states.
- Non-TTY `status` tests for stopped plus pending queue, stopped plus planned work, and stopped plus no actionable work.
- TUI/status-card snapshots for the same recovery states.
- UI test: default dashboard has one telemetry source, not duplicate phase/token/time rows.
- Help/footer tests: current-state meaning plus next safe action appears for running/stopped/failed states.
- History/detail tests: durability, cleanup, last error, timestamp, and next action render when available.
- Onboarding tests: auth method selection, env var copy, missing Git install/restart copy, and final preflight checklist.

### Phase 5: Final release verification

Run after implementation, before claiming production readiness.

Required checks:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run release:check`
- Targeted tests added in Phases 1-4
- Packaged installed CLI dry-run smoke if added
- Current live smoke for every backend named in the release claim
- Real terminal or snapshot checks at 80x24 and at least one narrower width

## Domino Risks Of Fixing Each Class

### Recovery and checkpoint fixes

- Reopening stopped checkpoints can surprise users who expected `stop` to freeze forever. Mitigation: status/help copy should say whether `start` resumes or a separate command is needed.
- Reopening must avoid duplicate planning. Mitigation: derive actionable work from processed queue IDs and checkpoint feature state, not from raw queue text alone.
- More checkpoint saves during re-analysis increase write frequency. Mitigation: state is small, and durability is worth the cost.
- First-save backup mirroring changes the meaning of "backup." Mitigation: status can say "first-save mirror or previous snapshot."

### Manifest, ledger, and planning-contract fixes

- Removing silent stale fallback can reduce throughput because more plans become review-required. Mitigation: make the review state actionable and retryable.
- Loosening ledger validation too broadly can weaken inspectability. Mitigation: keep manifest/path safety strict; only normalize ledger presentation when semantic sections are recoverable.
- Centralizing prompt contracts can make prompts feel less rich if over-pruned. Mitigation: separate the short machine contract from longer Work Brief guidance.
- Localizing adjustment failures can allow unrelated work to continue while one overlapping feature is uncertain. Mitigation: only continue when non-overlap is provable from current safe manifests.

### Adapter and diagnostic-classification fixes

- Classifying permission/setup errors as fatal can stop some transient failures that might have succeeded on retry. Mitigation: use specific patterns and a preflight/setup tier with clear recovery copy.
- Preserving provider session IDs on failure can reuse a session that providers consider invalid. Mitigation: attempt reuse only for classified recoverable failures and fall back cleanly.
- Changing runner spawn semantics can affect tests relying on old parser-failure paths. Mitigation: update tests to assert user-facing setup diagnosis.

### Git and dirty-tree fixes

- Retaining branches by name can leave stale branch clutter. Mitigation: add branch-retention audit events, expiration policy, and explicit branch-head reuse/delete decisions.
- Branch retention can cause branch-name collisions on rerun. Mitigation: inspect and reuse/rename/delete before creating a replacement branch.
- Escalating auto-stash restore failures will stop more runs. Mitigation: preserve exact stash recovery instructions and feature branch/worktree state so the operator can recover safely.
- Treating user-change restore as agent-resolvable can cause loss; treating it as fatal can feel conservative. The safer default is fatal/blocking with explicit recovery instructions.

### Run-health and dry-run fixes

- Stricter dry-run status can break scripts that currently treat process completion as success. Mitigation: return explicit failed counts and document the changed meaning.
- Stopping on permanent failures protects trust but leaves unrelated work unrun. Mitigation: choose a product contract and encode it in docs, status, and tests.
- Making `successPenalty` effective can reorder retries versus fresh work. Mitigation: this is probably desirable, but release notes should mention scheduling behavior changed.

### Release-policy fixes

- Live smoke gates require credentials and time, so they can slow publishing. Mitigation: keep them separate from package gate and require them only for real-provider-ready claims.
- A Codex live pass can falsely imply Claude readiness. Mitigation: backend-specific release labels and evidence.
- Historical live smoke evidence can create stale-proof risk. Mitigation: evidence must be tied to the release window.
- Packaged dry-run smoke can expose tarball-only issues late. Mitigation: run it before publish, not after release notes are written.

### Terminal UX fixes

- Overcompaction can hide trust-building diagnostics. Mitigation: collapse default chrome, not data; keep details one key away and keep `openweft status` rich.
- Next-action copy can become unsafe if generic. Mitigation: derive copy from the same state predicates the orchestrator uses.
- CLI and TUI copy can drift. Mitigation: shared diagnostics helper and renderer tests.
- `resume` alias can imply new semantics. Mitigation: make it an alias first, and explain it uses the same checkpoint path as `start`.
- History enrichment can pressure checkpoint compatibility. Mitigation: use optional derived fields.

## Release Readiness Decision Matrix

| Release claim | Current status | Required before claim |
|---|---|---|
| Package/repo RC | Green-ish | `release:check` remains green; note known P1/P2 caveats. |
| Broad production-ready | Blocked | Fix Phase 1 and Phase 2, then run full verification. |
| Codex-ready | Blocked by confidence gap | Current `smoke:live:codex:resume` evidence. |
| Claude-ready | Blocked by confidence gap | Current `smoke:live:claude` evidence. |
| Both-backend ready | Blocked by confidence gap | Current Codex resume smoke and Claude smoke in same release window. |
| Polished terminal UX | Blocked | Phase 4 progressive diagnostics and snapshot coverage. |

## Bottom Line

OpenWeft's architecture and release automation are substantially better than a prototype, but the remaining blockers sit exactly where production users will feel pain: stop/resume, manifest safety, setup diagnosis, dirty-tree protection, and release claims about real provider behavior.

The shortest safe path is not a broad refactor. It is a four-part tightening pass: fix the P1 safety semantics, make brittle planning states explicit and retryable, separate package validation from live-provider validation, then add progressive next-action UX so operators can recover without guessing.

###COMPLETE###
