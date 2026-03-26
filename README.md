# OpenWeft — fire-and-forget AI agent orchestration

<p align="center">
  <picture>
    <img alt="OpenWeft" src="./docs/banner-dark.svg" width="100%">
  </picture>
</p>

<p align="center">
  <picture>
    <img alt="OpenWeft setup wizard" src="./docs/wizard-dark.svg" width="100%">
  </picture>
</p>

<p align="center">
  <picture>
    <img alt="OpenWeft terminal demo" src="./docs/hero-dark.svg" width="100%">
  </picture>
</p>

**AI agents don't fail because they're bad at coding. They fail because no one told them what the other agents are editing.**

OpenWeft sits on top of [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex CLI](https://github.com/openai/codex). You give it a list of stuff to get done. It detects which ones would touch the same code, runs the safe ones in parallel, merges the results, and re-plans the rest.

**You write a list. You walk away. You come back to commits.**

**Good fit:** You have a backlog of features, some of them touch overlapping files, and you want to batch them through Claude Code or Codex without manually coordinating worktrees, merges, and re-plans.

**Not the right tool:** One quick edit (just run Claude Code directly), interactive pair-programming, repos that can't use git worktrees, or anyone expecting a polished 1.0.

<p align="center">
  <a href="https://www.npmjs.com/package/openweft"><img src="https://img.shields.io/npm/v/openweft?style=for-the-badge&color=cb3837" alt="npm"></a>
  <a href="https://github.com/NeuraCerebra-AI/openweft/actions"><img src="https://img.shields.io/github/actions/workflow/status/NeuraCerebra-AI/openweft/ci.yml?branch=main&style=for-the-badge" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT"></a>
</p>

```bash
npm install -g openweft
openweft                              # first run launches the setup wizard
```

First run launches an interactive setup wizard — it detects your installed backends, initializes the project, and lets you type your first feature request. One flow, no manual config. For returning users, `openweft` opens the dashboard — press `s` to start execution.

---

## Install

```bash
npm install -g openweft
```

### From source

```bash
git clone https://github.com/NeuraCerebra-AI/openweft.git
cd openweft
npm install
npm link
openweft --help
```

<details>
<summary>Other install methods</summary>

**Direct from GitHub:**

```bash
npm install -g github:NeuraCerebra-AI/openweft
```

Builds on install. No `dist/` in the repo.

**Run from source without global install:**

```bash
npm run openweft -- --help
```

**Run against another repo without installing globally:**

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

</details>

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

# Let it rip
openweft

# Or detach it
openweft start --bg

# Check in whenever
openweft status
```

---

## How it works

**You queue a request.** OpenWeft reads it from `feature_requests/queue.txt`.

**OpenWeft writes the agent's instructions for you.** Each request gets compiled into a detailed worker brief — not a one-line prompt, but a full operating document that tells the agent to investigate the codebase first, brainstorm 5 approaches, score them by risk, build a structured execution plan, test incrementally, and verify downstream impact before moving on.

**Each feature gets its own isolated workspace.** OpenWeft creates a separate git worktree per feature. Agents can't step on each other because they're working in different copies of the repo.

**Safe features run in parallel. Conflicting ones wait.** OpenWeft analyzes which features would touch the same files. Non-overlapping work runs simultaneously. Everything else gets queued for the next batch.

**Results merge in priority order.** When agents finish, OpenWeft merges their work back using `--no-ff` commits. If there's a conflict, it merges main into the worktree and lets the agent resolve it.

**Every step is recorded.** Each agent writes a Living Plan Ledger — a structured markdown file that captures what was investigated, what changed (with before/after code), what was deferred and why. When it's done, you can read exactly what happened. Not a log dump — a narrative.

**Then the cycle repeats.** After merges land, the codebase has changed. OpenWeft re-evaluates whatever remains against the new state, re-scores, re-phases, and runs the next batch. This continues until the queue is empty.

For the full architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## What agents actually do (the default prompts)

Most orchestrators send the agent a sentence and hope for the best. OpenWeft ships production-grade prompt templates that turn every request into a rigorous execution workflow:

| What | Why it matters |
|---|---|
| **5-approach brainstorming** | The agent evaluates 5 high-level approaches by blast radius, reversibility, and complexity — then 5 implementation strategies within the winner. Not first-idea execution. |
| **Living Plan Ledger** | A structured execution record — step ID, dependencies, risk level, rollback notes, validation criteria, status, before/after code — written to `project_ledgers/` as a readable markdown file. Survives context loss. If the session restarts, the ledger is the source of truth. When a feature finishes, you can open the ledger and see exactly what the agent investigated, changed, and chose not to change. |
| **Downstream Impact Reviews** | Before completing a major step, the agent launches 1–2 verification agents to check whether the edits broke assumptions in later steps. The plan updates before moving on. |
| **4-phase debugging protocol** | Bug-fix requests trigger error sequence analysis → root cause hypothesis scoring → fix strategy with rollback planning → iterative implementation to 95%+ confidence. |
| **Context grounding** | The agent investigates the codebase before planning — file paths, line numbers, code snippets, live documentation via Context7 — so reasoning starts from reality, not assumptions. |

`openweft init` creates both prompt files with these defaults. They're production-grade out of the box — customization is possible but not necessary.

---

## Commands

```
openweft                       setup wizard (first run) · dashboard (returning)
openweft init                  set up config, directories, prompt files
openweft add "feature"         queue a request (also accepts stdin)
openweft start                 run the queue with interactive dashboard
openweft start --bg            detach — PID tracked, logs to .openweft/output.log
openweft start --stream        stream raw agent output to your terminal
openweft start --tmux          launch in a tmux session
openweft start --dry-run       full pipeline with mock adapter, zero cost
openweft status                queue state, tokens, cost, feature breakdown
openweft stop                  finish current phase, then stop
```

```
$ openweft status

Status: completed · Features: 1 total (1 completed)
Cost: $0.246549 (129221 input / 1458 output tokens)
Completed:
  [001] Add a multiply function to index.js (high 0.693)
```

---

## Under the hood

OpenWeft uses a two-stage prompt system internally called **Prompt A** and **Prompt B**. Prompt A is a meta-prompt — it takes your raw request and compiles it into Prompt B, which is the actual detailed worker brief the agent executes. You never touch Prompt B directly. The default Prompt A is production-grade — it ships with 5-approach brainstorming, living plan ledgers, downstream impact reviews, and a 4-phase debugging protocol baked in. It works out of the box. You *can* customize it, but you probably won't need to.

```
  Your request
      │
      ▼
  Prompt A ──► Prompt B (the agent's actual operating instructions)
      │
      ▼
  Score + Phase
  successLikelihood / blastRadius^0.6
  EWMA dampening · hysteresis · tier buckets
  manifest overlap ──► conflict-safe groups
      │
      ▼
  Execute in parallel
  one worktree per feature · one agent per feature
  staggered launch · Promise.allSettled barrier
      │
      ▼
  Merge + Re-plan
  priority-order merge (--no-ff)
  conflict? merge main into worktree, agent resolves
  diff summaries ──► plan adjustment for remaining features
  re-score ──► re-phase ──► next batch
      │
      ▼
  Queue empty ──► done
```

**The scoring is the secret sauce.** Features that touch high-fan-in files — shared configs, route registries, index barrels — get scored lower and phased into their own execution group. This is how OpenWeft decides "which ones would touch the same code." It's file-level manifest analysis with coupling weights, not a heuristic guess.

**The lifecycle is a state machine.** XState v5. Plan → score → phase → execute → merge → re-plan is a deterministic loop, not a chain of promises hoping nothing goes wrong between steps.

**Three backends, one interface.** Codex CLI, Claude Code, and a deterministic mock share the same `AgentAdapter` contract. The mock powers `--dry-run` and the full test suite — validate the entire pipeline without spending a cent.

**Plans on disk are the source of truth.** If an agent session degrades, the plan file persists. A fresh session picks up from the plan, not from broken context. If the process crashes entirely, the Zod-validated checkpoint resets in-flight features to `planned` and re-runs them.

---

## Configuration

`openweft init` writes `.openweftrc.json`. Config loads via [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) — so `.openweftrc`, `.openweftrc.yaml`, `openweft.config.js`, or the `openweft` key in `package.json` all work.

**Auth:** `subscription` (default) uses your existing CLI login. `api_key` mode reads from an env var you specify.

**Budget:** `pauseAtUsd` halts after the current phase. `stopAtUsd` is a hard stop. Both enforced at runtime. All null by default — your money, your call.

**Concurrency:** 3 parallel agents, 5s stagger delay, 5 retry attempts with backoff. All configurable.

**Models:** Defaults to `gpt-5.3-codex` for Codex and `claude-sonnet-4-6` for Claude — both work on standard subscription plans. The onboarding wizard lets you pick a different model, or change it anytime in your config:

| Plan | Codex models | Claude models |
|---|---|---|
| Standard ($20/mo) | `gpt-5.3-codex`, `gpt-5.4`, `gpt-5.4-mini` | `claude-sonnet-4-6`, `claude-haiku-4-5` |
| Premium ($100–200/mo) | All above + `gpt-5.3-codex-spark` | All above + `claude-opus-4-6` |

**Effort:** Controls how hard the model reasons per task. Default is `medium`. Codex supports `low`, `medium`, `high`, `xhigh`. Claude supports `low`, `medium`, `high`, `max` Higher effort = better results on complex tasks, but slower and costlier.

**Permissions:** Handled automatically. Claude Code runs with `--dangerously-skip-permissions`. Codex runs with `--sandbox danger-full-access` for execution and `--sandbox read-only` for planning. No popups, no interruptions — you walk away.

**Approval:** OpenWeft auto-approves all execution stages by default — true fire-and-forget. Set `"approval": "per-feature"` if you want to confirm each feature before it runs, or `"first-only"` to approve once and auto-approve the rest.

<details>
<summary>Full default config</summary>

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
  "effort": {
    "codex": "medium",
    "claude": "medium"
  },
  "approval": "always",
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

---

## What gets written to disk

Everything OpenWeft creates. No hidden state.

| Path | Purpose |
|---|---|
| `feature_requests/queue.txt` | Your requests — pending and processed, with feature IDs |
| `feature_requests/*.md` | Generated plans with `## Manifest` blocks |
| `feature_requests/briefs/*.md` | Generated worker briefs, tied to feature IDs |
| `project_ledgers/*.md` | Living Plan Ledgers — one per feature, full execution narrative with before/after code |
| `.openweft/checkpoint.json` | Orchestrator state — Zod-validated, atomically written with `.backup` sibling |
| `.openweft/costs.jsonl` | Token usage + estimated USD per feature |
| `.openweft/audit-trail.jsonl` | Every orchestrator event, append-only |
| `.openweft/output.log` | `--bg` mode output |
| `prompts/prompt-a.md` | Your Prompt A template (must contain `{{USER_REQUEST}}`) |
| `prompts/plan-adjustment.md` | Your plan adjustment template (must contain `{{CODE_EDIT_SUMMARY}}`) |

**Crash recovery:** Kill the process, reboot, lose power, `Ctrl+C` at the worst moment — `openweft start` recovers from the last checkpoint. In-flight features reset to `planned` and re-run. Designed to recover cleanly, not to resurrect a live session byte-for-byte.

---

## Transparency

OpenWeft is beta. Here's what that means:

**It does:** Recover from crashes. Track costs. Respect budget limits. Phase work by file conflict. Merge in priority order. Re-plan against updated code.

**It doesn't yet:** Perfectly resume a live agent session mid-thought. Guarantee zero manual review. Promise stability across every environment and edge case.

If something breaks, the checkpoint and audit trail tell you exactly where and why.

---

## Why "OpenWeft"?

A weft is the horizontal thread on a loom. It runs through the vertical warp threads and binds them into fabric. Without it, you just have a bunch of parallel strings that don't hold together.

That's the job.

---

## Development

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest
npm run build          # tsc → dist/
npm run release:check  # all of the above + npm publish --dry-run
openweft start --dry-run   # full pipeline, mock adapter, zero cost
```

## Contributing

PRs welcome. Run `npm run release:check` before submitting.

## License

MIT

---

If OpenWeft saves you time, consider giving it a star. It helps others find it.
