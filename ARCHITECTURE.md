# OpenWeft Architecture

OpenWeft is a batch orchestrator for AI coding agents. You give it a queue of feature requests, it figures out which ones can safely run in parallel, launches them in isolated git worktrees, merges the results, and repeats until the queue is empty.

This document explains how every piece works.

---

## The loop

Everything OpenWeft does fits inside one loop:

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
              ┌──────────┐                                    │
              │  Queue    │◄── openweft add "feature"         │
              └────┬─────┘                                    │
                   │                                          │
                   ▼                                          │
              ┌──────────┐    Prompt A compiles each          │
              │  Plan     │    request into a worker brief    │
              └────┬─────┘    (Prompt B)                      │
                   │                                          │
                   ▼                                          │
              ┌──────────┐    successLikelihood /              │
              │  Score    │    blastRadius^0.6                 │
              └────┬─────┘    EWMA · hysteresis · tiers       │
                   │                                          │
                   ▼                                          │
              ┌──────────┐    Group by manifest overlap        │
              │  Phase    │    Hot-file features get           │
              └────┬─────┘    isolated phases                 │
                   │                                          │
                   ▼                                          │
              ┌──────────┐    One worktree per feature         │
              │  Execute  │    One agent per feature            │
              └────┬─────┘    Staggered launch                 │
                   │          Promise.allSettled barrier        │
                   ▼                                          │
              ┌──────────┐    Priority-order merge (--no-ff)   │
              │  Merge    │    Dirty tree? Auto-stash safely    │
              │           │    Conflicts? Agent resolves        │
              └────┬─────┘                                    │
                   │                                          │
                   ▼                                          │
              ┌──────────┐    Diff summaries fed to remaining  │
              │ Re-plan   │    features via plan adjustment     │
              └────┬─────┘                                    │
                   │                                          │
                   ▼                                          │
              ┌──────────┐                                    │
         ┌────│  Check    │────┐                               │
         │    └──────────┘    │                               │
         │                    │                               │
    Queue empty          Features remain                      │
         │                    │                               │
         ▼                    └───────────────────────────────┘
       Done
```

The loop runs inside a `while(true)` in `realRun.ts`. Each iteration: plan pending requests → check for pending re-analysis → score and phase → execute phases → merge → collect diff summaries → loop. It breaks when the queue is empty, the user stops it, or unresolved failures remain.

---

## Module map

```
src/
├── cli/                    Commander program + command handlers
│   ├── buildProgram.ts     Commands: launch, init, add, start, status, stop
│   └── handlers.ts         Default templates (Prompt A, plan adjustment)
│
├── adapters/               Backend abstraction layer
│   ├── types.ts            AgentAdapter interface, AdapterSuccess | AdapterFailure
│   ├── codex.ts            Codex CLI adapter
│   ├── claude.ts           Claude Code adapter
│   ├── mock.ts             Deterministic mock (powers --dry-run and tests)
│   ├── runner.ts           Subprocess execution via execa
│   └── prompts.ts          Template injection ({{USER_REQUEST}}, {{CODE_EDIT_SUMMARY}})
│
├── orchestrator/           Core workflow engine
│   ├── realRun.ts          Main orchestration loop + state transitions
│   ├── dryRun.ts           XState v5 state machine (mock-backed pipeline)
│   ├── audit.ts            Append-only JSONL audit trail
│   └── stop.ts             Graceful shutdown controller
│
├── domain/                 Pure business logic (no side effects)
│   ├── scoring.ts          Priority scoring: blast radius, fan-in, EWMA, tiers
│   ├── phases.ts           Manifest overlap → conflict-safe execution groups
│   ├── manifest.ts         Parse/repair ## Manifest JSON + assert ## Ledger
│   ├── queue.ts            Queue parsing, v1 JSON format, line rewriting
│   ├── costs.ts            Token usage tracking (legacy cost-shaped schema)
│   └── featureIds.ts       ID formatting, plan/brief filenames, slugification
│
├── state/                  Persistence
│   └── checkpoint.ts       Zod-validated checkpoint with atomic write + backup
│
├── config/                 Configuration
│   ├── schema.ts           OpenWeftConfig Zod schema (strict)
│   └── loadConfig.ts       cosmiconfig loader
│
├── git/                    Git operations
│   └── worktrees.ts        Worktree lifecycle, dirty-tree-safe --no-ff merge, conflict handling, gc
│
└── fs/                     File system utilities
    ├── paths.ts            RuntimePaths (all .openweft/ subdirectories)
    └── ...                 Atomic writes, retry reads, JSONL append
