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
              └────┬─────┘    (Work Brief)                    │
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

The loop runs inside a `while(true)` in `realRun.ts`. Each iteration: plan pending requests → check for pending re-analysis → score and phase → execute one compatible phase → merge → collect diff summaries → loop. OpenWeft intentionally re-enters scoring and phasing after a phase finishes so remaining work can be adjusted against the real merged code. It exits when the queue has no executable work left, the user stops it, a fatal/circuit-breaker condition halts the run, or only unresolved failed/review-needed work remains.

Unresolved blockers do not automatically stop the whole run. If planning, adjustment, or terminal failure leaves one feature needing review, OpenWeft compares manifests: overlapping features become `blocked-by-failed-feature`, while unrelated planned or retryable features stay eligible and continue through scoring and phasing. The final run still reports `failed` if unresolved failed or review-needed work remains.

---

## Module map

```
src/
├── bin/
│   └── openweft.ts        Published CLI executable entrypoint
│
├── cli/                    Commander program + command handlers
│   ├── buildProgram.ts     Commands: launch, init, add, start, resume, status, stop
│   ├── handlers.ts         Command implementations, onboarding/TUI launch, bg/tmux/status/stop
│   └── pidFile.ts          Run-identity PID records (pid + start time + argv marker)
│
├── adapters/               Backend abstraction layer
│   ├── types.ts            AgentAdapter interface, AdapterSuccess | AdapterFailure
│   ├── codex.ts            Codex CLI adapter
│   ├── claude.ts           Claude Code adapter
│   ├── mock.ts             Deterministic mock (supports --dry-run and tests)
│   ├── runner.ts           Subprocess execution via execa
│   ├── shared.ts           Auth/env helpers, error classification, result shaping
│   ├── codexHome.ts        Isolated Codex worker-home preparation
│   └── prompts.ts          Template injection ({{USER_REQUEST}}, {{CODE_EDIT_SUMMARY}})
│
├── orchestrator/           Core workflow engine
│   ├── realRun.ts          Main orchestration loop + state transitions
│   ├── dryRun.ts           XState v5 mock-backed planning/execution smoke pipeline
│   ├── approval.ts         Approval queue/controller for agent tool requests
│   ├── audit.ts            Append-only JSONL audit trail
│   ├── planMarkdown.ts     Plan validation/repair helpers
│   ├── finalization.ts     Terminal durability checks + runtime cleanup
│   ├── agentProcessRegistry.ts  Live agent-child PID/PGID registry for stop escalation
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
│   ├── checkpoint.ts       Zod-validated checkpoint with atomic write + backup
│   └── recovery.ts         Actionable-work detection + review metadata sync
│
├── config/                 Configuration
│   ├── schema.ts           OpenWeftConfig Zod schema (strict)
│   └── loadConfig.ts       cosmiconfig loader
│
├── git/                    Git operations
│   └── worktrees.ts        Worktree lifecycle, dirty-tree-safe --no-ff merge, conflict handling, gc
│
├── status/                 Runtime diagnostics + status rendering
│   ├── renderStatus.ts     Non-TTY status report + diagnostic lines
│   ├── terminalCopy.ts     Shared health/meaning/next-action copy
│   └── runtimeDiagnostics.ts HEAD, checkpoint, merge durability, and Codex-home checks
│
├── ui/                     Ink TUI and onboarding surfaces
│   ├── App.tsx             Dashboard, completion, history, and model flows
│   ├── AgentCard.tsx       Compact agent rows + selected detail behavior
│   ├── StatusBar.tsx       Health/model/effort/phase strip
│   └── onboarding/         First-run setup wizard and launch decision
│
├── notifications/          Runtime notification hooks
├── tmux/                   tmux session integration
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
│   Brief Compiler     │     Meta-prompt (production-grade)
│                      │     Tells the agent how to write a Work Brief:
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
│    Work Brief        │     The actual worker operating brief
│                      │     Persisted to feature_requests/briefs/
│  Contains:           │     Inspectable, durable, recoverable
│  • Codebase context  │
│  • Execution brief   │     This is what Stage 2 runs.
│  • Planning rubric   │     Not a one-liner. A full operating document.
│  • Safety boundaries │
└─────────────────────┘
```

**Stage 1 (S1):** the Brief Compiler runs against your request. Output: a Work Brief — the detailed worker operating brief persisted under `feature_requests/briefs/`.

