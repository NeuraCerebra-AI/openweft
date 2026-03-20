# OpenWeft — fire-and-forget AI agent orchestration

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="./docs/banner-light.svg">
    <img alt="OpenWeft" src="./docs/banner-dark.svg" width="100%">
  </picture>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/hero-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="./docs/hero-light.svg">
    <img alt="OpenWeft terminal demo" src="./docs/hero-dark.svg" width="100%">
  </picture>
</p>

**If you're running multiple AI coding agents by hand — creating worktrees, pasting prompts into tmux panes, checking each one, merging, realizing one broke another's assumptions, re-planning, and pasting updated context back into the survivors — you are the bottleneck in your own pipeline.**

OpenWeft removes you from the loop.

OpenWeft is for people who already have a list of things they want to add, fix, or refactor, but do not want to spend their day babysitting Codex or Claude Code across multiple terminals, worktrees, and merge decisions.

<p align="center">
  <!-- Enable after first public npm publish:
  <a href="https://www.npmjs.com/package/openweft"><img src="https://img.shields.io/npm/v/openweft?style=for-the-badge&color=cb3837" alt="npm"></a>
  -->
  <!-- Enable after the public repo/workflow badge resolves:
  <a href="https://github.com/NeuraCerebra-AI/openweft/actions"><img src="https://img.shields.io/github/actions/workflow/status/NeuraCerebra-AI/openweft/ci.yml?branch=main&style=for-the-badge" alt="CI"></a>
  -->
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT"></a>
</p>

It's a CLI that takes a batch of feature requests, turns each one into a strict plan, figures out which ones conflict, runs the safe ones in parallel across isolated worktrees, merges in priority order, re-plans everything that's left against the updated codebase, and keeps going until the queue is empty.

You write a list. You walk away. You come back to commits.

```bash
npm install -g openweft
openweft                              # first run launches the setup wizard
```

First run in a terminal launches an interactive setup wizard — it detects your installed backends, initializes the project, and lets you type your first feature request. One flow, no manual config. For returning users, `openweft` opens the dashboard with your queue visible — press `s` to start execution when you're ready.

---

## Install

### npm (recommended)

```bash
npm install -g openweft
```

### From GitHub

```bash
npm install -g github:NeuraCerebra-AI/openweft
```

Builds on install. No `dist/` in the repo.

### From source

```bash
git clone https://github.com/NeuraCerebra-AI/openweft.git
cd openweft
npm install
npm link
npm run openweft -- --help
```

If you want it to behave like `codex` or `claude` so you can just type `openweft` in any new terminal, `npm link` is the source-repo workflow:

```bash
git clone https://github.com/NeuraCerebra-AI/openweft.git
cd openweft
npm install
npm link

# now available by name
openweft --help
```

If you do not want to link it globally, you can still run it directly from source:

```bash
npm run openweft -- --help
```

To run OpenWeft from source against another repo without installing it globally:

```bash
# terminal 1
cd /path/to/openweft
npm install

# terminal 2
cd /path/to/the-project-you-want-to-orchestrate
node /path/to/openweft/node_modules/tsx/dist/cli.mjs /path/to/openweft/src/bin/openweft.ts init
node /path/to/openweft/node_modules/tsx/dist/cli.mjs /path/to/openweft/src/bin/openweft.ts add "your feature request"
node /path/to/openweft/node_modules/tsx/dist/cli.mjs /path/to/openweft/src/bin/openweft.ts start
```

## Requirements

- Node.js `>=24`
- Git
- One or both of:
  - `codex`, already logged in
  - `claude`, already logged in

OpenWeft uses your existing CLI sessions. Subscription-first by default. No separate API keys unless you want them.

---

## Quick start

```bash
# First run — wizard handles everything
openweft

# Queue more work
openweft add "add password reset flow"
openweft add "refactor auth middleware for oauth2"
openweft add "add audit log export"

# Or just write a list
$EDITOR feature_requests/queue.txt

# Let it rip in a real TTY for the interactive dashboard
openweft

# Or detach it
openweft start --bg

# Check in whenever
openweft status
```

## In one minute

1. Run `openweft`
2. Complete the setup wizard
3. Add one or more coding requests
4. Start execution
5. OpenWeft plans, phases, runs, merges, and re-checks what remains
6. You come back to commits, logs, and a durable checkpoint if anything was interrupted

---

## How it works

