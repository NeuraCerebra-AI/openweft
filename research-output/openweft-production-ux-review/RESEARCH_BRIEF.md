# OpenWeft Production Readiness And Terminal UX Research Brief
Date: 2026-06-10

## Executive Verdict

**Verdict: near-ready, not production-ready for broad live-provider release yet.**

OpenWeft is well past prototype quality. The local package gate is strong: typecheck, tests, build, packaged CLI smoke, and npm dry-run all passed. The architecture has real evidence of careful design around Work Briefs, manifests, phases, git worktrees, checkpoints, audit trails, and release packaging.

The blocker is not general code quality. The blocker is that several remaining edge cases sit exactly on the product promise: fire-and-forget orchestration, safe manifest-driven scheduling, recoverable checkpoints, protected user changes, and clear terminal recovery guidance. A real user can run OpenWeft, but in important stopped, failed, setup, stale-manifest, and dirty-tree states they may not understand what happened or what the next safe action is.

**Release interpretation:**

- Package/internal release candidate: acceptable with caveats after `npm run release:check`.
- Broad production/live-provider claim: blocked until P1 recovery/safety fixes are verified.
- Codex-ready claim: blocked until current `npm run smoke:live:codex:resume` evidence is recorded.
- Claude-ready claim: blocked until current `npm run smoke:live:claude` evidence is recorded.

## Evidence Base

This was a three-wave review with 12 Wave 1 agents, 7 Wave 2 agents, and 3 Wave 3 gap-fill agents. The review used local source inspection, focused tests, targeted runtime probes, release-gate execution, and multi-wave synthesis. No source code was changed.

Main validation completed:

- `npm run typecheck` passed.
- `npm test` passed: 74 files, 824 tests.
- `npm run build` passed.
- `npm run release:check` passed through typecheck, tests, build, packaged CLI smoke, npm dry-run, and `prepublishOnly`.
- Targeted surface sweep passed: 64 files, 756 tests across CLI, UI, orchestrator, git, state, adapters, status, release, e2e, config, manifest, phases, and scoring.

Live smokes were intentionally not run because live provider access was not explicitly authorized during this review:

- `npm run smoke:live:codex` not run.
- `npm run smoke:live:codex:resume` not run.
- `npm run smoke:live:claude` not run.

## Top 10 Release Blockers And Confidence Gaps

### 1. Stopped checkpoints can strand planned work

- **Severity:** P1
- **Area:** recovery, backend, UX
- **Evidence:** Wave 2 reproduced a stopped run with one planned feature, empty pending queue, zero execution requests on restart, and unchanged `stopped` status. Source trace shows `stopped` returns before execution.
- **User impact:** A user can stop safely, run `openweft start`, and see no work execute even though planned work remains.
- **Recommended fix:** Make `openweft start` reopen stopped checkpoints with actionable work, or explicitly document stopped as frozen and add a real resume/unfreeze command.
- **Confidence:** High
- **What would disconfirm:** A documented product decision that stopped is terminal, plus a visible unfreeze/discard path.

### 2. Silent `last-known-good` manifest fallback can schedule from stale boundaries

- **Severity:** P1
- **Area:** backend, planning, recovery
- **Evidence:** Wave 2 accepted a malformed current manifest and reused an old manifest path through `last-known-good`; provenance is discarded before scheduling.
- **User impact:** Manifest overlap can be computed from stale file boundaries, weakening the conflict-safe phasing promise.
- **Recommended fix:** Preserve manifest recovery provenance and block scheduling from stale fallback unless an operator explicitly accepts review/override.
- **Confidence:** High
- **What would disconfirm:** Replay evidence showing fallback only occurs when current intent is unchanged and old boundaries match.

### 3. Backend setup and permission failures masquerade as agent/content failures

- **Severity:** P1
- **Area:** adapters, diagnostics, DX
- **Evidence:** Missing backend commands returned `exitCode: 0` in probes; Codex/Claude adapters reported parser/content errors; permission strings classified as `agent`.
- **User impact:** Missing binaries, sandbox denials, or permissions problems can waste retries and point users at the wrong layer.
- **Recommended fix:** Preserve spawn metadata, classify missing commands and permission errors as setup/fatal/preflight, and surface install/login/permission next actions.
- **Confidence:** High
- **What would disconfirm:** Runtime changes proving missing commands always produce nonzero actionable errors before adapter parsing.

### 4. Conflict-path auto-stash restore failure is downgraded to ordinary merge conflict

