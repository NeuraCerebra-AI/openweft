# Wave 1 Intelligence Summary
## Research: OpenWeft production-readiness and terminal UX review
## Date: 2026-06-10
## Agents dispatched: 12 | Findings collected: 35+ | Evidence quality distribution: local source/test evidence only

---

### Confirmed Findings

**C11: Automated package/repo release gate is strong**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: Main thread ran `npm run typecheck`, `npm test` (74 files / 824 tests), `npm run build`, `npm run release:check` through packaged CLI smoke and `npm publish --dry-run`; targeted surface sweep passed 64 files / 756 tests. `tests-release-readiness.md` confirms package/readiness coverage and broad test distribution.
- Confirmation source count: 2 (main validation + tests-release agent)

**C7/C8: Git/recovery surfaces have substantial targeted test coverage**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: `git-worktree-merge-safety.md`, `checkpoint-resume-stop-recovery.md`, and main targeted sweep all exercised git, checkpoint, e2e, and orchestrator slices. Tests cover conflict detection, dirty tree restore, reusable completions, final durability downgrades, and checkpoint fallback.
- Confirmation source count: 4

**C1/C4/C12: The UI/status surfaces expose operational facts but often omit “what this means / what to do next”**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: `status-history-detail-help.md` and `diagnostics-failure-messaging.md` independently found status/history/help/failure surfaces are fact-heavy but recovery-light; `terminal-ui-visual-clutter.md` found duplicated telemetry in `StatusBar` + `MeterBar`.
- Confirmation source count: 3

**C5: Planning pipeline is durable and contract-driven, but strict contracts can become UX failure points**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: `planning-pipeline.md` confirms Work Brief, manifest, ledger, repair, and shadow-plan architecture; it also flags ledger strictness, stale manifest fallback, skipped planning semantics, and re-analysis brittleness.
- Confirmation source count: 1 with test/source backing

---

### Potential Leads

**Stop/resume dead-end after final planning stop**
- Current evidence: `checkpoint-resume-stop-recovery.md` says stopped checkpoints with already planned work and empty pending queue can immediately return on next `start`.
- Evidence quality: local source/test read + targeted test gap
- What's needed: Wave 2 should reproduce or disconfirm with a focused test/code trace.
- Recommended Wave 2 action: dedicated recovery semantics agent.

**Runner spawn failures may be converted to exit code 0**
- Current evidence: `adapters-codex-claude-mock.md` reports `createExecaCommandRunner()` returned `exitCode: 0` for a missing command in a local repro.
- Evidence quality: local runtime probe
- What's needed: inspect `execa` result behavior and adapter caller classification; determine if this is real under current dependency version.
- Recommended Wave 2 action: adapter failure-classification agent.

**Permanent feature failures may not short-circuit the run**
- Current evidence: `orchestrator-correctness.md` says unresolved non-rerunnable failures are only checked when no scores remain.
- Evidence quality: local source/test read
- What's needed: validate intended product contract versus tests/docs; trace whether later work can continue after permanent failure.
- Recommended Wave 2 action: orchestrator loop semantics agent.

**Startup pruning may ignore retained branch names**
- Current evidence: `git-worktree-merge-safety.md` says retained branch names are computed but not honored during orphan pruning.
- Evidence quality: local source/test read
- What's needed: exact code-path proof and regression-test sketch.
- Recommended Wave 2 action: git safety agent.

**Dry-run may report completed despite feature-level failures**
- Current evidence: `orchestrator-correctness.md` says `dryRun.ts` records feature failures but unconditionally sets run `completed`.
- Evidence quality: local source/test read
- What's needed: reproduce with a failing mock fixture/path.
- Recommended Wave 2 action: dry-run/orchestrator semantics agent.

---

### Contradictions

**Contradiction 1: Release gate is green, but live-provider readiness remains unproven**
- Agent A found: tests-release says `release:check` is strong and passed.
- Agent B found: tests-release also says real Codex/Claude smoke is not in release gate; prior memory says live resume smoke has passed historically but must be current-verified.
- Possible explanations: automated gate intentionally avoids external credentials; live provider validation is a manual release policy.
- Resolution approach: Wave 2 should classify this as blocker vs confidence gap and define minimum live-smoke evidence.

