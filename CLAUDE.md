# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

OpenWeft is a fire-and-forget CLI that orchestrates batches of AI coding work across Codex CLI and Claude Code. It turns feature requests into Markdown plans, phases work by file overlap and risk, runs non-conflicting tasks in parallel git worktrees, merges results in priority order, and checkpoints state for crash recovery.

## Commands

```bash
npm run build          # tsc -p tsconfig.build.json → dist/
npm run typecheck      # tsc --noEmit (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
npm test               # vitest run
npm run test:watch     # vitest (watch mode)
npm run openweft       # run CLI from source via tsx
npm run release:check  # full publish gate (typecheck + test + build + npm publish --dry-run)
```

Run a single test file: `npx vitest run tests/domain/scoring.test.ts`

Run tests matching a name: `npx vitest run -t "pattern"`

## Architecture

### Module Layout (src/)

- **adapters/** — Backend abstraction layer. `AgentAdapter` interface (`types.ts`) defines `buildCommand` and `runTurn`. Implementations: `codex.ts`, `claude.ts`, `mock.ts`. `runner.ts` wraps `execa` for subprocess execution. `prompts.ts` handles template injection with `{{USER_REQUEST}}` and `{{CODE_EDIT_SUMMARY}}` markers.
- **orchestrator/** — Core workflow engine. `realRun.ts` contains the main orchestration loop (plan → score → phase → execute → merge → re-analyze). Uses XState v5 state machine for top-level lifecycle. `dryRun.ts` is the mock-backed equivalent. `audit.ts` handles append-only JSONL audit trail. `stop.ts` manages graceful shutdown.
- **domain/** — Pure business logic. `scoring.ts` computes feature priority from blast radius, fan-in coupling, and success likelihood. `phases.ts` groups features into conflict-safe execution phases based on manifest file overlap. `manifest.ts` parses/repairs `## Manifest` JSON blocks from Markdown plans. `queue.ts` manages `queue.txt` line parsing and processed-line rewriting. `costs.ts` tracks token usage and estimated USD.
- **state/** — `checkpoint.ts` — Zod-validated checkpoint schema with primary/backup save and crash recovery.
- **config/** — `schema.ts` defines `OpenWeftConfig` via Zod with `cosmiconfig` loading in `loadConfig.ts`.
- **git/** — `worktrees.ts` wraps `simple-git` for worktree create/remove, branch merge, conflict detection, and auto-gc management.
- **cli/** — `buildProgram.ts` (Commander) and `handlers.ts` wire CLI commands to orchestrator.
- **fs/** — Atomic file writes (`write-file-atomic`), retry reads, JSONL append helpers. `paths.ts` defines `RuntimePaths` with all `.openweft/` subdirectory paths.

### Key Patterns

- **Two-stage planning**: Prompt A (`prompts/prompt-a.md`) is a **meta-prompt** — it instructs the Stage 1 agent to *generate* a Prompt B. Stage 2 then sends that generated Prompt B to produce the actual Markdown feature plan with a `## Manifest` block containing `{create, modify, delete}` file arrays. The only runtime requirement for `prompt-a.md` is the `{{USER_REQUEST}}` marker, which `injectPromptTemplate` replaces with the feature request text. Paths referenced *inside* the prompt (e.g. `./project_ledgers`) are instructions for the target LLM to follow during execution — they are **not** paths managed by OpenWeft's own orchestrator. OpenWeft saves the final plan to `featureRequestsDir` (default `./feature_requests`).
- **Manifest-driven phasing**: Features are grouped into parallel phases only if their manifest file sets don't overlap. Hot-file features (high fan-in) get isolated phases.
- **Worktree isolation**: Each feature executes in its own git worktree under `.openweft/worktrees/`. Merges happen back to the base branch in priority order with agent-driven conflict resolution.
- **Checkpoint/resume**: `checkpoint.json` is atomically written with a `.backup` sibling. On resume, `executing` features are reset to `planned`.
- **Discriminated unions**: Adapter results use `ok: true | false` for `AdapterSuccess | AdapterFailure`.
- **All Zod schemas use `.strict()`** — no extra properties allowed.

### TypeScript Conventions

- ESM-only (`"type": "module"`), Node.js `>=24`, target `ES2023`
- `moduleResolution: "NodeNext"` — all local imports require `.js` extension
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `exactOptionalPropertyTypes: true` — `undefined` must be explicit in optional props
- `noUncheckedIndexedAccess: true` — indexed access returns `T | undefined`

### Test Structure

Tests mirror `src/` layout under `tests/`. E2E tests live in `tests/e2e/`. Fixtures in `tests/fixtures/`. Tests use `vitest` with Node environment and global test APIs.