**Stage 2 (S2):** the Work Brief runs against the codebase. Output: a full Markdown plan persisted under `feature_requests/*.md` with a `## Manifest` block (files to create/modify/delete) and a `## Ledger` (constraints, assumptions, watchpoints, validation).

The Stage 2 plan is what gets structurally validated:

- **Manifest** must parse as `{ create: string[], modify: string[], delete: string[] }`. If JSON is malformed, OpenWeft tries `jsonrepair`, then `JSON5.parse`, then optionally falls back to the last known good manifest.
- **Manifest provenance** is preserved. `json`, `jsonrepair`, and `json5` are current enough to schedule; `last-known-good` is stale provenance and moves the feature to review instead of execution.
- **Ledger** validation requires a `## Ledger` section with reconstructible `Constraints`, `Assumptions`, `Watchpoints`, and `Validation` labels. Those labels may appear as h3 headings, tolerated case/singular variants, repeated ledger sections, or semantic bullet/list labels.

The Work Brief artifact is saved to `feature_requests/briefs/` and the validated plan is saved to `feature_requests/*.md`. If a session degrades or the process crashes, both survive. Recovery resumes from durable artifacts: checkpoint state, the Work Brief, and the plan. It does not depend on transient model memory.

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

OpenWeft owns all worktree lifecycle — creation, cleanup, merge, and garbage collection. Workers are explicitly instructed to never create additional worktrees, clone the repo, or create ad hoc branches. The default Work Brief contract and execution prompt include this boundary:

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

OpenWeft's own runtime artifacts never ride along in feature work: worktree creation registers `.openweft/` in the repository's shared `info/exclude` (which linked worktrees inherit), `commitAllChanges` unstages any `.openweft` paths before committing, and worktree status summaries filter runtime paths — so artifact-only changes can never satisfy the did-the-agent-do-work check.

### Reuse detection

On resume, OpenWeft checks whether a managed worktree already has a reusable completion commit (`openweft: complete feature <id>`) or whether that feature was already merged. Reusable completions are queued for merge recovery instead of re-execution; already-merged features are marked complete and can still restore deferred re-analysis state. No wasted compute on work that already succeeded.

Reuse detection survives messy interruption states: an in-progress merge left in the managed worktree is aborted before evaluation, and a completion commit is recognized even when later merge-resolution commits sit on top of it. Ancestry and merged-ness checks use `rev-list --count` rather than `merge-base --is-ancestor`, because simple-git cannot distinguish that command's exit-code answer from success.

### Cleanup

Successful feature merges remove that feature's managed worktree and attached branch immediately. At startup, `pruneOrphanedOpenWeftArtifacts` removes orphaned managed worktrees and stray directories while retaining checkpoint-active or unresolved artifacts. Detached retained OpenWeft branches are preserved rather than silently deleted.

Pruning is guarded against data loss in two ways. A branch with commits not merged into the base is never force-deleted, even when no checkpoint records it (the operator may have deleted state; the work is still real). And retention keys on deterministic branch/worktree names in addition to checkpoint records, with branch/worktree identity persisted to the checkpoint at worktree creation rather than at phase settlement — so a crash mid-phase cannot leave finished work unrecorded and prunable.

Auto-gc is temporarily disabled during heavy worktree operations to avoid git pauses. If a process dies while auto-gc is disabled, startup restores the previous `gc.auto` value from the OpenWeft breadcrumb before doing new work.

### Codex worker homes

Codex-backed turns run with isolated `CODEX_HOME` directories under `.openweft/codex-home/`. OpenWeft prepares each worker home from a minimal deterministic config:

- `approval_policy = "never"`
- the requested sandbox mode
- only the active worker `cwd` trusted
- subscription auth copied only when `auth.json` is needed and present

Worker homes do not inherit personal `mcp_servers`, `notify`, plugin, skill, or unrelated trusted-project configuration from the operator's Codex home. By default, successful runs clean `.openweft/codex-home/`; set `runtime.codexHomeRetention` to `preserve` when you want to inspect those homes after a run.

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
                                  supports --dry-run
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
  effortLevel?: string     // codex: low|medium|high|xhigh; claude: low|medium|high|max
  // ...
}
```

`idleTimeoutMs` is carried on command specs as a scheduling hint, but `createExecaCommandRunner()` does not currently enforce client-side idle or wall-clock termination. Long Codex/Claude turns are allowed to finish unless the surrounding process is stopped.

### Result (discriminated union)

```typescript
AdapterSuccess {
  ok: true
  backend: 'codex' | 'claude' | 'mock'
  sessionId: string | null
  finalMessage: string           // agent output
  model: string
  usage: {
    inputTokens, outputTokens,
    totalCostUsd: number | null  // legacy adapter field, not displayed
  }
  costRecord: CostRecord
  artifacts: AdapterRunArtifacts
}