**Contradiction 2: Strict ledger/manifest contracts improve safety but can drop usable work**
- Agent A found: planning-pipeline says strict `## Ledger` validation protects inspectability.
- Agent B found: same report says one malformed response can skip a feature or abort re-analysis.
- Possible explanations: parser strictness is correct, but failure UX/retry semantics need a softer operator path.
- Resolution approach: Wave 2 should separate contract correctness from user-facing recovery behavior.

**Contradiction 3: Operational detail builds trust but current surfaces may overwhelm users**
- Agent A found: status diagnostics and durability summaries expose useful internals.
- Agent B found: UI/status/help reports find duplicated telemetry, dense failure facts, and insufficient next action.
- Possible explanations: detail is essential but needs progressive disclosure.
- Resolution approach: Wave 2 should propose a diagnostics hierarchy that preserves recovery visibility.

---

### Disconfirmations

**“Passing tests means production-ready” is contradicted**
- Disconfirming evidence: Multiple high/medium findings survived full-suite and release-gate success: stop/resume dead-end, runner failure classification, permission error classification, dry-run status mismatch, branch retention pruning, and UX recovery gaps.
- Evidence quality: local source/test evidence
- If confirmed: production readiness is near-ready but not ready solely on tests.
- Recommended action: prioritize targeted fixes and add regression tests.

---

### Absence Signals

**No current live-provider smoke in this run**
- Expected because: user listed live smoke tests if credentials/provider access are intentionally available.
- Where we looked: package scripts and release report; no intentional credential authorization was given.
- Possible interpretations: credentials are unavailable/undesired for this review; live smoke belongs to a manual release gate; current release readiness remains a confidence gap.
- Implication: not a source-level blocker, but a release confidence gap.

**No first-class `resume` command**
- Expected because: recovery is a core product promise.
- Where we looked: CLI command list and README.
- Possible interpretations: `start` intentionally resumes; UX language has not caught up; recovery discoverability is underdeveloped.
- Implication: medium UX gap.

---

### Blind Spots

**Real terminal screenshots / screenshots at constrained sizes**
- Why blind: agents read/tested Ink components, but did not capture live TUI screenshots.
- Impact if this matters: UI clutter severity could be under- or over-stated.
- Suggested approach for Wave 2: source-grounded layout agent; optional rendered snapshot if practical.

**Real Codex/Claude provider behavior**
- Why blind: live smoke not run in this review.
- Impact if this matters: subscription auth, CLI output schema drift, provider retry/session behavior remain unverified-current.
- Suggested approach for Wave 2: classify as confidence gap; do not invent live evidence.

---

### Research Quality Assessment

- Total findings this wave: 35+.
- Evidence quality distribution: local source/test/runtime evidence, no external web evidence needed.
- Claims with HIGH-confidence assessment: many backend and UX claims are source-grounded; live-provider claims remain unverified.
- Claims with INSUFFICIENT-DATA: live provider behavior, real terminal screenshots, current CI run status beyond local release check.

---

### Updated Research Priorities for Wave 2

1. **Recovery stop/resume semantics** — Validate or disconfirm the stopped-checkpoint dead-end and first-backup durability gap.
2. **Adapter/diagnostic failure classification** — Validate missing-command runner behavior, permission fatal classification, mock adapter thrown errors, and lost session IDs on failures.
3. **Orchestrator loop semantics** — Validate permanent-failure short-circuit, dry-run failed-feature status, and partial re-analysis persistence.
4. **Git cleanup/merge safety** — Validate retained-branch pruning and conflict-path auto-stash restore handling.
5. **Planning pipeline resilience** — Validate stale manifest fallback, ledger strictness, skip semantics, and re-analysis failure blast radius.
6. **Progressive diagnostics UX** — Design a low-clutter status/failure hierarchy that preserves trust and recovery detail.
7. **Release confidence gap** — Define when green `release:check` is enough and when live-provider smoke is mandatory.
