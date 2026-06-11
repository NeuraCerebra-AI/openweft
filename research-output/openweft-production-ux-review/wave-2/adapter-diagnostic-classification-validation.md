# Wave 2: Adapter / Diagnostic Classification Validation

## Scope

Validated five Wave 1 adapter and diagnostics claims against the current OpenWeft source, tests, and focused runtime probes:

1. Runner missing-command/spawn failures can collapse to `exitCode: 0` or be under-classified.
2. The mock adapter can throw instead of returning `AdapterFailure`.
3. Permission/access failures classify as retryable agent failures rather than auth/preflight/fatal failures.
4. Adapter failure paths drop reusable session IDs.
5. Failure/durability summaries expose only the first broken feature.

No source code was changed. The only repo write made by this agent is this report.

## Files Inspected

- Required docs and prior research: `AGENTS.md`, `CLAUDE.md`, `README.md`, `ARCHITECTURE.md`, `package.json`, `research-output/openweft-production-ux-review/wave-1-intelligence-summary.md`, `research-output/openweft-production-ux-review/wave-1/adapters-codex-claude-mock.md`, `research-output/openweft-production-ux-review/wave-1/diagnostics-failure-messaging.md`
- Adapter source: `src/adapters/runner.ts`, `src/adapters/types.ts`, `src/adapters/shared.ts`, `src/adapters/codex.ts`, `src/adapters/claude.ts`, `src/adapters/mock.ts`
- Classification, status, and finalization: `src/domain/errors.ts`, `src/status/runtimeDiagnostics.ts`, `src/status/renderStatus.ts`, `src/orchestrator/finalization.ts`
- Orchestrator failure paths: `src/orchestrator/realRun.ts`
- Tests: `tests/adapters/runner.test.ts`, `tests/adapters/mock.test.ts`, `tests/adapters/codex.test.ts`, `tests/adapters/claude.test.ts`, `tests/domain/errors.test.ts`, `tests/status/renderStatus.test.ts`, `tests/orchestrator/realRun.test.ts`

## Commands Run

- `wc -l AGENTS.md CLAUDE.md README.md ARCHITECTURE.md package.json research-output/openweft-production-ux-review/wave-1-intelligence-summary.md research-output/openweft-production-ux-review/wave-1/adapters-codex-claude-mock.md research-output/openweft-production-ux-review/wave-1/diagnostics-failure-messaging.md`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' CLAUDE.md`
- `sed -n '1,520p' README.md`
- `sed -n '1,420p' ARCHITECTURE.md`
- `sed -n '421,900p' ARCHITECTURE.md`
- `sed -n '1,130p' package.json`
- `sed -n '1,220p' research-output/openweft-production-ux-review/wave-1-intelligence-summary.md`
- `sed -n '1,140p' research-output/openweft-production-ux-review/wave-1/adapters-codex-claude-mock.md`
- `sed -n '1,140p' research-output/openweft-production-ux-review/wave-1/diagnostics-failure-messaging.md`
- `nl -ba` / `sed` / `rg` source and test inspection over the files listed above.
- `node -v` -> `v24.9.0`
- `npm -v` -> `11.6.0`
- `npx vitest run tests/adapters tests/domain/errors.test.ts tests/status/renderStatus.test.ts tests/orchestrator/realRun.test.ts --reporter=dot`
  - Result: 9 files passed, 127 tests passed.
- `node --import tsx --input-type=module -e "...createExecaCommandRunner missing command probe..."`
  - Result: `{"stdout":"","stderr":"","exitCode":0}`
- `node --import tsx --input-type=module -e "...CodexCliAdapter/ClaudeCliAdapter with PATH missing..."`
  - Result: `codex` -> `ok:false`, `exitCode:0`, `tier:"agent"`, error `Codex output did not include a final agent message.`; `claude` -> `ok:false`, `exitCode:0`, `tier:"agent"`, error `Failed to parse Claude JSON output.`
