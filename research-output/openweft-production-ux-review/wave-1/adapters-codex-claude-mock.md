# Wave 1: Adapters Codex / Claude / Mock

## Scope
Reviewed `src/adapters/codex.ts`, `claude.ts`, `mock.ts`, `runner.ts`, `prompts.ts`, `shared.ts`, `types.ts`, and `codexHome.ts`, plus the adapter-facing orchestrator paths and adapter tests. The focus was command construction, token/session parsing, auth/sandbox/model/effort handling, `CODEX_HOME` isolation, mock parity, failure classification, and user-facing consequences.

## Files Inspected
- Docs and repo contract: `AGENTS.md`, `CLAUDE.md`, `README.md`, `ARCHITECTURE.md`, `package.json`, `research-output/openweft-production-ux-review/00_research_target_matrix.md`
- Adapter source: `src/adapters/types.ts`, `src/adapters/shared.ts`, `src/adapters/prompts.ts`, `src/adapters/runner.ts`, `src/adapters/codexHome.ts`, `src/adapters/codex.ts`, `src/adapters/claude.ts`, `src/adapters/mock.ts`, `src/adapters/index.ts`
- Related execution paths: `src/orchestrator/realRun.ts`, `src/orchestrator/dryRun.ts`, `src/domain/errors.ts`, `src/domain/primitives.ts`, `src/config/options.ts`
- Tests and fixtures: `tests/adapters/*.test.ts`, `tests/fixtures/adapters/codex-success.jsonl`, `tests/fixtures/adapters/claude-success.json`

## Commands Run
- Read the repo docs and target matrix with `sed` / `nl` / `rg`
- Inspected the adapter sources and tests with `sed`, `nl`, and `rg`
- Initial adapter test run: `npx vitest run tests/adapters` failed in this shell because `npx` was not on PATH
- Verified with a PATH-restored run: `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/node node_modules/vitest/vitest.mjs run tests/adapters`
- Ran small `tsx` repros against `createExecaCommandRunner`, `MockAgentAdapter.runTurn`, `parseClaudeJsonOutput`, and a stubbed `CodexCliAdapter.runTurn` failure path

## Findings

### 1. High - Mock adapter can throw instead of returning a classified failure
**Area:** mock parity / failure classification

**Evidence:** `src/adapters/types.ts:88-92` defines `runTurn()` as returning `Promise<AdapterTurnResult>`, but `src/adapters/mock.ts:215-243` calls `parseManifestDocument()` and `resolveMockConflicts()` without any catch block. A direct repro with an invalid execution prompt throws `No manifest block found under a "## Manifest" heading.` instead of returning `ok: false`.

**User impact:** `openweft start --dry-run` can crash on malformed prompts or file-IO problems instead of showing a structured adapter failure. That makes the mock path less reliable than the real adapters and breaks the expectation that dry-run is the safe simulator.

**Recommended fix:** Wrap the execution and conflict-resolution branches in `try/catch` and return `createAdapterFailure(...)` for parse and IO errors, keeping the thrown message as the classified error text.

**Confidence:** High

**What would disconfirm:** If dry-run inputs and filesystem access are guaranteed to never fail in practice, which the current contract and runtime shape do not guarantee.

### 2. High - Runner collapses spawn failures into fake success
**Area:** runner / command execution

**Evidence:** `src/adapters/runner.ts:20-37` returns `result.exitCode ?? (result.signal ? 1 : 0)`. In this shell, `createExecaCommandRunner()` against `definitely-not-a-real-command` returned `{"stdout":"","stderr":"","exitCode":0}` even though the command did not exist. That means execa reported a failed spawn, but the wrapper converted the missing exit code into `0`.

**User impact:** If `codex` or `claude` is missing from PATH, the failure is not surfaced as a clear setup problem. OpenWeft will treat the spawn as a normal exit, then the adapter parser will fail later and the orchestrator will likely classify it as an agent/content problem instead of a command-not-found problem.

