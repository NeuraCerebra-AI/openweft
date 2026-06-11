# Wave 2 Intelligence Summary
## Research: OpenWeft production-readiness and terminal UX review
## Date: 2026-06-10
## Agents dispatched: 7 | Findings collected: 30+ | Evidence quality distribution: local source, targeted tests, runtime probes, release-gate execution

---

### Confirmed Findings

**C8: Stop/resume semantics can strand planned work**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: `recovery-stop-checkpoint-validation.md` reproduced a stopped run with one planned feature, no pending queue, zero execution requests on restart, and unchanged `stopped` status. The source path confirms `stopped` checkpoints return early before execution.
- Confirmation source count: 2

**C9/C12: Adapter and diagnostic classification failures can mislead recovery**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: `adapter-diagnostic-classification-validation.md` reproduced missing backend commands returning `exitCode: 0`, permission strings classifying as `agent`, mock adapter throws outside the adapter result contract, and failure-session IDs being dropped.
- Confirmation source count: 2

**C7: Git lifecycle safety is strong on common paths but has two high-risk edge gaps**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: `git-prune-autostash-validation.md` confirmed retained branch names are passed but ignored during orphan pruning, and conflict-path auto-stash restore failures are downgraded to ordinary conflicts.
- Confirmation source count: 2

**C5/C6: Planning and orchestration are contract-driven, but some contracts are brittle or internally inconsistent**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: `planning-pipeline-resilience-validation.md` confirmed stale `last-known-good` manifest fallback, exact ledger strictness, non-rerunnable skipped planning, and re-analysis parse abort behavior. `orchestrator-loop-semantics-validation.md` confirmed dry-run false completion, permanent-failure continuation, re-analysis durability window, and a dropped `successPenalty`.
- Confirmation source count: 3

**C1/C4/C12: OpenWeft exposes useful operational facts but needs progressive disclosure and next-action guidance**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: `progressive-diagnostics-ux-design.md` confirmed rendered duplication between `StatusBar` and `MeterBar`, shortcut-only help/footer semantics, sparse history/detail outcomes, under-scoped model-menu persistence copy, onboarding preflight/auth clarity gaps, and CLI status/background/stop/resume messaging gaps.
- Confirmation source count: 4

**C11: Package/repo release validation is green, but live-provider readiness is unverified-current**
- Status: CONFIRMED
- Evidence strength: HIGH for package gate, MEDIUM for provider gap severity
- Key evidence: Main thread and `release-live-smoke-confidence-gap.md` both ran or inspected `release:check` through typecheck, tests, build, packaged CLI smoke, and npm dry-run. Live Codex/Claude smoke scripts exist but are not part of CI or `release:check` and were intentionally not run.
- Confirmation source count: 2

---

### Shifted Findings

**Re-analysis failure does not mean merged work is lost**
- Status: SHIFTED
- Direction: Wave 1's "partial successful re-analysis updates can be lost" is narrower: merged work and pending merge summaries are preserved, but checkpoint metadata can become stale relative to adjusted plan files if a later adjustment parse fails before a checkpoint save.
- Evidence strength: HIGH
- Implication: This remains a recovery correctness gap, but not a catastrophic data-loss claim.

**Dry-run is useful, but not a full planning-resilience preflight**
- Status: SHIFTED
- Direction: Dry-run validates happy-path scaffolding and mock-backed execution, but it does not exercise real-run plan repair behavior and can report `completed` with failed feature states.
- Evidence strength: HIGH
- Implication: Dry-run should be marketed and tested as a simulation until aligned with real-run resilience semantics.

---

### Potential Leads

**Exact stop/resume product contract**
- Current evidence: Source/docs imply `start` resumes, while `stopped` acts terminal in one important state.
- Evidence quality: High
- What's needed: Decide whether `stopped` is resumable by default or intentionally frozen behind a future explicit command.
- Recommended Wave 3 action: synthesize implementation phases and tests for the least surprising recovery contract.

**Strict ledger tolerance boundary**
- Current evidence: Exact headings provide inspectability but contradict prompt guidance that protocol-format imperfection should not abandon actionable work.
- Evidence quality: High
- What's needed: Define hard machine contract versus repairable presentation contract.
- Recommended Wave 3 action: turn this into a proposed contract matrix and regression plan.

**Release status label**
- Current evidence: `release:check` is green, but live provider current-state validation is absent.
- Evidence quality: High for repo/package, low for current provider behavior.
- What's needed: Decide whether final verdict says "near-ready" or "not ready" for broad release.
- Recommended Wave 3 action: release blocker triage across source blockers, confidence gaps, and policy gates.

---

### Contradictions

**Contradiction 1: Architecture says unresolved failures stop the loop; current loop can continue**
- Agent A found: `ARCHITECTURE.md` describes breaking when unresolved failures remain.
- Agent B found: `realRun.ts` checks unresolved permanent failures only when no scores remain; other planned work can continue first.
- Resolution approach: Treat as a product contract decision. If unresolved failures should stop the run, fix loop semantics. If unrelated work should continue, update docs/status to say so explicitly.