- `npx tsx -e "...classifyError permission variants..."`
  - Result: `Permission denied`, `EACCES`, `EPERM`, and `Operation not permitted` all classified as `agent`.
- `npx tsx -e "...MockAgentAdapter execution with no manifest..."`
  - Result: the call threw `No manifest block found under a "## Manifest" heading.` instead of returning an adapter result.
- `node --import tsx --input-type=module -e "...Codex/Claude failure payloads with session IDs..."`
  - Result: Codex and Claude failures both returned `sessionId:null` despite stdout containing `thread_id` / `session_id`.
- `node --import tsx --input-type=module -e "...summarizeMergeDurability with two failing checks..."`
  - Result: `FAILED (002 is missing a recorded merge commit)`.

## Validation Result Per Claim

| Claim | Result | Notes |
|---|---|---|
| Runner can collapse missing command/spawn failures into `exitCode: 0` or under-classify spawn errors. | Confirmed | The runner probe returned `exitCode:0` for a nonexistent command, and adapter probes with missing PATH reported parser failures as `agent` errors with `exitCode:0`. |
| Mock adapter can throw instead of returning `AdapterFailure`. | Confirmed | Malformed execution input throws from manifest parsing before `createAdapterFailure()` is reached. |
| Permission/access failures classify as retryable agent failures instead of auth/preflight/fatal. | Confirmed | Shared classifier returns `agent`; execution retry logic treats `agent` as reset-and-retry work. |
| Adapter failure paths drop reusable session IDs. | Confirmed with scope | Existing request session IDs are preserved by `createAdapterFailure()`, but newly emitted failure-session IDs from Codex/Claude outputs are dropped. |
| Failure/durability summaries expose only the first broken feature. | Partially confirmed | User-facing `summarizeMergeDurability()` reports only the first failing check. Raw finalization logic and audit data do keep the full failing check set. |

## Findings

### 1. Missing backend commands become fake zero-exit agent/content failures

- **Severity:** High
- **Area:** Adapter runner / spawn failure classification
- **Evidence:** `src/adapters/runner.ts:20-36` calls `execa(..., reject:false)` and returns `result.exitCode ?? (result.signal ? 1 : 0)`. A nonexistent command probe returned `{"stdout":"","stderr":"","exitCode":0}`. With `PATH` forced to a missing directory, `CodexCliAdapter` returned `ok:false`, `exitCode:0`, `tier:"agent"`, and `Codex output did not include a final agent message.`; `ClaudeCliAdapter` returned `ok:false`, `exitCode:0`, `tier:"agent"`, and `Failed to parse Claude JSON output.` Existing runner tests only cover successful long-running subprocesses (`tests/adapters/runner.test.ts:5-37`).
- **User impact:** If `codex` or `claude` is missing, misconfigured, or not reachable on PATH, OpenWeft can tell the user the model output was malformed rather than saying the backend binary could not be started. Execution then follows agent-failure recovery paths instead of a clear setup/preflight failure.
- **Recommended fix:** Extend `CommandExecutionResult` or runner internals to preserve `failed`, `exitCode === undefined`, `code`, and short spawn error text. Treat missing command / undefined exit as nonzero fatal setup failure, preferably with a message containing `command not found` or `ENOENT` so `classifyError()` maps it to `fatal`.
- **Confidence:** High
- **What would disconfirm:** A change in `execa` behavior or runner options that guarantees missing commands always return a nonzero `exitCode` and meaningful stderr before adapter parsing starts. The current local dependency did not behave that way.

### 2. Mock execution and conflict-resolution paths can escape the adapter result contract

