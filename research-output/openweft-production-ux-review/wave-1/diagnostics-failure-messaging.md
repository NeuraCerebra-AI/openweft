# Diagnostics Failure Messaging Review

## Scope
Reviewed user-facing diagnostics, failure messaging, audit trail shape, status rendering, runtime diagnostics, adapter error classification, and failure next-action guidance across the requested source and test surfaces. Focus was the C4/C9/C12 target matrix areas that affect how a failed run is classified, narrated, and recovered.

## Files Inspected
- Repo docs: `README.md`, `ARCHITECTURE.md`, `package.json`, `research-output/openweft-production-ux-review/00_research_target_matrix.md`
- Error and diagnostics core: `src/domain/errors.ts`, `src/status/runtimeDiagnostics.ts`, `src/status/renderStatus.ts`
- Orchestrator and audit trail: `src/orchestrator/audit.ts`, `src/orchestrator/finalization.ts`, `src/orchestrator/realRun.ts`
- Adapter/runtime plumbing: `src/adapters/shared.ts`, `src/adapters/runner.ts`
- UI failure surfaces: `src/ui/App.tsx`, `src/ui/styledOutput.tsx`, `src/ui/StatusBar.tsx`, `src/ui/Footer.tsx`, `src/ui/HelpOverlay.tsx`, `src/ui/EmptyState.tsx`, `src/ui/AgentCard.tsx`, `src/ui/HistoryView.tsx`, `src/ui/HistoryDetailView.tsx`, `src/ui/events.ts`, `src/ui/hooks/useOrchestratorBridge.ts`
- Onboarding next-action examples: `src/ui/onboarding/StepBackends.tsx`, `src/ui/onboarding/StepWelcome.tsx`, `src/ui/onboarding/StepInit.tsx`, `src/ui/onboarding/StepLaunch.tsx`, `src/ui/onboarding/CompletedSummary.tsx`, `src/ui/onboarding/WizardFooter.tsx`, `src/ui/onboarding/OnboardingApp.tsx`
- CLI status/failure output: `src/cli/handlers.ts`
- Tests: `tests/domain/errors.test.ts`, `tests/status/renderStatus.test.ts`, `tests/ui/App.test.tsx`, `tests/ui/styledOutput.test.tsx`, `tests/ui/onboarding/StepBackends.test.tsx`, `tests/ui/onboarding/StepWelcome.test.tsx`, `tests/ui/onboarding/StepInit.test.tsx`, `tests/adapters/runner.test.ts`, `tests/adapters/codex.test.ts`, `tests/adapters/claude.test.ts`, `tests/adapters/mock.test.ts`, `tests/orchestrator/realRun.test.ts`, `tests/cli/handlers.test.ts`, `tests/cli/handlers.tui.test.ts`

## Commands Run
- Source inspection with `rg`, `sed`, and `nl -ba` over the files above.
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx vitest run tests/domain/errors.test.ts tests/status/renderStatus.test.ts tests/ui/App.test.tsx tests/ui/styledOutput.test.tsx tests/ui/onboarding/StepBackends.test.tsx tests/ui/onboarding/StepWelcome.test.tsx tests/ui/onboarding/StepInit.test.tsx tests/adapters/runner.test.ts tests/adapters/codex.test.ts tests/adapters/claude.test.ts tests/adapters/mock.test.ts tests/cli/handlers.test.ts --reporter=dot`
- Result: 12 files passed, 169 tests passed.
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx vitest run tests/orchestrator/realRun.test.ts --reporter=dot`
- Result: 1 file passed, 76 tests passed.
- `PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/tsx -e "import { classifyError } from './src/domain/errors.ts'; console.log(classifyError(new Error('Permission denied: cannot create .git directory')).tier); console.log(classifyError(new Error('EACCES: permission denied')).tier); console.log(classifyError(new Error('Operation not permitted')).tier);"`
- Result: all three permission-style errors classified as `agent`.
- `PATH=/opt/homebrew/bin:$PATH ./node_modules/.bin/tsx -e "import { summarizeMergeDurability } from './src/status/runtimeDiagnostics.ts'; console.log(summarizeMergeDurability({ totalCompletedFeatures: 3, verifiedCount: 1, checks: [{ featureId: '001', mergeCommit: 'a', result: 'verified' }, { featureId: '002', mergeCommit: null, result: 'missing-merge-commit' }, { featureId: '003', mergeCommit: 'c', result: 'not-reachable' }] }));"`
- Result: only the first failing feature was reported.

## Findings

