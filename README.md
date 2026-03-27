# OpenWeft — fire-and-forget AI agent orchestration

**You write a list. You walk away. You come back to commits.**

OpenWeft orchestrates [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex CLI](https://github.com/openai/codex) — **queuing features**, **detecting file conflicts**, **running safe work in parallel**, and **merging results** automatically.

**It runs on your existing subscription. No API keys, no per-token billing.**

<p align="center">
  <a href="https://www.npmjs.com/package/openweft"><img src="https://img.shields.io/npm/v/openweft?style=for-the-badge&color=cb3837" alt="npm"></a>
  <a href="https://github.com/NeuraCerebra-AI/openweft/actions"><img src="https://img.shields.io/github/actions/workflow/status/NeuraCerebra-AI/openweft/ci.yml?branch=main&style=for-the-badge" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT"></a>
</p>

## Quick start

```bash
npm install -g openweft
openweft                                  # wizard on first run
```

Queue some features, then let it rip:

```bash
openweft add "add password reset flow"
openweft add "refactor auth middleware"
openweft add "add audit log export"
openweft start
```

```
$ openweft status

Status: completed · Features: 3 total (3 completed)
Estimated cost: ~$0.74 (384K input / 4K output tokens)
Completed:
  [001] Add password reset flow (high 0.891)
  [002] Add audit log export (high 0.912)
  [003] Refactor auth middleware (medium 0.544)
```

Features 1 and 2 ran in parallel — no file overlap. Feature 3 touched the same auth files, so OpenWeft queued it for the next batch and re-planned against the merged code. Three features, two batches, zero babysitting. (Cost shown is an estimate — OpenWeft uses your existing Claude or Codex subscription, not a separate API bill.)

<p align="center">
  <picture>
    <img alt="OpenWeft terminal" src="./docs/hero-dark.svg" width="100%">
  </picture>
</p>

**Good fit:** You have a backlog of features, some touch overlapping files, and you want to batch them through Claude Code or Codex without manually coordinating worktrees, merges, and re-plans.

**Not the right tool:** One quick edit (just run Claude Code directly), interactive pair-programming, repos that can't use git worktrees, or anyone expecting a polished 1.0.

Requires Node.js `>=24`, Git, and one or both of `codex` / `claude` already logged in. OpenWeft piggybacks on your existing CLI sessions — a standard $20/mo subscription works. API keys are optional if you want them, but not required.

---

## How it works

You queue a request. OpenWeft compiles it into a detailed worker brief — not a one-line prompt, but a full operating document with investigation steps, 5-approach brainstorming, risk scoring, and a structured execution plan. Each feature gets its own git worktree so agents can't step on each other.

OpenWeft analyzes which features would touch the same files using file-level manifest analysis with coupling weights. Non-overlapping work runs simultaneously. Everything else gets queued for the next batch. When agents finish, results merge in priority order. If there's a conflict, the agent resolves it. Then the cycle repeats — re-score, re-phase, re-plan — until the queue is empty.

Every step is recorded. Plans, checkpoints, audit trails, and cost tracking persist on disk. If the process crashes, `openweft start` recovers from the last checkpoint automatically.

For the full architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Features

- **Two-stage prompt system.** Your raw request compiles into a production-grade worker brief (Prompt A → Prompt B). Agents investigate the codebase, brainstorm 5 approaches, score by risk, and verify downstream impact — not first-idea execution.
- **Conflict-aware phasing.** Features that touch high-fan-in files (shared configs, route registries, index barrels) get scored and phased into their own execution group. Deterministic XState v5 state machine, not a chain of promises.
- **Three backends, one interface.** Codex CLI, Claude Code, and a deterministic mock share the same adapter contract. The mock powers `--dry-run` — validate the full pipeline without spending a cent.
- **Crash recovery.** Kill the process, reboot, `Ctrl+C` at the worst moment. Zod-validated checkpoints reset in-flight features to `planned` and re-run them.
- **Budget controls.** `pauseAtUsd` halts after the current phase. `stopAtUsd` is a hard stop. Both enforced at runtime. (These track estimated API-equivalent cost for visibility — your subscription rate doesn't change.)
- **Full auditability.** Each plan includes a structured Ledger section. When it's done, you can read what was investigated, what changed, and what got deferred — a narrative, not a log dump.

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
openweft start --dry-run       full pipeline simulation with mock adapter, zero cost
openweft status                queue state, tokens, cost, feature breakdown
openweft stop                  finish the current phase, then stop
```

---

## Configuration

`openweft init` writes `.openweftrc.json`. Config loads via [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) — so `.openweftrc`, `.openweftrc.yaml`, `openweft.config.js`, or the `openweft` key in `package.json` all work.

**Auth:** `subscription` (default) uses your existing CLI login. `api_key` mode reads from an env var you specify. **Models:** Defaults to `gpt-5.3-codex` for Codex and `claude-sonnet-4-6` for Claude — both work on standard subscription plans. **Concurrency:** 3 parallel agents, 5s stagger delay, 5 retry attempts with backoff. **Approval:** Auto-approves all stages by default (true fire-and-forget). Set `"per-feature"` to confirm each, or `"first-only"` to approve once.

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
  "budget": {
    "warnAtUsd": null,
    "pauseAtUsd": null,
    "stopAtUsd": null
  }
}
```

</details>

---

## Contributing

PRs welcome. Run `npm run release:check` before submitting.

## License

MIT

---

If OpenWeft saves you time, consider giving it a star. It helps others find it.