AdapterFailure {
  ok: false
  backend: 'codex' | 'claude' | 'mock'
  sessionId: string | null       // best effort on provider failures
  model: string
  error: string
  classified: {
    tier: 'transient' | 'agent' | 'fatal'
    reason: string
  }
  artifacts: AdapterRunArtifacts
}

AdapterRunArtifacts {
  stdout, stderr, exitCode,
  signal?, errorCode?, errorMessage?,
  failed?, spawnFailure?,
  command
}
```

Pattern: `if (result.ok) { ... } else { ... }`. No exception-based flow control.

`runner.ts` catches execa spawn failures and returns `ok: false` adapter results with command metadata instead of letting missing commands collapse into success. Fatal setup failures include missing commands, undefined exits, authentication failures, permission errors, `EACCES`, `EPERM`, and local disk/config/template failures. Transient failures are retried with backoff, agent failures can take the normal retry path, and fatal failures halt without consuming full feature rerun budget.

---

## Checkpoint and recovery

OpenWeft is designed to survive crashes, power loss, `Ctrl+C`, and process kills.

### Schema

The checkpoint is a Zod-validated JSON blob (schema version `1.0.0`, strict — no extra properties allowed):

```typescript
OrchestratorCheckpoint {
  schemaVersion:    '1.0.0'
  runId:            string (UUID, unique per orchestration session)
  checkpointId:     string (UUID for this checkpoint lineage)
  orchestratorVersion, configHash, createdAt, updatedAt
  status:           'idle' | 'in-progress' | 'paused'
                    | 'completed' | 'failed' | 'stopped'
  currentState:     'idle' | 'planning' | 'executing' | 'merging'
                    | 're-analysis' | 'queue-management' | 'stopped'
  currentPhase:     { index, name, featureIds, startedAt } | null
  queue:            { orderedFeatureIds, totalCount }
  features:         Record<featureId, FeatureCheckpoint>
  pendingRequests:  Array<{ request, queuedAt }>
  approvalState:    { firstApprovalSatisfied, approvedFeatureIds }
  pendingMergeSummaries: Array<{ featureId, summary }>
  review:           { planningNeedsReviewFeatureIds,
                      adjustmentNeedsReviewFeatureIds,
                      blockedFeatureIds,
                      lastReviewReason }
  cost:             { totalInputTokens, totalOutputTokens,
                      totalEstimatedUsd, perFeature: Record<...> }
                    // legacy field name; UI/status render tokens only
}
```

Each feature tracks:

```typescript
FeatureCheckpoint {
  id, title, request, status, attempts,
  planFile, promptBFile, evolvedPlanFile,
  branchName, worktreePath, sessionId, sessionScope, backend,
  manifest, manifestRecoveryMethod, manifestConfidence,
  reviewReason, blockedByFeatureIds,
  priorityScore, priorityTier, scoringCycles,
  rerunEligible, mergeResolutionAttempts,
  mergeCommit, lastError, updatedAt
}
```

Feature status is one of:

```
pending | planned | executing | completed | failed | skipped
planning-needs-review | adjustment-needs-review | blocked-by-failed-feature
```

The review/blocked statuses are explicit operator states. They remain backward-compatible with older checkpoints because the new fields are optional/defaulted, but they are not execution-ready states.

`checkpointId` is created with the checkpoint and is not the per-write freshness signal; `updatedAt` changes on checkpoint saves. `promptBFile` is a legacy checkpoint field name kept for checkpoint compatibility. New artifacts use Work Brief language and `.work-brief.md` filenames.

### Atomic write with backup

```
saveCheckpoint:
  1. Read current checkpoint.json if it exists
  2. If current exists, copy current → checkpoint.json.backup
  3. If current is missing, seed checkpoint.json.backup from the new checkpoint
  4. Write new → checkpoint.json (via write-file-atomic)