- **Severity:** High
- **Area:** Mock adapter parity / dry-run safety
- **Evidence:** The adapter contract expects `runTurn()` to resolve `AdapterTurnResult` (`src/adapters/types.ts:88-92`). `src/adapters/mock.ts:215-243` handles explicit fixture errors, but then calls `parseManifestDocument()`, `applyManifestToWorkspace()`, and `resolveMockConflicts()` without a catch block. A malformed execution prompt probe threw `No manifest block found under a "## Manifest" heading.` instead of returning `ok:false`. Existing mock tests only cover fixture success and fixture failure (`tests/adapters/mock.test.ts:15-55`).
- **User impact:** `openweft start --dry-run` can crash or surface an unexpected rejection for malformed plans or filesystem problems. That weakens dry-run as the safe production rehearsal path and hides whether orchestration failure handling works.
- **Recommended fix:** Wrap the mock `runTurn()` body after command construction in `try/catch`, returning `createAdapterFailure()` for parse and IO failures. Preserve synthetic mock session IDs on these failures so dry-run failure behavior remains close to real adapter behavior.
- **Confidence:** High
- **What would disconfirm:** A higher layer that always catches mock adapter throws and rewrites them into equivalent adapter failures. `realRun.ts` does catch unexpected execution throws later, but `dryRun.ts` and direct adapter use still depend on the adapter contract.

### 3. Permission and access errors are retried as agent mistakes

- **Severity:** High
- **Area:** Error taxonomy / execution retry policy
- **Evidence:** `src/domain/errors.ts:18-31` includes fatal patterns for auth, command-not-found, disk, config, and template failures, but not `Permission denied`, `EACCES`, `EPERM`, or `Operation not permitted`. The probe classified all four as `agent`. In execution, fatal failures stop immediately (`src/orchestrator/realRun.ts:2509-2520`), while `agent` failures reset the worktree, clear `sessionId`, and retry once (`src/orchestrator/realRun.ts:2544-2567`). If still failed, they remain full-rerun eligible (`src/orchestrator/realRun.ts:2624-2647`, `src/orchestrator/realRun.ts:2895-2932`). Existing classifier tests do not include permission variants (`tests/domain/errors.test.ts:5-32`).
- **User impact:** Filesystem permissions, sandbox denials, or access-control failures can consume retry budget and make the audit trail look like the agent failed to execute the plan. The user gets a slower, less actionable failure path for problems they need to fix in the environment.
- **Recommended fix:** Add permission/access patterns to fatal or a dedicated preflight/setup tier. If keeping the current three-tier taxonomy, classify these as `fatal` unless there is a known transient permission case. Add a short next-action hint such as "check file permissions, sandbox settings, or repo path access."
- **Confidence:** High
- **What would disconfirm:** Evidence that all permission-style adapter errors are intercepted and rewritten before reaching `createAdapterFailure()` or `classifyError()`. Current shared adapter failure creation classifies the raw message directly (`src/adapters/shared.ts:114-125`).

### 4. Failure outputs lose newly created Codex/Claude session handles

- **Severity:** Medium-high
- **Area:** Adapter session continuity / retry durability
- **Evidence:** `createAdapterFailure()` preserves only an explicit `input.sessionId` or the request's prior `sessionId` (`src/adapters/shared.ts:106-133`). Codex returns immediately on nonzero exit without parsing stdout (`src/adapters/codex.ts:171-177`), even though success parsing would detect `thread.started` (`src/adapters/codex.ts:44-46`). Claude throws on `is_error:true` before reading `session_id` (`src/adapters/claude.ts:34-36`, with successful session parsing later at `src/adapters/claude.ts:48-50`). A probe with Codex `thread.started` and Claude `session_id` in failure outputs returned `sessionId:null` for both. The orchestrator can reuse transient failure sessions (`src/orchestrator/realRun.ts:2536-2541`), but the handle is already gone.
- **User impact:** If a provider starts a recoverable session/thread before failing, OpenWeft cold-retries instead of resuming. That can burn more time and tokens, weaken audit continuity, and make rate-limit or flaky-provider recovery worse than necessary.
- **Recommended fix:** Add best-effort session extraction on failure paths: parse Codex JSONL for `thread.started` before returning nonzero-exit failures, and parse Claude JSON enough to capture `session_id` before throwing/creating a failure. Pass the extracted value into `createAdapterFailure({ sessionId })`.
- **Confidence:** Medium-high
- **What would disconfirm:** Provider guarantees that failure outputs never contain reusable session IDs, or that sessions emitted with error payloads are not resumable. The code is currently capable of reusing IDs when present, so losing them is still a local durability gap.