1. OpenWeft reads pending requests from `feature_requests/queue.txt`.
2. Prompt A compiles each request into Prompt B, a powerful worker brief rather than a tiny helper prompt, and OpenWeft persists that Prompt B artifact for inspection and recovery.
3. OpenWeft launches Prompt-B workers inside isolated git worktrees that OpenWeft owns and controls.
4. Each worker investigates the assigned codebase, edits code, validates its work, and maintains its execution ledger inside that assigned workspace.
5. OpenWeft compares the real outcomes, including actual diffs and touched files, decides what is compatible, and merges the safe results in order.
6. After merges land, OpenWeft re-evaluates what remains against the new repository state and keeps going until the queue is empty.

The loop runs until the queue is empty or you tell it to stop.

For the full target design, see [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/prompt-b-first-migration-plan.md](./docs/prompt-b-first-migration-plan.md). The current runtime still contains some legacy plan-first seams while converging toward that Prompt-B-first architecture.

---

## What you see

```
$ openweft status

Status: completed
Machine State: idle
Background: not running
Pending Queue: 0
Processed Queue Entries: 1
Features: 1 total (1 completed)
Cost: $0.246549 (129221 input / 1458 output tokens)
Executing: none
Planned: none
Failed: none
Completed:
  [001] Add a multiply function to index.js (high 0.693)
```

---

## Commands

```
openweft                       first run: interactive wizard · returning: opens dashboard, press s to start
openweft init                  set up config, directories, starter prompts
openweft add "feature"         queue a request (also accepts stdin)
openweft start                 run the queue in the foreground; in a real TTY this opens the interactive dashboard
openweft start --bg            detached, PID tracked, logs to .openweft/output.log
openweft start --stream        stream raw backend output to your terminal
openweft start --tmux          spawn a tmux session; falls back if tmux is missing
openweft start --dry-run       full pipeline against the mock adapter, no cost
openweft status                queue state, tokens, cost, feature breakdown
openweft stop                  finish the current phase, then stop
```

---

## Prompt files

OpenWeft needs two user-maintained prompt files. `openweft init` creates starter versions of both.

- `prompts/prompt-a.md` — must contain `{{USER_REQUEST}}`
- `prompts/plan-adjustment.md` — must contain `{{CODE_EDIT_SUMMARY}}`

Prompt A is a compiler for Prompt B. Prompt B is the worker brief that tells the downstream agent how to investigate, execute carefully, maintain its ledger, validate its work, and stay inside the OpenWeft-assigned workspace. OpenWeft owns worktree creation, queue control, compatibility decisions, and merges.

Generated Prompt B artifacts are persisted under `feature_requests/briefs/` so they are durable, inspectable, and tied to feature IDs.

The important boundary is:

- Prompt A shapes the worker
- Prompt B performs the work
- OpenWeft owns topology and reconciliation

If you are tuning prompts, optimize for stronger Prompt-B workers, not for making Prompt A look short or elegant.

**Minimal Prompt A:**

```md
You are preparing a planning prompt for a coding agent.

User request:
{{USER_REQUEST}}

Return a Prompt B that tells the next agent to produce a compact Markdown feature plan with:
- a short request summary
- 3-5 implementation steps
- a `## Ledger` section covering constraints, assumptions, watchpoints, and validation
- a `## Manifest` section containing a strict JSON manifest code block with `create`, `modify`, and `delete` arrays
- targeted validation steps
- explicit instructions to use the current assigned repository/worktree only and not create additional git worktrees, clones, sibling checkouts, or ad hoc branches unless explicitly instructed by the orchestrator

Prefer the smallest safe change set.
```

**Minimal Plan Adjustment:**

```md
Review these merged edits:
{{CODE_EDIT_SUMMARY}}

