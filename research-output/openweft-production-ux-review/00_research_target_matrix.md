# OpenWeft Production UX Review Target Matrix
Date: 2026-06-10

Research question: Can a real user run OpenWeft, understand it, recover from problems, and trust it without being overwhelmed?

| Claim ID | Claim Text | Type | Sensitivity | Volatility | Researchability | Score | Wave Assignment | Disconfirmation Target | Evidence Route |
|---|---|---|---|---|---|---:|---|---|---|
| C1 | The terminal UI presents run state clearly without clutter or confusing hierarchy. | UX/visual | High | Medium | High | 18 | Wave 1 | UI tests, snapshots, or component code show dense/duplicative status, unclear focus, or hidden critical state. | src/ui, tests/ui |
| C2 | The onboarding wizard reduces first-run fear and guides users to a working setup. | UX | High | Medium | High | 18 | Wave 1 | Wizard code/tests leave prerequisites, auth, config, or next steps ambiguous. | src/ui/onboarding, tests/ui/onboarding |
| C3 | CLI commands and modes are discoverable and ergonomically mapped to real workflows. | UX/DX | High | Medium | High | 18 | Wave 1 | Commander surface, README, or handlers expose modes inconsistently or hide recovery/background behaviors. | src/cli, tests/cli, README |
| C4 | Status, history, detail, help, footer, model menu, and empty states explain what happened and what to do next. | UX/diagnostics | High | Medium | High | 18 | Wave 1 | UI/status surfaces show raw mechanics without next actions, or omit failure/recovery context. | src/ui, src/status, tests/ui, tests/status |
| C5 | The planning pipeline reliably turns requests into Work Briefs, feature plans, manifests, and ledgers. | Backend | High | Medium | High | 18 | Wave 1 | Manifest/ledger parsing allows malformed plans, stale artifacts, or unclear repair outcomes. | src/domain/manifest.ts, src/orchestrator/planMarkdown.ts, prompts, tests/domain |
| C6 | The orchestrator loop correctly sequences plan, score, phase, execute, merge, re-plan, and checkpoint. | Backend | High | Medium | High | 18 | Wave 1 | realRun state transitions can skip re-analysis, checkpointing, or stop/failure handling under plausible states. | src/orchestrator, tests/orchestrator |
| C7 | Git worktree creation, merge, conflict recovery, cleanup, and dirty-tree handling are safe. | Backend/recovery | High | Medium | High | 18 | Wave 1 | Worktree tests or code reveal unsafe cleanup, branch naming risk, merge-state loss, or unclear conflict escalation. | src/git/worktrees.ts, tests/git |
| C8 | Checkpoint, resume, stop, and crash recovery preserve trust and avoid duplicate/destructive work. | Recovery | High | Medium | High | 18 | Wave 1 | Resume cannot explain reused completions, corrupt checkpoints, or mid-phase stop semantics clearly. | src/state, src/orchestrator/stop.ts, tests/state, tests/e2e |
| C9 | Codex, Claude, and mock adapters are correctly normalized and fail clearly. | Backend/DX | High | Medium | High | 18 | Wave 1 | Adapter command specs, token extraction, session IDs, or failure classification diverge in user-visible ways. | src/adapters, tests/adapters |
| C10 | Config strictness and environment handling are helpful instead of brittle or mysterious. | DX/release | Medium | Medium | High | 12 | Wave 1 | Strict schemas or env rules produce opaque errors or make common setup mistakes hard to recover from. | src/config, tests/config, README |
| C11 | Tests and release checks cover the production-critical workflows promised in docs. | Tests/release | High | Medium | High | 18 | Wave 1 | Required validation commands fail or coverage misses a critical live/recovery path. | package scripts, tests, scripts |
| C12 | User-facing diagnostics and failure messages preserve essential operational detail while minimizing noise. | UX/recovery | High | Medium | High | 18 | Wave 1 | Failure/status output overwhelms users or hides the next safe recovery action. | src/status, src/ui, src/orchestrator/audit.ts |

Adjacent domains for optional Wave 3:
- Packaging and npm publish user journey.
- Terminal accessibility and small-window rendering.
- Real provider authentication and subscription CLI drift.