### 5. User-facing durability summaries under-report multi-feature failure breadth

- **Severity:** Medium
- **Area:** Runtime diagnostics / status and terminal summaries
- **Evidence:** `src/status/runtimeDiagnostics.ts:32-45` uses `.find()` and returns a string for only the first non-verified merge durability check. `renderStatusReport()` renders that compact string (`src/status/renderStatus.ts:152-154`), and CLI terminal output also uses `summarizeMergeDurability()` (`src/cli/handlers.ts:2445`). A probe with two failing checks returned only `FAILED (002 is missing a recorded merge commit)`, omitting feature `003`. Existing status tests assert the one-failure string only (`tests/status/renderStatus.test.ts:161-192`).
- **User impact:** If multiple completed features fail final durability checks, the visible status/terminal summary can make the blast radius look smaller than it is. Operators may inspect or repair only the first named feature.
- **Recommended fix:** Keep the compact summary but include breadth, for example `FAILED (002 missing merge commit; 003 not reachable; 2 failures total)` or `FAILED (002 missing merge commit; +1 more)`. Add a drill-down list in status output if preserving one-line terminal output is important.
- **Confidence:** High for the user-facing summary; partial overall.
- **What would disconfirm:** A consistently adjacent user-visible surface that enumerates every failing durability check whenever this summary appears. Finalization does keep all failing checks internally, but the compact user-facing summary does not.

## Proposed Regression Tests

1. `tests/adapters/runner.test.ts`: missing command should return a nonzero execution result or a classified fatal adapter failure. Assert the message includes `command not found`, `ENOENT`, or an equivalent setup clue.
2. `tests/adapters/codex.test.ts`: with `PATH` missing or a runner simulating missing spawn, `CodexCliAdapter.runTurn()` should not report `exitCode:0` or parser-only `agent` failure.
3. `tests/adapters/claude.test.ts`: same missing-spawn coverage for Claude.
4. `tests/adapters/mock.test.ts`: execution prompt without `## Manifest` should resolve `ok:false`, not throw.
5. `tests/adapters/mock.test.ts`: conflict-resolution filesystem/read failure should resolve `ok:false`, not throw.
6. `tests/domain/errors.test.ts`: `Permission denied`, `EACCES`, `EPERM`, and `Operation not permitted` should classify as fatal/preflight/setup.
7. `tests/orchestrator/realRun.test.ts`: permission-classified adapter failure should not trigger the agent retry branch or full rerun scheduling.
8. `tests/adapters/codex.test.ts`: nonzero-exit stdout containing `thread.started` should return failure with that `sessionId`.
9. `tests/adapters/claude.test.ts`: `is_error:true` output containing `session_id` should return failure with that `sessionId`.
10. `tests/status/renderStatus.test.ts`: multi-failure merge durability should show all failing feature IDs or a `+N more` count.
11. `tests/orchestrator/realRun.test.ts` or `tests/orchestrator/finalization.test.ts` if added: finalization should continue marking every failed durability check in checkpoint and audit data while the summary also preserves breadth.

## Domino Risks

- Missing binary misclassification can make onboarding and first production runs feel like mysterious model failures instead of fixable local setup issues.
- Permission errors treated as agent mistakes can reset worktrees or retry against an unchanged environment, increasing noise and delaying the real fix.
- Cold retries after dropped session IDs can inflate token/time usage and make transient provider failures harder to correlate in audit logs.
- Mock adapter throws weaken dry-run as a production-readiness signal; a demo or release rehearsal can fail differently from live adapters.
- First-failure-only summaries can hide a batch-wide durability problem, especially after parallel phases where several completed features share the same finalization failure mode.
- Fixing only one layer is risky: runner, adapter parser, classifier, orchestrator retry policy, and status summary all need compatible semantics so a setup failure stays a setup failure from subprocess through user-facing output.

###COMPLETE###