Investigate whether they interfere with the referenced feature plan.
Use the `## Ledger` section to preserve or update constraints, assumptions, watchpoints, and validation.
If they do, return the updated full plan markdown, including the `## Ledger` and `## Manifest` sections.
If they do not, return the original plan unchanged.
Do not modify source files during this adjustment step.
```

These are starting points. The quality of your prompts directly determines the quality of the plans. Invest here.

More specifically: the quality of Prompt A determines the quality of Prompt B, and Prompt B is where most of the system's horsepower lives.

---

## Configuration

`openweft init` writes `.openweftrc.json`. Config loads via [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig), so `.openweftrc`, `.openweftrc.yaml`, `openweft.config.js`, or the `openweft` key in `package.json` all work.

<details>
<summary>Default config</summary>

```json
{
  "backend": "codex",
  "auth": {
    "codex": { "method": "subscription" },
    "claude": { "method": "subscription" }
  },
  "prompts": {
    "promptA": "./prompts/prompt-a.md",
    "planAdjustment": "./prompts/plan-adjustment.md"
  },
  "featureRequestsDir": "./feature_requests",
  "queueFile": "./feature_requests/queue.txt",
  "models": {
    "codex": "gpt-5.3-codex",
    "claude": "claude-sonnet-4-6"
  },
  "concurrency": {
    "maxParallelAgents": 3,
    "staggerDelayMs": 5000
  },
  "rateLimits": {
    "codex": {
      "mode": "subscription",
      "maxConcurrentRequests": 3,
      "retryBackoffMs": 5000,
      "retryMaxAttempts": 5
    },
    "claude": {
      "mode": "subscription",
      "maxConcurrentRequests": 2,
      "retryBackoffMs": 5000,
      "retryMaxAttempts": 5
    }
  },
  "budget": {
    "warnAtUsd": null,
    "pauseAtUsd": null,
    "stopAtUsd": null
  }
}
```

</details>

**Auth:**
- `subscription` (default) — uses your existing CLI login
- `api_key` — set the env var in `auth.codex.envVar` or `auth.claude.envVar`

**Budget thresholds** — set `warnAtUsd` (toast), `pauseAtUsd` (stop after current phase), or `stopAtUsd` (hard stop). All null by default because your money is your business.

---

## What OpenWeft writes to disk

Not a mystery. Here's everything:

| Path | What it is |
|---|---|
| `feature_requests/queue.txt` | your requests, one per line. `#` comments. processed lines get `# ✓ [001]` |
| `feature_requests/*.md` | generated plans with manifests |
| `.openweft/checkpoint.json` | resumable orchestrator state |
| `.openweft/costs.jsonl` | append-only cost ledger |
| `.openweft/audit-trail.jsonl` | structured audit log |
| `.openweft/output.log` | `--bg` mode output |

If you kill the process, reboot, lose power, or `Ctrl+C` at the worst possible moment, `openweft start` recovers from the last safe checkpoint boundary and restarts unfinished work safely when needed.

It is designed to recover cleanly, not to resurrect a live in-flight agent session byte-for-byte.

---

## Architecture (for the curious)

```
queue.txt / openweft add
        |
        v
  Worker Brief Creation
  Prompt A --> Prompt B
        |
        v
  Execution + Orchestration
  Prompt B worker --> edits + validation + manifest-backed plan state
        |
        v
  Scoring + Phasing
  blast radius × success likelihood
  EMA dampening · hysteresis · tier buckets
  manifest overlap --> conflict-safe groups
  one git worktree per feature
  one agent session per feature
  CODEX_HOME isolation · staggered launch
  Promise.allSettled barrier
        |
        v
  Merge + Re-plan
  priority-order merge (--no-ff)
  conflict? merge main into worktree, agent resolves
  diff summaries --> plan adjustment for remaining features
  re-score --> re-phase --> next phase
        |
        v
  Queue empty --> toast --> done
```

Three backends behind one adapter interface: Codex, Claude, and mock. The mock powers `--dry-run` and the test suite.

State machine (XState) manages the phase lifecycle. Session chains (not long-lived processes) keep agent context from degrading across phases. Plans on disk are the source of truth — if a session rots, start a fresh one loaded with the plan file.

---

## Best fit

It is a strong fit for:

- batching multiple coding requests that may or may not conflict
- repositories where isolated git worktrees are acceptable
- users already comfortable with Codex CLI or Claude Code
- teams who want durable checkpoints and merge-aware orchestration

## Not best fit

OpenWeft is probably not the right tool for:

- one tiny one-off edit where running an agent directly is faster
- highly interactive pair-programming sessions
- repos with unusual git constraints or very strict branch/worktree policies
- users expecting a polished 1.0 product with zero operational rough edges

---

## Beta promises

OpenWeft is aiming to be:

- reliable enough to trust with real queues
- explicit about what it writes to disk
- conservative about git/worktree ownership
- honest about failure and recovery behavior

It is not yet promising:

- perfect resumption of live in-flight agent sessions
- zero manual review for every repo or workflow
- final 1.0 stability guarantees across all environments

---

## Why "OpenWeft"?

A weft is the horizontal thread on a loom. It runs through the vertical warp threads and binds them into fabric. Without it, you just have a bunch of parallel strings that don't hold together.

That's the job.

---

<details>
<summary>Development</summary>

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest
npm run build          # tsc → dist/
npm pack --dry-run     # verify package contents
```

Release gate (single command):

```bash
npm run release:check  # typecheck + test + build + npm publish --dry-run
```

Fastest local validation:

```bash
openweft start --dry-run
```

Live backend smoke tests:

```bash
npm run smoke:live:codex
npm run smoke:live:codex:resume
npm run smoke:live:claude
```

### Publishing

```bash
npm run release:check
npm publish
```

### Contributing

PRs welcome. Run `npm run release:check` before submitting — it covers typecheck, tests, build, and package validation in one shot.

</details>

## License

MIT