loadCheckpoint:
  1. Try checkpoint.json (Zod parse)
  2. If invalid → try checkpoint.json.backup
  3. If both invalid → throw
  4. If both missing → return null (fresh start)
```

Backup write failures warn but do not block the primary atomic write. Loading fails closed when the primary is corrupt and no valid backup exists.

### Recovery on resume

When `openweft start` or `openweft resume` resumes from a checkpoint:

```
If checkpoint.status === 'stopped' and actionable unfinished work exists:
  → reopen to 'in-progress'
  → audit run.resumed_from_stopped

For each planned/executing/retryable failed feature:
  → Check if worktree/branch has completion commit
    → already merged: mark 'completed' and restore deferred re-analysis if needed
    → reusable:       queue for merge recovery instead of re-execution
    → not reusable:   planned/retryable features execute normally

For executing features without reusable work:
  → reset to 'planned'
  → rerun from persisted Work Brief and plan

For review/blocked features:
  → keep as unresolved operator work
  → exclude from execution until repaired
```

Before actionable features execute, OpenWeft verifies the Work Brief artifact pointer and repairs it from the canonical Work Brief path when possible. If the Work Brief artifact is missing for an actionable feature, resume fails clearly instead of guessing.

In-flight features that died mid-execution get reset to `planned`. They re-run from the persisted Work Brief and plan file, not from broken agent context. This is intentional: clean re-execution beats attempting to resurrect a half-finished session.

### Finalization

At the end of a real run, `finalizeRun()` collects runtime diagnostics before writing the terminal audit event. It checks:

- current `HEAD`
- primary and backup checkpoint timestamps
- whether recorded merge commits for completed features are reachable from final `HEAD`
- whether `.openweft/codex-home/` still exists and how much residue it contains

If a run reaches `completed` but merge durability fails, OpenWeft marks affected features and the run as `failed`. If Codex-home cleanup fails under the default `on-success-clean` policy, finalization also downgrades the run instead of reporting a false success.

---

## Usage tracking

Every agent call records input and output token counts. The normal CLI and TUI render token usage only.

### Usage stages

```
planning-s1          Work Brief generation
planning-s2          Plan generation from Work Brief
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

Canonical writes use a header plus JSON records. The parser also accepts comments, blank lines, and plain-English pending lines under the v1 header for operator convenience; the next rewrite canonicalizes pending/processed work back to v1 JSON records.

Queue writes are clobber-safe: the orchestrator re-reads `queue.txt` immediately before each rewrite and applies its single-line mutation against fresh content (skipping with a warn audit if the line vanished), so `openweft add` during a multi-minute planning pass survives — and gets planned in the same pass. The planning-crash rebuild likewise unions checkpoint pending state with on-disk pending lines, deduplicated by normalized request text.

Pending requests become processed after planning produces either a validated plan or a durable review checkpoint for that feature. OpenWeft does not mark a line processed merely because planning started.

### Multiline requests

v1 JSON records store the request string directly; JSON escaping handles newlines. The `@@openweft:request:v1:` base64url wrapper remains supported for legacy/plain queue lines, especially requests containing newlines, starting with `#`, or starting with the encoded-request prefix:

```
@@openweft:request:v1:<base64url-encoded-utf8>
```

Decoded transparently on parse, then canonicalized to JSON on rewrite.

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

Every validated plan contains a parser-compatible `## Ledger` section. The prompts ask for a rich execution ledger, but the structural validator enforces the four required semantic anchors: constraints, assumptions, watchpoints, and validation. OpenWeft persists the plan in `feature_requests/*.md`, mirrors it in `.openweft/shadow-plans/`, and syncs copies into worktrees during execution. Not a log dump. A narrative.

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

The Prompt A/Work Brief contract asks each step in the plan to use this schema:

```
- Step ID, title
- Dependencies (which prior steps must complete)
- Risk level
- Rollback notes (how to undo if it breaks)
- Validation criteria (how to verify it worked)
- Status (`Not Started`, `In Progress`, `Blocked`, `Complete`)
```

OpenWeft's structural validator does not parse every step row. It enforces the parser-compatible ledger anchors and manifest; the richer step schema is a prompt/work-protocol contract that keeps generated plans reviewable and executable.

The plan ledger survives context loss because the canonical plan file is persisted on disk and promoted forward after successful execution/merge. Recovery uses the checkpoint plus the saved plan, not the model's memory.