- **Severity:** P1
- **Area:** git, recovery
- **Evidence:** Clean-merge stash restore failures throw a typed error, but conflict-path restore failures return ordinary `conflict`; orchestrator does not inspect failed `autoStash`.
- **User impact:** Agent conflict resolution can begin while the base repo also has failed restoration of the user's pre-existing changes.
- **Recommended fix:** Escalate conflict-path auto-stash restore failure as a distinct blocked/fatal state with recovery instructions.
- **Confidence:** High
- **What would disconfirm:** Caller-side handling that already stops before conflict resolution when `autoStash.restored === false`.

### 5. Startup prune ignores retained branch names

- **Severity:** P1
- **Area:** git, recovery
- **Evidence:** `retainedBranchNames` are computed and passed, but orphan pruning only honors retained worktree paths. Probe showed a branch retained only by name was deleted.
- **User impact:** Startup cleanup can delete the only easy branch pointer to completed-but-unmerged work.
- **Recommended fix:** Include retained branch names in prune predicates and add explicit branch-only recovery or expiry behavior.
- **Confidence:** High
- **What would disconfirm:** A proven invariant that actionable checkpoint branches always have correct retained worktree paths.

### 6. Live-provider readiness is not current-validated by the release gate

- **Severity:** P1 confidence gap
- **Area:** release
- **Evidence:** `release:check` does not run `smoke:live:*`; CI runs `release:check`; live scripts exist separately.
- **User impact:** A package-valid release can still fail first live Codex or Claude execution because provider auth/output/session behavior drifted.
- **Recommended fix:** Require current live smoke evidence for provider-ready claims: Codex resume smoke for Codex, Claude smoke for Claude, both for both-backend claims.
- **Confidence:** High for gate absence, medium-high for provider risk
- **What would disconfirm:** A current external release SOP with recorded live smoke results for this release window.

### 7. Re-analysis/checkpoint durability has single-write windows

- **Severity:** P2
- **Area:** recovery, backend
- **Evidence:** Successful re-analysis can update plan files/in-memory state before checkpoint save; later parse failure reloads older checkpoint. First checkpoint save does not seed `.backup`.
- **User impact:** Restart can see stale checkpoint metadata relative to adjusted plan files; earliest recoverable checkpoint lacks backup redundancy.
- **Recommended fix:** Save checkpoint after each successful re-analysis feature or stage updates transactionally; seed backup on first save.
- **Confidence:** Medium-high
- **What would disconfirm:** Tests proving re-analysis updates survive later parse failure and first-save backup absence is documented.

### 8. Ledger strictness and planning repair exhaustion consume user requests too aggressively

- **Severity:** P2
- **Area:** planning, UX
- **Evidence:** Parser requires exact `## Ledger` h3 headings while prompts say protocol-format imperfections should not abandon actionable work. Repair exhaustion marks feature `skipped`, non-rerunnable, and processed.
- **User impact:** A model formatting miss can consume a user request from the active pipeline even when artifacts remain reviewable.
- **Recommended fix:** Split hard gates from repairable presentation gates; introduce `planning-needs-review` or equivalent retryable review state.
- **Confidence:** High
- **What would disconfirm:** Product decision that exact ledger anchors are a hard safety gate, with contradictory prompt language removed.

### 9. Terminal health semantics can overstate success

- **Severity:** P2
- **Area:** backend, UX, tests
- **Evidence:** Dry-run can save/report `completed` with failed features; unresolved non-rerunnable failures may not stop later work; `successPenalty` is passed then dropped.
- **User impact:** Operators and scripts can see a healthier run state than feature states justify.
- **Recommended fix:** Derive dry-run status from feature states, choose/document terminal-failure continuation policy, and pass `successPenalty` through scoring.
- **Confidence:** High
- **What would disconfirm:** Docs/tests proving current "completed" and continuation semantics are intentional and unmistakable.

### 10. Terminal diagnostics expose facts without enough next-action guidance

- **Severity:** P2
- **Area:** UX, visual/TUI, CLI
- **Evidence:** StatusBar and MeterBar duplicate telemetry; help/footer list shortcuts not state meaning; history/detail lack outcome context; background output omits log path; onboarding lacks auth-mode/final preflight clarity.
- **User impact:** Users get raw facts but must infer what happened, what it means, and what to do safely.
- **Recommended fix:** Add a shared `health + meaning + nextAction + details` model across CLI/TUI/status/help/completion; consolidate telemetry; enrich history and onboarding.
- **Confidence:** High for source/static-render evidence, medium-high without real terminal screenshot suite
- **What would disconfirm:** 80x24/narrow terminal tests or user research proving current surfaces are clear.

## UX Clutter Map