**Recommended fix:** Treat `result.failed` or `result.exitCode === undefined` as a non-zero failure, preserve the underlying error text where possible, and add a regression test for a missing command.

**Confidence:** High

**What would disconfirm:** If execa always populates a real non-zero exit code for missing commands in this exact invocation mode; the repro here showed it does not.

### 3. Medium - Failure paths drop reusable session IDs
**Area:** token/session parsing / recovery

**Evidence:** `src/adapters/claude.ts:34-50` throws on `is_error: true` before reading `session_id`. `src/adapters/codex.ts:171-199` returns failure immediately on non-zero exit and never parses stdout. `src/adapters/shared.ts:122-134` only preserves `request.sessionId` unless the adapter passes an explicit session id. `src/orchestrator/realRun.ts:2536-2547` then uses `result.sessionId` to drive transient retries. Repro: `parseClaudeJsonOutput()` on a JSON error payload that includes `session_id` throws `API rate limit hit`, and a stubbed Codex failure with `thread.started` in stdout comes back with `sessionId: null`.

**User impact:** When a provider creates a useful session before failing, OpenWeft discards the handle. That forces cold retries, burns extra tokens/time, and weakens audit continuity for recoverable failures.

**Recommended fix:** Extract and carry session/thread IDs out of error payloads before classifying the failure, then pass them into `createAdapterFailure(...)` so retry logic can reuse them.

**Confidence:** Medium-high

**What would disconfirm:** If Codex and Claude never emit reusable session IDs on error paths or non-zero exits.

## Adapter Normalization Map

| Backend | Command shape | Auth / sandbox / effort handling | Session parsing | Failure behavior | Parity note |
|---|---|---|---|---|---|
| Codex | `codex exec ...` for new sessions, `codex exec resume <id> ...` for resumed sessions | `CODEX_HOME` is isolated via worker homes; subscription auth copies `auth.json` when present; sandbox mode is set on new sessions; effort is passed through `-c model_reasoning_effort=...` | Parses `thread.started`, streamed deltas, and `turn.completed` JSONL usage | Exit failures skip parsing and can lose session continuity | Good backend-specific command shaping, but failure recovery is coarse |
| Claude | `claude -p --output-format json --model ...` with optional `--effort`, `--dangerously-skip-permissions`, `--resume`, `--no-session-persistence`, `--max-budget-usd`, `--add-dir` | Auth is env-driven; no isolated home; `claudePermissionMode` collapses to skip-or-not-skip; sandboxMode is not used | Parses JSON `result`, `session_id`, `usage`, and `modelUsage` | Error payloads currently throw before session id is preserved | Strong normalization, but error-path recovery loses context |
| Mock | `mock run <stage>` | No real auth/sandbox/model/session flags in the command spec; deterministic fixture-backed usage and session ids | Synthesizes session id, usage, and output from fixtures / prompt text | Stage-specific parse or IO errors can throw instead of returning `ok: false` | Useful for deterministic tests, but not a backend oracle |

## Domino / Second-Order Risks
- A missing backend binary or broken PATH can look like an agent mistake, so OpenWeft may spend its retry budget on a setup problem instead of telling the user what is actually missing.
- Because `openweft start --dry-run` uses the mock adapter, any mock parity gap hides real Codex/Claude command regressions from demos and onboarding flows.
- Losing session IDs on failure makes recovery colder than it needs to be; transient provider hiccups can become extra token burn and harder-to-read audits.

## Recommended Follow-Up
1. Patch `runner.ts` to preserve non-success spawn failures as failures, then add a missing-command regression test.
2. Wrap `MockAgentAdapter.runTurn()` stage-specific work in adapter-level failure handling, then add a malformed execution prompt test and a conflict-resolution IO test.
3. Preserve `session_id` / `thread_id` from failure outputs before classifying Codex and Claude failures, then add synthetic failure fixtures for both adapters.
4. Re-run `tests/adapters` after the fixes and confirm the adapter suite still passes with the repo's normal PATH setup.

###COMPLETE###