If execution updates the worktree plan but merge or reconciliation fails, OpenWeft can preserve that updated plan in `.openweft/evolved-plans/<featureId>.md` without promoting it to the canonical feature plan or shadow plan.

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
     │           │            │
     │           │            └──► failed (retry if rerunEligible)
     │           │
     │           ├──► planning-needs-review
     │           ├──► adjustment-needs-review
     │           ├──► blocked-by-failed-feature
     │           └──► skipped
```

`planning-needs-review`, `adjustment-needs-review`, and `blocked-by-failed-feature` are unresolved operator states. They preserve context and next-action information instead of pretending unsafe work is either executable or cleanly skipped.

Run statuses:

```
  idle ──► in-progress ──► completed
               │
               ├──► paused (legacy threshold hit)
               ├──► stopped (phase-safe user stop)
               └──► failed (unresolved failed/review work or finalization failure)
```

---

## Configuration

Config loads via [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig), with discovery explicitly bounded: the upward search stops at the enclosing git repository root (`.git` directory or file, so worktrees bound correctly), or at the nearest `package.json` outside a repo, and home/XDG global locations are never consulted. A loaded config resolving outside the current repository is refused with an error naming the config path and the would-be `repoRoot` — destructive git operations can never be redirected by an ancestor or `$HOME` config. The checkpoint's `configHash` guard only blocks resume while the checkpoint itself has actionable unfinished work (pure pending queue lines don't trigger it), and the hash is refreshed when a run completes. Verified config forms include `.openweftrc.json`, `.openweftrc.yaml`, `openweft.config.js`, `openweft.config.cjs`, and the `openweft` key in `package.json`. JS config syntax follows Node package mode: CommonJS packages can use `module.exports = { ... }` in `openweft.config.js`; `type: "module"` packages should use `export default { ... }` in `openweft.config.js` or `module.exports = { ... }` in `openweft.config.cjs`.

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
status:
  usageDisplay:       'tokens' | 'estimated-cost' (default: 'tokens')
runtime:
  codexHomeRetention: 'on-success-clean' | 'preserve' (default: 'on-success-clean')
budget:
  warnAtUsd:          number | null (default: null)
  pauseAtUsd:         number | null (default: null)
  stopAtUsd:          number | null (default: null)
```

---

## What gets written to disk

```
your-repo/
├── feature_requests/
│   ├── queue.txt                    Your requests (v1 JSON format)
│   ├── 001_add-password-reset.md    Generated plan with ## Manifest + ## Ledger
│   ├── 002_refactor-auth.md
│   └── briefs/
│       ├── 001_add-password-reset.work-brief.md    Work Brief artifact
│       └── 002_refactor-auth.work-brief.md
│
├── prompts/
│   ├── prompt-a.md                  Your Prompt A template
│   └── plan-adjustment.md           Your plan adjustment template
│
├── skills/
│   └── openweft-work-protocol/
│       ├── SKILL.md                 Repo-local worker protocol skill
│       └── references/
│           └── canonical-openweft-work-protocol.md
│
├── .openweft/
│   ├── checkpoint.json              Orchestrator state (Zod-validated)
│   ├── checkpoint.json.backup       Backup sibling (atomic)
│   ├── costs.jsonl                  Token usage per call (legacy filename)
│   ├── audit-trail.jsonl            Append-only audit entries for real runs
│   ├── output.log                   --bg mode output
│   ├── pid                          Run-identity record (pid + start time + marker; all run modes)
│   ├── agent-pids.json              Live agent-subprocess registry (pid/pgid per child)
│   ├── worktrees/                   Git worktrees (one numeric dir per feature)
│   ├── shadow-plans/                Canonical internal plan mirrors
│   ├── evolved-plans/               Worktree-promoted plan copies awaiting promotion or cleanup
│   ├── codex-home/                  Minimal isolated Codex worker homes
│   └── dry-run-workspaces/          Scratch workspaces for --dry-run
│
└── .openweftrc.json                 Configuration
```

Everything important to runtime and recovery is inspectable on disk while a run is active or preserved for debugging. Some runtime residue, especially `.openweft/codex-home/`, is cleaned after successful runs by default.

---

## Design principles

**Work Briefs are first-class.** They are persisted, inspectable, and durable. Not disposable glue between stages.