| Surface | Current clutter/confusion | Recommendation |
|---|---|---|
| Dashboard status | `StatusBar` and `MeterBar` repeat phase/tokens/time. | One always-on health strip; move meters to detail/toggle. |
| Agent cards | Focused cards expand with files/tools/approval/detail in the list. | Stable compact rows plus focused detail pane. |
| Empty state | Strong visual loom, but state-light. | State-aware empty pane: no queue, queued, resumable, stopped, failed. |
| Help/footer | Shortcut tables without outcome semantics. | Add state meaning and next safe action before shortcuts. |
| History/detail | ID/request/commit only. | Add durability, cleanup, timestamp, last error, next action. |
| Model menu | Save scope is transient. | Inline "saved defaults apply next run; active run unchanged." |
| Onboarding | Backend detection good, auth mode/final preflight thin. | Add subscription/API-key choice and final preflight checklist. |
| CLI status | Raw diagnostics before triage. | Health, meaning, next action, then details. |
| Background/stop | PID/status hints but not log path or phase-safe semantics enough. | Include `.openweft/output.log`, stop behavior, and status command. |
| Failure output | Dense summary without safe recovery path. | Class-specific next action: auth, permission, durability, unknown. |

Design principle: reduce repeated chrome, not recoverability. Keep diagnostics one layer down, not hidden.

## Backend Correctness Map

| Area | Strong evidence | Remaining risk |
|---|---|---|
| Package/release gate | Typecheck, tests, build, package smoke, npm dry-run pass. | Live provider behavior outside gate. |
| Worktree lifecycle | Broad tests for creation, cleanup, merge, common conflict paths. | Branch-only retention and conflict auto-stash restore edge cases. |
| Checkpoint/resume | Strong tests for corrupt primary fallback, executing reset, reusable completions. | Stopped actionable work dead-end; first save lacks backup. |
| Planning pipeline | Durable Work Brief, feature plan, manifest, ledger artifacts. | Silent stale manifest fallback, exact ledger brittleness, consumed skipped planning. |
| Orchestrator loop | Plan/score/phase/execute/merge/re-analysis common paths covered. | Terminal failed features can be deferred; dry-run false green; re-analysis persistence window. |
| Adapter normalization | Codex/Claude/mock success paths and many parsing cases covered. | Missing command, permission classification, mock thrown errors, lost failure session IDs. |
| Status/finalization | Durability summaries and status rendering exist. | User-facing summary can under-report multi-feature failure breadth. |

## Recovery And Failure-Mode Assessment

OpenWeft's recovery architecture is directionally strong: checkpoints are strict Zod documents, writes are atomic, backup loading exists, execution features reset to planned on crash, reusable completed commits are recognized, and audit trails preserve many important events.

The weakness is semantic consistency at recovery boundaries:

- `stopped` behaves terminal in a state users will reasonably expect to resume.
- `skipped` can mean planning contract failure, not intentional skip.
- `last-known-good` can silently become scheduling truth.
- setup and permission problems can be treated as agent failures.
- dry-run completion can mean the simulator ended, not that feature work succeeded.
- dirty-tree auto-stash failures can be hidden under ordinary conflict handling.

Recommended recovery contract:

1. `openweft start` resumes actionable unfinished work.
2. `stopped` means operator-paused when actionable work remains.
3. `failed && rerunEligible` means automatic recovery.
4. `failed && !rerunEligible` means manual-attention stop by default.
5. Current parseable manifest is required for scheduling.
6. `last-known-good` is review evidence, not scheduling truth.
7. Planning and adjustment content failures become reviewable states.
8. Setup failures stay setup failures from runner through terminal output.

## Test And Validation Matrix

| Validation | Result | Notes |
|---|---:|---|
| `npm run typecheck` | Passed | Local shell required Homebrew Node/npm path. |
| `npm test` | Passed | 74 files, 824 tests. |
| `npm run build` | Passed | `tsc -p tsconfig.build.json`. |
| `npm run release:check` | Passed | typecheck, tests, build, packaged CLI smoke, npm dry-run. |
| Targeted surface sweep | Passed | 64 files, 756 tests across required surfaces. |
| Adapter diagnostics slice | Passed tests; probes found gaps | 9 files, 127 tests; missing-command/permission/session probes found issues. |
| Recovery/checkpoint slice | Passed tests; probes found gaps | Stopped restart dead-end and first-save backup absence reproduced. |
| Git safety slice | Passed tests; probes found gaps | Branch-only retention and conflict-stash restore issue confirmed. |
| Orchestrator slice | Passed tests; probes found gaps | Dry-run false completion and dropped `successPenalty` confirmed. |
| UI/CLI/status slice | Passed tests; static render found clutter | 39 files, 533 tests; StatusBar/MeterBar duplication confirmed. |
| Live Codex smoke | Skipped | Requires intentional provider access. |
| Live Codex resume smoke | Skipped | Required before Codex-ready release claim. |
| Live Claude smoke | Skipped | Required before Claude-ready release claim. |

