# Wave 3 Intelligence Summary
## Research: OpenWeft production-readiness and terminal UX review
## Date: 2026-06-10
## Agents dispatched: 3 | Findings collected: targeted blocker triage, recovery contract matrix, terminal UX finalization

---

### Confirmed Findings

**Final verdict should be near-ready, not broad-production-ready**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: `release-blocker-triage.md` reconciles the strong green package gate with unresolved P1 recovery, manifest, adapter, and git safety issues. No P0 issue was found.
- Confirmation source count: 3 Wave 3 agents plus Wave 2 summary

**Recovery semantics need one coherent operator contract**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: `recovery-planning-contract-matrix.md` defines `start` as the least-surprising resume path, `stopped` as operator-paused when actionable work remains, terminal non-rerunnable failures as manual-attention stops, stale manifests as review signals, and dry-run status as aggregate feature truth.
- Confirmation source count: 2

**Terminal UX improvements should reduce clutter by progressive disclosure, not by hiding diagnostics**
- Status: CONFIRMED
- Evidence strength: HIGH
- Key evidence: `terminal-ux-copy-layout-finalization.md` proposes one health strip, compact work rows, a focused detail pane, status diagnostics ordered as health/meaning/next action/details, and raw artifacts named but not dumped.
- Confirmation source count: 3

---

### Shifted Findings

**Production readiness classification**
- Status: SHIFTED
- Direction: After Wave 3, the best label is "near-ready" rather than "not ready." The package/test/build/release automation is strong, but broad live-provider release should be blocked until P1 safety semantics and release-policy gates are addressed.
- Evidence strength: HIGH

**Implementation scope**
- Status: SHIFTED
- Direction: The recommended path is not a broad rewrite. Wave 3 converged on narrow phases: core safety blockers, planning/re-analysis/run-health semantics, release gates, progressive terminal UX, final verification.
- Evidence strength: HIGH

---

### Release-Blocking Priorities

1. Stopped checkpoints can strand planned work.
2. Silent `last-known-good` manifest fallback can schedule from stale file boundaries.
3. Backend setup and permission failures masquerade as agent/content failures.
4. Conflict-path auto-stash restore failure is downgraded to ordinary merge conflict.
5. Startup prune ignores retained branch names.
6. Live-provider readiness is not current-validated by the release gate.
7. Re-analysis/checkpoint durability has single-write windows and first-save backup is absent.
8. Ledger strictness and planning repair exhaustion consume user requests too aggressively.
9. Terminal health semantics can overstate run success through dry-run false green and unresolved-failure continuation.
10. Terminal diagnostics expose facts without enough progressive next-action guidance.

---

### Recommended Implementation Phases

**Phase 1: Core safety blockers**
- Stopped checkpoint resume semantics.
- Silent stale manifest fallback.
- Missing-command/permission classification and failure-session preservation.
- Conflict-path auto-stash restore escalation.
- Retained branch-name pruning.
- First checkpoint backup seeding.

**Phase 2: Planning, re-analysis, and run-health semantics**
- Per-feature re-analysis persistence or transactionality.
- Ledger normalization and `planning-needs-review`.
- Dry-run failed status, permanent-failure contract, and `successPenalty`.
- Canonical parser-facing prompt contract.

**Phase 3: Release confidence gates**
- Current live-smoke SOP.
- Optional packaged installed-CLI dry-run smoke.
- npm version reproducibility hardening.

**Phase 4: Progressive terminal UX**
- Shared health/meaning/next-action/details copy model.
- Dashboard compaction.
- History/detail enrichment.
- Onboarding auth-mode and final preflight clarity.

**Phase 5: Final verification**
- Full package gate, targeted regressions, packaged dry-run smoke if added, live smokes for named backends, and 80x24/narrow terminal render checks.

---

### Residual Blind Spots

- Current live Codex and Claude provider behavior remains unverified because live smokes were intentionally not run.
- Real user comprehension remains unmeasured; recommendations are evidence-backed by source/tests/static rendering rather than user studies.
- The product team must still choose whether terminal non-rerunnable failures stop unrelated work by default or continue with explicit throughput semantics. Wave 3 recommends stopping for trust.

---

### Sufficiency Decision

Research is sufficient to proceed to final synthesis. Wave 3 resolved the major contradictions into actionable product contracts and implementation phases. No further agents are needed before writing the final research brief.