```

---

## The two-stage prompt system

OpenWeft doesn't send your feature request directly to an agent. It compiles it first.

```
┌─────────────────────┐
│  "add password       │
│   reset flow"        │     Your raw request
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│     Prompt A         │     Meta-prompt (212 lines, production-grade)
│                      │     Tells the agent HOW to plan:
│  • 5-approach        │     - investigate codebase first
│    brainstorming     │     - brainstorm 5 high-level approaches
│  • Structured brief  │     - score by blast radius, reversibility
│    generation        │     - build structured execution plan
│  • Downstream        │     - require a durable plan + ledger
│    Impact Reviews    │     - validate incrementally
│  • 4-phase debug     │     - review downstream impact
│    protocol          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│     Prompt B         │     The actual worker brief
│                      │     Persisted to feature_requests/briefs/
│  Contains:           │     Inspectable, durable, recoverable
│  • Codebase context  │
│  • Execution brief   │     This is what Stage 2 runs.
│  • Planning rubric   │     Not a one-liner. A full operating document.
│  • Safety boundaries │
└─────────────────────┘
```

**Stage 1 (S1):** Prompt A runs against your request. Output: Prompt B — the detailed worker brief persisted under `feature_requests/briefs/`.

**Stage 2 (S2):** Prompt B runs against the codebase. Output: a full Markdown plan persisted under `feature_requests/*.md` with a `## Manifest` block (files to create/modify/delete) and a `## Ledger` (constraints, assumptions, watchpoints, validation).

The Stage 2 plan is what gets validated and resumed from:

- **Manifest** must parse as `{ create: string[], modify: string[], delete: string[] }`. If JSON is malformed, OpenWeft tries `jsonrepair`, then `JSON5.parse`, then falls back to the last known good manifest.
- **Ledger** must contain four required h3 subheadings: `Constraints`, `Assumptions`, `Watchpoints`, `Validation`. Enforced by `assertLedgerSection()`.

The Prompt B artifact is saved to `feature_requests/briefs/` and the validated plan is saved to `feature_requests/*.md`. If a session degrades or the process crashes, both survive. Recovery resumes from the plan plus checkpoint state, not from transient model memory.

---

## Scoring algorithm

Every feature gets scored before execution. The score determines execution order and phase grouping.

### Blast radius

How much damage could this feature cause?

```
For each file in the manifest:
  risk = typeWeight × opWeight × fanInScore

typeWeight:                      opWeight:
  schema-migration  1.0            create   0.6
  config-ci         0.8            modify   1.0
  shared-lib        0.8            delete   0.3
  route-controller  0.5
  feature-component 0.4
  test              0.1
  docs              0.05

fanInScore (how many other files depend on this one):
  create:          0.1  (new files have no dependents yet)
  modify/delete:   max(normalizedFanIn, 0.1)
                   where normalizedFanIn = fanIn / maxFanIn across repo

spreadMultiplier = 1 + log₂(uniqueDirectories) / log₂(totalDirectories)

blastRadius = sum(fileRisks) × spreadMultiplier
```

A feature that modifies three schema migrations across four directories scores dramatically higher than one that creates a test file.

### Success likelihood

How likely is this feature to succeed on the first attempt?

```
score  = 0.85                                  baseline
score -= 0.10 × (fileCount - 1)               more files = more risk
score -= 0.15 × modifyRatio                   modifications are riskier
score += 0.10 × createRatio                   creates are safer
score -= 0.20   if hasExternalApi              external calls are risky
score -= 0.05 × max(0, stepCount - 3)         complex plans penalized
score -= 0.10 × highCouplingRatio             high fan-in files penalized
score -= successPenalty                        manual penalty for retries

clamped to [0.05, 0.95]
```

### Priority

```
rawPriority = successLikelihood / (normalizedBlastRadius^0.6 + 0.01)
```

Features that are likely to succeed AND have low blast radius run first. The `^0.6` exponent means blast radius matters, but doesn't dominate — a high-risk feature that's very likely to succeed still gets reasonable priority.

### EWMA smoothing

Priority doesn't jump wildly between cycles. After the first two scoring passes, it smooths:

```
if cyclesSeen < 2:
  smoothedPriority = rawPriority           (responsive to initial data)
else:
  lambda = 0.25
  smoothedPriority = 0.25 × rawPriority + 0.75 × previousSmoothedPriority
```

### Tier assignment with hysteresis

Features are bucketed into tiers: `critical`, `high`, `medium`, `low`.

Hysteresis prevents flickering between tiers. A feature at `high` needs to score above `0.82` to promote to `critical`, but a `critical` feature only demotes at `0.77`. The gap prevents oscillation:

```
                    Promote ↑              Demote ↓
  critical ────────────────────────────── 0.77 ──────
                    0.82 ──────
  high     ────────────────────────────── 0.52 ──────
                    0.57 ──────
  medium   ────────────────────────────── 0.27 ──────
                    0.32 ──────
  low      ──────────────────────────────────────────
```

First-time scoring (no previous tier) uses the promote thresholds directly.

### Sorting

Features sorted by `smoothedPriority` descending. If two features are within `0.03` of each other, the tiebreaker is their previous rank — stability over noise.

---

## Phasing: how parallel groups are built

This is what makes OpenWeft different from "just run five agents at once."

### The problem

If Feature A modifies `src/auth/middleware.ts` and Feature B also modifies `src/auth/middleware.ts`, running them in parallel means one will overwrite the other's work. Or worse — both succeed in their isolated worktrees, but the merge produces a conflict that neither agent anticipated.

### The solution

Before any agent launches, OpenWeft compares every feature's manifest (`create`, `modify`, `delete` arrays) against every other feature's manifest. Features with overlapping file sets never execute in the same phase.

### Algorithm

```
for each feature (in priority order):

  if feature touches hot files (schema-migration, config-ci,
     or shared-lib with above-median fan-in):
    → isolate into its own phase (one feature, one phase)

  else:
    → scan existing phases:
      - skip phases at maxParallelAgents capacity
      - skip phases containing a hot-file feature
      - skip phases with ANY manifest file overlap
      → first compatible phase? add feature there
      → no compatible phase? create a new phase

output: ExecutionPhase[] (numbered, each containing non-conflicting features)
```

### Manifest overlap detection

```
findManifestOverlap(left, right):
  leftPaths  = Set(left.create ∪ left.modify ∪ left.delete)
  rightPaths = Set(right.create ∪ right.modify ∪ right.delete)
  return sorted(leftPaths ∩ rightPaths)
```

If the intersection is non-empty, the features conflict. One runs first; the other waits.

---

## Worktree isolation

Each feature executes in its own git worktree under `.openweft/worktrees/`. This is physical isolation — agents literally work in different copies of the repo.

```
your-repo/
├── .openweft/
│   └── worktrees/
│       ├── 001/                                ◄── Agent A works here
│       ├── 002/                                ◄── Agent B works here
│       └── 003/                                ◄── Agent C works here
├── src/                                        ◄── Main repo (merge target)
└── ...
```

### Ownership

OpenWeft owns all worktree lifecycle — creation, cleanup, merge, and garbage collection. Workers are explicitly instructed to never create additional worktrees, clone the repo, or create ad hoc branches. Every Prompt B includes this boundary:

> *Workspace isolation has already been solved by the orchestrator. Use the current assigned worktree as the only workspace.*

### Merge

When agents finish, OpenWeft merges their branches back to the base branch in priority order:

```
mergeBranchIntoCurrent(repoRoot, branch):
  → git merge --no-ff --no-edit <branch>

  success:
    → { status: 'merged', mergeCommit, editSummary }

  conflict:
    → git merge --abort
    → { status: 'conflict', conflicts: [{ file, reason }] }
    → OpenWeft stages base branch INTO the feature worktree
    → Preserve conflicted merge state in that worktree
    → Agent resolves conflicts in worktree context
    → Commit resolution on feature branch
    → Retry merge to base (up to 3 reconciliation rounds)
```

The `--no-ff` flag ensures every feature merge is a visible merge commit, even if it could fast-forward. This preserves per-feature history.

### Reuse detection

On resume, OpenWeft checks whether a managed worktree already has a reusable completion commit (`openweft: complete feature <id>`) or whether that feature was already merged. Reusable completions are queued for merge recovery instead of re-execution; already-merged features are marked complete and can still restore deferred re-analysis state. No wasted compute on work that already succeeded.

### Cleanup

After merges, `pruneOrphanedOpenWeftArtifacts` removes worktrees and branches not in the active set. Auto-gc is temporarily disabled during heavy worktree operations to avoid git pauses.

---

## The adapter layer

Three backends, one interface. The orchestrator doesn't know or care which agent is running.

```
                    ┌──────────────────┐
                    │  AgentAdapter     │
                    │                  │
                    │  buildCommand()  │
                    │  runTurn()       │
                    └───────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
        ┌─────────┐  ┌─────────┐  ┌─────────┐
        │  Codex  │  │ Claude  │  │  Mock   │
        │  CLI    │  │  Code   │  │         │
        └─────────┘  └─────────┘  └─────────┘
                                  powers --dry-run
                                  and test suite
```

### The interface

```typescript
interface AgentAdapter {
  readonly backend: 'codex' | 'claude' | 'mock';
  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec;
  runTurn(request: AdapterTurnRequest): Promise<AdapterTurnResult>;
}
```

### Request

Every agent call gets a typed request:

```typescript
AdapterTurnRequest {
  featureId:    string
  stage:        'planning-s1' | 'planning-s2' | 'execution'
                | 'adjustment' | 'conflict-resolution'
  cwd:          string     // worktree path
  prompt:       string     // injected prompt
  model:        string     // e.g. 'claude-sonnet-4-6'
  auth:         { method: 'subscription' | 'api_key', envVar?: string }
  sessionId?:   string     // persist across turns
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  effortLevel?: string     // 'low'|'medium'|'high'|'xhigh' (codex) or 'max' (claude)
  // ...
}
```

### Result (discriminated union)

```typescript
AdapterSuccess {
  ok: true
  finalMessage: string           // agent output
  usage: {
    inputTokens, outputTokens,
    totalCostUsd: number | null  // legacy adapter field, not displayed
  }
  sessionId: string | null
}

AdapterFailure {
  ok: false
  error: string
  classified: {
    tier: 'infrastructure' | 'rate-limit' | 'permission'
          | 'circuit-breaker' | 'user-input' | 'unknown'
    isRecoverable: boolean
  }
}
```

Pattern: `if (result.ok) { ... } else { ... }`. No exception-based flow control.

---

## Checkpoint and recovery

OpenWeft is designed to survive crashes, power loss, `Ctrl+C`, and process kills.

### Schema

The checkpoint is a Zod-validated JSON blob (schema version `1.0.0`, strict — no extra properties allowed):

```typescript
OrchestratorCheckpoint {
  schemaVersion:    '1.0.0'
  runId:            string (UUID, unique per orchestration session)
  checkpointId:     string (UUID, unique per write)
  status:           'idle' | 'in-progress' | 'paused'
                    | 'completed' | 'failed' | 'stopped'
  currentState:     'idle' | 'planning' | 'executing' | 'merging'
                    | 're-analysis' | 'queue-management' | 'stopped'
  currentPhase:     { index, name, featureIds, startedAt } | null
  queue:            { orderedFeatureIds, totalCount }
  features:         Record<featureId, FeatureCheckpoint>
  pendingMergeSummaries: Array<{ featureId, summary }>
  cost:             { totalInputTokens, totalOutputTokens,
                      totalEstimatedUsd, perFeature: Record<...> }
                    // legacy field name; UI/status render tokens only
}
```

Each feature tracks:

```typescript
FeatureCheckpoint {
  id, request, status, attempts,
  planFile, promptBFile, evolvedPlanFile,
  branchName, worktreePath, sessionId,
  manifest, priorityScore, priorityTier, scoringCycles,
  mergeCommit, lastError, updatedAt
}
```

### Atomic write with backup

```
saveCheckpoint:
  1. Read current checkpoint.json
  2. Copy current → checkpoint.json.backup
  3. Write new → checkpoint.json (via write-file-atomic)

loadCheckpoint:
  1. Try checkpoint.json (Zod parse)
  2. If invalid → try checkpoint.json.backup
  3. If both invalid → throw
  4. If both missing → return null (fresh start)
```

### Recovery on resume

When `openweft start` resumes from a checkpoint:

```
For each feature:
  status === 'executing':
    → Check if worktree exists and has completion commit
      → yes (already-merged): mark 'completed' and restore deferred re-analysis if needed
      → yes (reusable):       queue for merge recovery instead of re-execution
      → missing:              reset to 'planned', re-run

  status === 'failed' + rerunEligible:
    → Re-attempt execution

  status === 'planned':
    → Normal execution
```

In-flight features that died mid-execution get reset to `planned`. They re-run from the persisted plan file, not from broken agent context. This is intentional: clean re-execution beats attempting to resurrect a half-finished session.

---

## Usage tracking

Every agent call records input and output token counts. The normal CLI and TUI render token usage only.

### Usage stages

```
planning-s1          Prompt A generation
planning-s2          Prompt B + plan generation
execution            Feature implementation
adjustment           Plan re-evaluation after merges
conflict-resolution  Resolving merge conflicts
```

Unknown model names are quiet: token counts still accumulate, and no pricing warning is emitted.

Usage data accumulates in `.openweft/costs.jsonl` (append-only, one JSON line per agent call) and in the checkpoint's `cost` field (totals + per-feature breakdown). Those names are retained for compatibility with older checkpoints and configs; user-facing output treats the data as token usage.

---

## Queue format

### v1 (current)

```
# openweft queue format: v1
{"version":1,"type":"pending","id":"q_a1b2c3","request":"add password reset flow"}
{"version":1,"type":"processed","id":"q_d4e5f6","featureId":"1","request":"refactor auth middleware"}
```

Each line is a self-contained JSON record. Pending requests become processed when OpenWeft assigns a feature ID and begins planning.

### Multiline requests

Requests containing newlines or starting with `#` are base64url-encoded:

```
@@openweft:request:v1:<base64url-encoded-utf8>
```

Decoded transparently on parse.

### Legacy format

OpenWeft still parses the older plain-text format for backward compatibility:

```
# ✓ [001] refactored auth middleware
add password reset flow
```

New writes always use v1 JSON.

---

## The plan `## Ledger` section

This is what makes execution inspectable, not just observable.

Every validated plan contains a `## Ledger` section — a structured Markdown record of constraints, assumptions, watchpoints, validation, and execution notes. OpenWeft persists that plan in `feature_requests/*.md`, mirrors it in `.openweft/shadow-plans/`, and syncs copies into worktrees during execution. Not a log dump. A narrative.

A representative ledger section looks like:

```
## Executive Outcome
- 7 confirmed bugs fixed, 1 planned fix skipped as already safe
- Baseline: 63 test files, 641 tests → Final: 63 test files, 644 tests

## Investigation Method
10 dedicated analysis agents ran in parallel before any code was touched:
| Agent                    | Scope                          | Key Finding              |
|--------------------------|--------------------------------|--------------------------|
| Planning/Prompt Contract | prompts.ts, manifest.ts        | Path regex permissive    |
| Checkpoint/Recovery      | checkpoint.ts, realRun.ts      | Backup write failures    |
| ...                      | ...                            | ...                      |

## Issue Disposition Ledger
| # | Issue                              | Status          | What users would feel    |
|---|------------------------------------|-----------------|--------------------------|
| 1 | EWMA priority damping never fires  | Fixed           | "Why do priorities jump?" |
| 2 | NaN corrupts queue ordering        | Fixed           | Feature order randomized  |
| ...                                                                                   |

## Code Changes With Before/After
### Fix 1 — Propagate cyclesSeen through scoring pipeline
Before: [exact code]
After:  [exact code]
Why it matters: [explanation]
```

Each step in the plan uses a required schema:

```
- Step ID, title
- Dependencies (which prior steps must complete)
- Risk level
- Rollback notes (how to undo if it breaks)
- Validation criteria (how to verify it worked)
- Status (pending → in-progress → completed)
```

The plan ledger survives context loss because the canonical plan file is persisted on disk and promoted forward after successful execution/merge. Recovery uses the checkpoint plus the saved plan, not the model's memory.

---

## State transitions

The orchestrator moves through these states during a run:

```
  idle ──► planning ──► executing ──► merging ──► re-analysis ──► planning ...
    │                       │            │
    │                       │            └──► queue-management
    │                       │
    └───────────────────────┴──► stopped (user requested)
```

Feature statuses:

```
  pending ──► planned ──► executing ──► completed
                 │            │
                 │            └──► failed (retry if rerunEligible)
                 │
                 └──► skipped
```

Run statuses:

```
  idle ──► in-progress ──► completed
               │
               ├──► paused (legacy threshold hit)
               ├──► stopped (user requested)
               └──► failed (unrecoverable)
```

---

## Configuration

Config loads via [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig). Any of these work: `.openweftrc.json`, `.openweftrc.yaml`, `openweft.config.js`, or the `openweft` key in `package.json`.

The schema is Zod-strict (no extra properties). Full shape:

```
backend:         'codex' | 'claude'
auth:
  codex:         { method: 'subscription' | 'api_key', envVar?: string }
  claude:        { method: 'subscription' | 'api_key', envVar?: string }
prompts:
  promptA:       path to Prompt A template (must contain {{USER_REQUEST}})
  planAdjustment: path to plan adjustment template (must contain {{CODE_EDIT_SUMMARY}})
featureRequestsDir: path (default: ./feature_requests)
queueFile:       path (default: ./feature_requests/queue.txt)
models:
  codex:         string (default: 'gpt-5.5')
  claude:        string (default: 'claude-sonnet-4-6')
effort:
  codex:           'low' | 'medium' | 'high' | 'xhigh' (default: 'medium')
  claude:          'low' | 'medium' | 'high' | 'max' (default: 'medium')
approval:          'always' | 'per-feature' | 'first-only' (default: 'always')
concurrency:
  maxParallelAgents:  positive int (default: 3)
  staggerDelayMs:     non-negative int (default: 5000)
rateLimits:
  codex/claude:
    mode:                'subscription' | 'api_key'
    maxConcurrentRequests: positive int (codex: 3, claude: 2)
    retryBackoffMs:      non-negative int (default: 5000)
    retryMaxAttempts:    positive int (default: 5)
```

---

## What gets written to disk

```
your-repo/
├── feature_requests/
│   ├── queue.txt                    Your requests (v1 JSON format)
│   ├── 0001-add-password-reset.md   Generated plan with ## Manifest + ## Ledger
│   ├── 0002-refactor-auth.md
│   └── briefs/
│       ├── 0001-add-password-reset.md   Prompt B artifact
│       └── 0002-refactor-auth.md
│
├── prompts/
│   ├── prompt-a.md                  Your Prompt A template
│   └── plan-adjustment.md           Your plan adjustment template
│
├── .openweft/
│   ├── checkpoint.json              Orchestrator state (Zod-validated)
│   ├── checkpoint.json.backup       Backup sibling (atomic)
│   ├── costs.jsonl                  Token usage per call (legacy filename)
│   ├── audit-trail.jsonl            Append-only audit entries for real runs
│   ├── output.log                   --bg mode output
│   ├── pid                          Background process ID
│   ├── worktrees/                   Git worktrees (one numeric dir per feature)
│   ├── shadow-plans/                Canonical internal plan mirrors
│   ├── evolved-plans/               Worktree-promoted plan copies awaiting promotion or cleanup
│   └── dry-run-workspaces/          Scratch workspaces for --dry-run
│
└── .openweftrc.json                 Configuration
```

Everything important to runtime and recovery is inspectable on disk.

---

## Design principles

**Prompt B is first-class.** It's persisted, inspectable, and durable. Not disposable glue between stages.

**OpenWeft owns topology.** Workers never create worktrees, clone repos, or switch branches. Git infrastructure is orchestration, not intelligence.

**Real diffs beat declared intent.** The actual repository changes are the final truth. Worker-reported manifests are useful signals, not gospel.

**Separate cognition from orchestration.** Prompt B thinks and works. OpenWeft schedules and reconciles. Neither tries to do the other's job.

**Simplicity is role clarity.** Three layers, three jobs: Prompt A writes the mission brief. Prompt B runs the mission. OpenWeft controls the battlefield.

---

## CLI commands

```
openweft                setup wizard (first run) · dashboard (returning)
openweft init           config, directories, prompt files
openweft add "feature"  queue a request (also accepts stdin)
openweft start          run the queue with interactive dashboard
openweft start --bg     detach — PID tracked, logs to .openweft/output.log
openweft start --stream stream raw agent output to terminal
openweft start --tmux   launch in a tmux session
openweft start --dry-run planning/phasing/execution simulation with mock adapter
openweft status         queue state, tokens, feature breakdown
openweft stop           ask a background run to finish the current phase, then stop
```

---

## TypeScript conventions

- ESM-only (`"type": "module"`), Node.js `>=24`, target `ES2023`
- `moduleResolution: "NodeNext"` — all local imports require `.js` extension
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `exactOptionalPropertyTypes: true` — `undefined` must be explicit in optional props
- `noUncheckedIndexedAccess: true` — indexed access returns `T | undefined`
- All Zod schemas use `.strict()` — no extra properties allowed
- Discriminated unions (`ok: true | false`) for adapter results — no exception-based flow control