## Recommendations That Preserve OpenWeft's Design Language

- Keep the product terminal-first and operational: phase, queue, worktree, checkpoint, manifest, ledger, durability, HEAD, tokens.
- Consolidate, do not decorate: one health strip, compact rows, clear detail pane.
- Preserve raw artifacts but name them at the right layer: `.openweft/checkpoint.json`, `.openweft/audit-trail.jsonl`, `.openweft/output.log`, Work Briefs, shadow plans.
- Prefer "what happened / what it means / next safe action" over long explanations.
- Keep safety details visible in `openweft status`; remove repeated telemetry from the dashboard.
- Do not add a `resume` alias until `start`/resume semantics are fixed enough to make the promise true.
- Do not call live-provider readiness unless the live smoke for that backend ran in the release window.

## Proposed Implementation Phases

### Phase 1: Core safety blockers

- Fix stopped checkpoint resume semantics.
- Block silent stale manifest scheduling.
- Fix missing-command and permission classification.
- Preserve failure-session IDs where recoverable.
- Escalate conflict-path auto-stash restore failure.
- Honor retained branch names during prune.
- Seed first checkpoint backup.

### Phase 2: Planning, re-analysis, and run-health semantics

- Persist re-analysis per feature or make updates transactional.
- Add `planning-needs-review` or equivalent review state.
- Normalize/synthesize repairable ledger presentation defects.
- Make dry-run status derive from feature states.
- Decide and test terminal permanent-failure policy.
- Pass `successPenalty` through scoring.
- Centralize parser-facing prompt contract.

### Phase 3: Release confidence gates

- Keep `release:check` as package gate.
- Add release SOP for current live smoke evidence.
- Require Codex resume smoke for Codex-ready claims.
- Require Claude smoke for Claude-ready claims.
- Consider packaged installed-CLI dry-run smoke.
- Enforce or assert npm `11.6.0` in CI/release docs.

### Phase 4: Progressive terminal UX

- Add shared terminal copy helper: health, meaning, next action, details.
- Collapse StatusBar/MeterBar duplication.
- Add compact agent rows plus selected detail pane.
- Enrich history/detail/completion/failure with outcome context.
- Add onboarding auth-mode and final preflight.
- Improve background/stop/status/failure copy.
- Add 80x24 and narrow-width render tests.

### Phase 5: Final verification

- Run full required commands again.
- Run all new targeted regression tests.
- Run packaged installed-CLI dry-run smoke if added.
- Run current live smokes for every backend named in release claim.
- Capture terminal render evidence for constrained sizes.

## Risks Of Proposed Changes

- Resuming stopped checkpoints can surprise users who thought `stop` froze forever. Mitigate with explicit status/help copy.
- Blocking stale manifests may reduce throughput. Mitigate with actionable review states and retry paths.
- Loosening ledger validation too broadly can weaken inspectability. Keep manifest/path safety strict.
- Setup-fatal classification may stop transient failures that retries once masked. Use precise classifier patterns and clear messages.
- Retaining branches by name can create branch clutter or collisions. Add audit, expiry, and branch-head inspection.
- Escalating auto-stash restore failures will stop more runs. That is safer for user changes; provide recovery commands/context.
- Dry-run stricter status can break scripts that treat process completion as success. Add clear failed counts and release notes.
- Copy compaction can hide trust-building details if overdone. Keep `openweft status` rich and details one key away.
- Live-smoke gates slow releases. Keep them separate from package gate and require them only for provider-ready claims.

## Exact Agent Files Written

See `AGENT_FILES.md` for the registry. Primary evidence files:

- `research-output/openweft-production-ux-review/wave-1/*.md`
- `research-output/openweft-production-ux-review/wave-1-intelligence-summary.md`
- `research-output/openweft-production-ux-review/wave-2/*.md`
- `research-output/openweft-production-ux-review/wave-2-intelligence-summary.md`
- `research-output/openweft-production-ux-review/wave-3/*.md`
- `research-output/openweft-production-ux-review/wave-3-intelligence-summary.md`

## Bottom Line

OpenWeft's foundation is credible: the release automation is green, the architecture is serious, and the common-path tests are broad. The remaining work is a production hardening pass, not a rescue mission.

The highest-leverage next move is to make recovery semantics true and legible: stopped means resumable when work remains, stale manifests do not silently schedule, setup failures say setup, dirty-tree restore failures stop safely, and the terminal always tells the user the next safe action.