**Contradiction 2: Prompt guidance says do not abandon for protocol-only imperfections; parser does abandon exact ledger misses**
- Agent A found: prompt/work protocol says imperfect ledger/dossier/protocol formatting should not alone abandon actionable work.
- Agent B found: parser demands exact ledger h3 headings and tests expect skips/aborts.
- Resolution approach: Split manifest safety from ledger presentation. Keep manifest strict; normalize/synthesize ledger anchors where safe.

**Contradiction 3: Green release gate versus production-ready claim**
- Agent A found: `release:check` is strong and passed.
- Agent B found: live-provider behavior is intentionally outside release gate.
- Resolution approach: Final verdict should separate package readiness from live-provider readiness and require live smoke before any "real-provider-ready" claim.

---

### Disconfirmations

**"OpenWeft is production-ready because release checks pass" remains contradicted**
- Disconfirming evidence: Multiple P1/high findings survived green tests and release gate: stopped planned-work dead-end, missing-command misclassification, permission retry classification, branch-only retention pruning, conflict auto-stash downgrade, stale manifest fallback, dry-run false completion, and unclear recovery messaging.
- Evidence quality: local source/test/runtime evidence
- If confirmed: Final verdict should be near-ready or not-ready for broad release, not fully production-ready.
- Recommended action: prioritize fixes in recovery/diagnostics/git/planning before broad release.

**"Dry-run complete" means feature simulation succeeded is contradicted**
- Disconfirming evidence: Direct probe showed `resultStatus: "completed"` and saved checkpoint `completed` with feature `001: "failed"`.
- Evidence quality: runtime probe
- Recommended action: make dry-run status derive from feature states.

---

### Absence Signals

**No current live Codex/Claude smoke evidence**
- Expected because: user listed live smokes as required only if credentials/provider access are intentionally available.
- Where we looked: `package.json`, `scripts/live-smoke.mjs`, CI, release tests, Wave 1/Wave 2 reports.
- Possible interpretations: provider access was intentionally not used; package readiness is validated but provider readiness is not current.
- Implication: release confidence gap, not a source-level blocker unless publishing/announcing provider readiness.

**No rendered real-terminal screenshot suite**
- Expected because: terminal clutter is central to the UX review.
- Where we looked: UI tests and Wave 2 UX report. One static Ink render probe was run; no terminal-emulator screenshots were captured.
- Implication: source and static rendering strongly support clutter findings, but final implementation should add 80x24 and narrow-width render tests.

**No first-class retry/review command for skipped planning work**
- Expected because: planning repair exhaustion consumes queue items as `skipped`.
- Where we looked: CLI commands and planning/orchestrator reports.
- Implication: recovery UX is weaker than backend artifact preservation.

---

### Blind Spots

**Real provider drift**
- Why blind: live smoke was intentionally skipped.
- Impact: provider auth/output/session/resume behavior is not current-validated.
- Suggested approach for Wave 3/final: classify as confidence gap with explicit release policy.

**User research on clutter versus diagnostic trust**
- Why blind: review is source/test/probe-based.
- Impact: recommendations should preserve detail behind progressive disclosure rather than remove diagnostics outright.
- Suggested approach: implement copy/layout changes conservatively and test with small-terminal snapshots.

**Exact preferred semantics for continuing unrelated work after a terminal feature failure**
- Why blind: docs and code disagree.
- Impact: this is a product policy choice, not merely a bug.
- Suggested approach: choose a default that protects user trust; document and test the alternative if chosen.

---

### Research Quality Assessment

- Total findings this wave: 30+.
- Evidence quality distribution: source inspection, targeted Vitest slices, runtime probes, release-gate execution.
- Claims with HIGH-confidence assessment: recovery stop/resume, adapter classification, git edge gaps, planning stale fallback, dry-run false completion, UX next-action gaps.
- Claims with MEDIUM-confidence assessment: exact product severity of live-provider gap, user preference tradeoff for continuing unrelated work after terminal failure, final UI clutter severity without terminal screenshots.
- Claims with INSUFFICIENT-DATA: current Codex/Claude live behavior and real user comprehension outcomes.

---

### Updated Research Priorities for Wave 3

1. **Release-blocker triage and implementation phasing** — reconcile all P1/P2 findings into a prioritized fix sequence, with "blocker" versus "confidence gap" labels.
2. **Recovery/planning contract matrix** — define stopped/resume, skipped/planning-needs-review, stale manifest fallback, and permanent-failure continuation semantics as one coherent operator workflow.
3. **Terminal UX state/copy matrix validation** — refine progressive disclosure recommendations into concrete copy and layout changes that reduce clutter without hiding recovery diagnostics.
