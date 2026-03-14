# OpenWeft — fire-and-forget AI agent orchestration

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/banner-light.svg">
    <img alt="OpenWeft" src="docs/banner-dark.svg" width="100%">
  </picture>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/hero-light.svg">
    <img alt="OpenWeft terminal demo" src="docs/hero-dark.svg" width="100%">
  </picture>
</p>

**If you're running multiple AI coding agents by hand — creating worktrees, pasting prompts into tmux panes, checking each one, merging, realizing one broke another's assumptions, re-planning, and pasting updated context back into the survivors — you are the bottleneck in your own pipeline.**

OpenWeft removes you from the loop.

<p align="center">
  <a href="https://www.npmjs.com/package/openweft"><img src="https://img.shields.io/npm/v/openweft?style=for-the-badge&color=cb3837" alt="npm"></a>
  <a href="https://github.com/NeuraCerebra-AI/openweft/actions"><img src="https://img.shields.io/github/actions/workflow/status/NeuraCerebra-AI/openweft/ci.yml?branch=main&style=for-the-badge" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT"></a>
</p>

It's a CLI that takes a batch of feature requests, turns each one into a strict plan, figures out which ones conflict, runs the safe ones in parallel across isolated worktrees, merges in priority order, re-plans everything that's left against the updated codebase, and keeps going until the queue is empty.

You write a list. You walk away. You come back to commits.

```bash
npm install -g openweft
openweft init
$EDITOR feature_requests/queue.txt    # write your requests, one per line
openweft start --bg                   # go do literally anything else
```

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
node dist/bin/openweft.js --help
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
# Set up the project
openweft init

# Look at the starter prompts (you'll want to edit these)
$EDITOR prompts/prompt-a.md
$EDITOR prompts/plan-adjustment.md

# Queue some work
openweft add "add password reset flow"
openweft add "refactor auth middleware for oauth2"
openweft add "add audit log export"

# Or just write a list
$EDITOR feature_requests/queue.txt

# Let it rip
openweft start --bg

# Check in whenever
openweft status
```

---

## How it works

1. OpenWeft reads pending requests from `feature_requests/queue.txt`.
2. Each request goes through a two-stage planning workflow: Prompt A produces Prompt B, Prompt B produces a feature plan with a strict file manifest.
3. Plans are scored by blast radius and estimated AI success likelihood. The queue stabilizes so it doesn't thrash between re-scores.
4. Non-conflicting features (different files) are grouped into parallel phases. Conflicting features (same files) wait their turn.
5. Each feature executes in its own git worktree with its own agent session. No `index.lock` fights. No context bleed.
6. After a phase merges, every remaining plan is re-evaluated against the changed codebase. Then the next phase starts.

The loop runs until the queue is empty or you tell it to stop.

---

## What you see

```
$ openweft status

  State: executing (phase 2 of 4)
  PID: 38291 (background)
  Features: 3 active · 2 pending · 3 done

  Tokens: 847,203 input · 312,456 output
  Estimated cost: $2.14
```

---

## Commands

```
openweft init                  set up config, directories, starter prompts
openweft add "feature"         queue a request (also accepts stdin)
openweft start                 run the queue (foreground, progress output)
openweft start --bg            detached, PID tracked, logs to .openweft/output.log
openweft start --stream        stream raw backend output to your terminal
openweft start --tmux          spawn a tmux session; falls back if tmux is missing
openweft start --dry-run       full pipeline against the mock adapter, no cost
openweft status                queue state, PID, tokens, cost
openweft stop                  finish the current phase, then stop
```

---

## Prompt files

OpenWeft needs two user-maintained prompt files. `openweft init` creates starter versions of both.

- `prompts/prompt-a.md` — must contain `{{USER_REQUEST}}`
- `prompts/plan-adjustment.md` — must contain `{{CODE_EDIT_SUMMARY}}`

Prompt A drives stage 1. Its output is Prompt B, which is generated at runtime and fed into stage 2. Stage 2 produces the actual feature plan.

**Minimal Prompt A:**

```md
You are preparing a planning prompt for a coding agent.

User request:
{{USER_REQUEST}}

Return a Prompt B that tells the next agent to produce a compact Markdown feature plan with:
- a short request summary
- 3-5 implementation steps
- a `## Manifest` section containing a strict JSON manifest code block with `create`, `modify`, and `delete` arrays
- targeted validation steps

Prefer the smallest safe change set.
```

**Minimal Plan Adjustment:**

```md
Review these merged edits:
{{CODE_EDIT_SUMMARY}}

Investigate whether they interfere with the referenced feature plan.
If they do, update the plan file in place, including the manifest.
If they do not, leave the plan unchanged.
Do not modify source files during this adjustment step.
```

These are starting points. The quality of your prompts directly determines the quality of the plans. Invest here.

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

If you kill the process, reboot, lose power, or `Ctrl+C` at the worst possible moment — `openweft start` reads the checkpoint and picks up from the last phase boundary. That's what the checkpoint is for.

---

## Architecture (for the curious)

```
queue.txt / openweft add
        |
        v
  Plan Creation (two stages)
  Prompt A --> Prompt B --> Plan + Manifest
        |
        v
  Scoring + Phasing
  blast radius × success likelihood
  EMA dampening · hysteresis · tier buckets
  manifest overlap --> conflict-safe groups
        |
        v
  Execution
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

## Development

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Release gate (single command):

```bash
npm run release:check
```

This runs typecheck, tests, build, and `npm publish --dry-run` in one shot.

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

## Publishing

```bash
npm run release:check
npm publish
```

---

## Why "OpenWeft"?

A weft is the horizontal thread on a loom. It runs through the vertical warp threads and binds them into fabric. Without it, you just have a bunch of parallel strings that don't hold together.

That's the job.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