**OpenWeft owns topology.** Workers never create worktrees, clone repos, or switch branches. Git infrastructure is orchestration, not intelligence.

**Real diffs beat declared intent.** The actual repository changes are the final truth. Worker-reported manifests are useful signals, not gospel.

**Separate cognition from orchestration.** Work Briefs guide the model's thinking and execution. OpenWeft schedules and reconciles. Neither tries to do the other's job.

**Simplicity is role clarity.** Three layers, three jobs: the Brief Compiler writes the Work Brief, the Work Brief drives the feature plan and execution, and OpenWeft controls orchestration.

---

## CLI commands

```
openweft                setup wizard (first run) · dashboard (returning)
openweft init           config, directories, prompt files, work protocol skill
openweft add "feature"  queue a request (also accepts stdin)
openweft start          run the queue with interactive dashboard
openweft resume         alias for start; resumes through the same checkpoint path
openweft start --model <model>  run once with a model override
openweft start --effort <level> run once with a reasoning effort override
openweft start --bg     detach — PID tracked, logs to .openweft/output.log
openweft start --stream stream raw agent output to terminal
openweft start --tmux   launch in a tmux session
openweft start --dry-run mock planning/execution smoke; no real git merges
openweft status         queue state, tokens, feature breakdown
openweft stop           request a phase-safe stop for a background run
```

Every run mode — background, streamed, and the interactive TUI — records a run-identity PID file (`{pid, startedAt, argvMarker, processStartTime}`) under `.openweft/`, giving all modes the same concurrent-run guard and stop path. `openweft status` verifies process identity (kernel start time) before reporting "running"; a recycled or foreign PID renders as stale and is never signaled, and a checkpoint left `in-progress` with no live process renders as **Interrupted** with resume guidance. `openweft stop` waits for a phase-safe checkpoint and escalates only after timeout — and escalation SIGTERMs/SIGKILLs the registered agent subprocess groups (agents spawn detached in their own process groups on POSIX) before force-killing the orchestrator, so no orphaned codex/claude process keeps mutating the repo after "stopped". Runs that end `failed` exit non-zero in every mode, including dry runs and the TUI. `--tmux` launches a monitored tmux session and cannot be combined with `--bg`.

---

## Release readiness

`npm run release:check` is the package/repo gate. It runs typecheck, tests, build, packaged installed-CLI smoke, and `npm publish --dry-run`. CI pins npm `11.6.0`, matching `packageManager`.

Live provider readiness is separate from the package gate:

```
OPENWEFT_LIVE_SMOKE_TIMEOUT_MS=<timeout> npm run smoke:live:codex:resume
npm run smoke:live:claude
```

Claim Codex-ready only after the Codex resume smoke passes in the current release window. Claim Claude-ready only after the Claude smoke passes. Claim both-backend readiness only when both live smokes pass in the same release window.

---

## Test coverage map

- `tests/domain/` covers manifest parsing/ledger tolerance, scoring, phases, queue parsing, and pure domain behavior.
- `tests/state/` covers checkpoint validation, backup fallback, first-save backup seeding, and recovery helpers.
- `tests/adapters/` covers Codex, Claude, mock, runner spawn failures, session extraction, and error classification surfaces.
- `tests/git/` covers worktree lifecycle, merge safety, conflict/autostash behavior, orphan pruning, and retained branch handling.
- `tests/orchestrator/` covers real-run planning, scoring/phasing, execution/merge/re-analysis, continue-unrelated policy, stop/resume, finalization, and checkpoint durability behavior.
- `tests/status/`, `tests/ui/`, and `tests/cli/` cover shared terminal copy, status rendering, dashboard/onboarding affordances, command handling, and background status behavior.
- `tests/e2e/` covers CLI dry-run, mock-backed real runs, and background flows.
- `tests/release/` covers release gate expectations, runtime version wiring, live-smoke helpers, wizard recording, and asciicast normalization.

---

## TypeScript conventions

- ESM-only (`"type": "module"`), Node.js `>=24`, target `ES2023`
- `moduleResolution: "NodeNext"` — all local imports require `.js` extension
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `exactOptionalPropertyTypes: true` — `undefined` must be explicit in optional props
- `noUncheckedIndexedAccess: true` — indexed access returns `T | undefined`
- All Zod schemas use `.strict()` — no extra properties allowed
- Discriminated unions (`ok: true | false`) for adapter results — no exception-based flow control