### 1. Permission failures are misclassified as retryable agent failures
- **Severity:** High
- **Area:** Adapter error classification / rerun policy
- **Evidence:** `src/domain/errors.ts:18-30,45-65` defines the fatal patterns, but does not match `Permission denied`, `EACCES`, `EPERM`, or `Operation not permitted`. `src/adapters/shared.ts:106-134` wraps adapter failures using that classification. `src/orchestrator/realRun.ts:2509-2647` retries `agent` failures and only stops immediately for `fatal` failures. The probe returned `agent` for all three permission-style errors.
- **User impact:** Environment or filesystem permission problems will be treated like flaky agent mistakes. That burns a retry, delays recovery, and points the user toward the wrong kind of fix.
- **Recommended fix:** Add fatal classifications for permission-denied variants and cover them with regression tests in `tests/domain/errors.test.ts` plus the orchestrator/adapter failure path tests that depend on tiering.
- **Confidence:** High
- **What would disconfirm:** If another layer reliably remaps these permission failures before retry logic sees them, or if the product intentionally wants to retry permission errors.

### 2. Durability diagnostics collapse multi-failure state to the first broken feature
- **Severity:** Medium
- **Area:** Runtime diagnostics / status rendering
- **Evidence:** `src/status/runtimeDiagnostics.ts:32-45` uses `.find(...)` and returns only the first failing completed feature. That summary is reused by `renderStatusReport`, the CLI status output, the TTY `StatusCard`, and the failed completion screen. The probe with three failing checks reported only the first missing-commit failure.
- **User impact:** When several features fail merge durability checks, operators see only the first broken item. The real cleanup scope can be larger than the summary suggests.
- **Recommended fix:** Summarize all failing completed features, or at least return the first failure plus a `+N more` count. Add a regression test that proves multi-failure summaries preserve breadth.
- **Confidence:** High
- **What would disconfirm:** If another nearby diagnostics surface always enumerates every failed feature in the same failure path.

### 3. Failure screens explain state but not the next safe action
- **Severity:** Medium-high
- **Area:** User-facing failure messaging / next-step guidance
- **Evidence:** `src/ui/App.tsx:201-275`, `src/ui/styledOutput.tsx:31-61`, `src/cli/handlers.ts:2442-2528`, and `src/cli/handlers.ts:2541-2609` all present status facts such as counts, `HEAD`, durability, cleanup state, and exit hints, but they do not recommend a concrete recovery step. By contrast, `src/ui/onboarding/StepBackends.tsx:307-353`, `src/ui/onboarding/StepWelcome.tsx:124-132`, and `src/ui/onboarding/StepInit.tsx:128-141` show that this codebase already knows how to give explicit next-action guidance on failure.
- **User impact:** After a failed run, the user has to infer whether to inspect status, fix auth/environment issues, or rerun. That slows recovery and increases repeat-failure loops.
- **Recommended fix:** Add one short generic recovery line to failed completion/status screens, with tier-specific hints when the error classification is known.
- **Confidence:** Medium-high
- **What would disconfirm:** If a separate always-visible recovery guide already appears in the main run path and reliably covers failed runs.

## Failure Messaging Map
| Layer | Current behavior | Gap | Why it matters |
|---|---|---|---|
| `src/domain/errors.ts` + `src/adapters/shared.ts` | Tiers adapter failures into `agent` vs `fatal` | Permission-style failures are still treated as retryable | Bad retry choice and misleading recovery path |
| `src/orchestrator/realRun.ts` failure handling | Builds audit events and retry decisions from the tier | No special handling for env/permission failures | A false retry can waste time and clutter logs |
| `src/orchestrator/audit.ts` / `finalization.ts` | Preserves raw event payloads in append-only JSONL | Event shapes are specific, not a single canonical failure envelope | Downstream tooling must special-case events |
| `src/status/runtimeDiagnostics.ts` + `src/status/renderStatus.ts` | Produces a compact durability summary | Only the first failing feature is surfaced | Understates blast radius |
| `src/ui/styledOutput.tsx`, `src/ui/App.tsx`, `src/cli/handlers.ts` | Shows state, counts, HEAD, cleanup, exit hints | No explicit recovery action | Users must guess the next step |
| `src/ui/onboarding/*` | Failure states include direct guidance | This clarity is not mirrored in main run failures | Main-path UX feels less actionable than onboarding |

## Domino / Second-Order Risks
- Permission errors classified as `agent` can trigger avoidable retries, which increases log noise and makes the audit trail look like the agent is unstable when the real problem is the environment.
- First-failure-only durability summaries can shrink the apparent blast radius of a bad merge batch, so support or operators may stop investigating too early.
- The audit trail is structurally useful, but the event-specific JSONL shapes mean downstream tooling has to know too much about each failure type instead of reading one consistent envelope.
- TTY and non-TTY failure surfaces currently share the same diagnostics-first style, so a fix in one path can easily drift away from the other unless the messaging is centralized.

## Recommended Follow-Up
1. Fix classification for permission-denied / operation-not-permitted errors and add regression tests.
2. Expand durability summaries to show all failing completed features, or the first failure plus a remaining-count suffix.
3. Add a shared recovery hint helper and use it in CLI, TTY, and UI failure screens.
4. Consider whether audit events need a small canonical failure envelope so downstream consumers do not have to reconstruct intent from heterogeneous payloads.

###COMPLETE###
