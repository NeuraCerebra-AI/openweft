# Wave 3: Terminal UX Copy/Layout Finalization

## Scope

This report converts the Wave 1 and Wave 2 terminal UX findings into implementation-ready recommendations for OpenWeft's terminal surfaces. It preserves the product language already established in `README.md` and `ARCHITECTURE.md`: batch execution, Work Briefs, phases, worktree isolation, checkpoints, durability, tokens, and inspectable artifacts.

No browser assumptions are made. This is a terminal-only copy and layout plan.

## Design Language To Preserve

- Keep copy operational and plain: "what happened", "what it means", "next safe action".
- Prefer OpenWeft nouns already in the product: phase, queue, worktree, checkpoint, Work Brief, plan, manifest, ledger, HEAD, durability, tokens.
- Keep the main dashboard calm. The product promise is "fire-and-forget", not "watch every meter".
- Preserve diagnostics, but move them down the disclosure ladder: health strip first, details on focus/status/history.
- Do not tell users to rerun blindly when durability, auth, permission, or stopped-checkpoint semantics are uncertain.

## Target Disclosure Ladder

1. Health strip: one line. Current run state, phase, active/pending counts, model, tokens, elapsed, one abnormal marker.
2. Work list: stable compact rows. One summary line and one optional secondary line per agent.
3. Detail pane: selected agent/run detail. Files, current tool, last output, approval detail, last error, next action.
4. Status diagnostics: `openweft status`, completion screens, failure screens. Health, meaning, next action, then details.
5. Raw artifacts: named paths only unless explicitly requested. Examples: `.openweft/audit-trail.jsonl`, `.openweft/checkpoint.json`, `.openweft/output.log`.

## Clutter Map By Screen

| Screen | Current clutter source | Target layout | Minimal default copy |
|---|---|---|---|
| Ready dashboard, no agents | Full animated loom plus hard-coded add/start hint | Calm state-aware empty pane; loom only if enough height and no abnormal checkpoint | `No queued work.` / `Next: press a to add a request.` |
| Ready dashboard, queued work | Status bar plus meter area plus card list plus footer | Health strip, queue rows, footer with one state sentence | `Ready: 3 requests queued.` / `Next: press s to start.` |
| Ready dashboard, resumable work | Queued cards say `Resumable checkpoint`; no stronger state framing | Health strip marker plus empty/list sentence explaining checkpoint | `Checkpoint found: planned or retryable work is waiting.` / `Next: press s to resume.` |
| Running dashboard | `StatusBar` repeats phase/tokens/time with `MeterBar` | One health strip; meters moved to detail | `Running: phase 1/3, 1 active, 1 pending.` |
| Focused agent | Files/tool/approval details expand inside the card | Stable row plus focused detail pane | Row: `001 running - auth reset - 3 files - 12.4k tok - 2:05` |
| Approval | Nested approval card inside selected agent card | One-line interruption in row, full action in detail pane | `Approval needed: review file action.` / `Next: approve, deny, skip, or always approve.` |
| Help overlay | Shortcut table only | Current state, meaning, next safe action, then shortcuts | `Running: q requests a phase-safe stop.` |
| History list | Checkmark, request, commit/dash only | Outcome row with durability marker and timestamp if available | `001 completed - durability verified - abc1234` |
| History detail | ID, commit, request only | Outcome, merge/durability, cleanup, last error if any, next action | `Outcome: completed. Durability: verified.` |
| Model menu | Controls only; scope is transient notice | Inline scope and disabled save reason | `Saved defaults apply to the next run; active runs are unchanged.` |
| Onboarding backend | Installed/authenticated status only | Backend plus auth-mode choice | `Auth mode: subscription (default) or api_key.` |
| Onboarding launch | `Ready to start` before final backend preflight | Preflight checklist before start is default | `Setup ready: backend, auth, git, queue checked.` |
| `openweft status` | Raw state/counters/diagnostics first | Health, next action, details | `OpenWeft: failed.` / `Next: inspect diagnostics before rerun.` |
| `openweft start --bg` | PID and status hint only | PID, log path, stop semantics | `Background run started: PID 1234.` / `Logs: .openweft/output.log.` |
| `openweft stop` | SIGTERM and wait loop copy | Phase-safe stop explanation | `Stop requested. OpenWeft will finish the current phase and write a checkpoint.` |
| Stream completion/failure | Dense one-line terminal summary | Summary plus next action | `Run failed: planned 3, merged 2.` / `Next: openweft status shows diagnostics.` |

## Findings

### Finding 1 - Consolidate StatusBar And MeterBar Into One Health Strip

- **Severity:** Medium
- **Area:** Status bar / meter bar consolidation
- **Evidence:** `App` renders `StatusBar` at the top of the dashboard and `MeterBar` above the agent list (`src/ui/App.tsx:282-320`). `StatusBar` already renders phase, model, active/pending counts, tokens, and elapsed time (`src/ui/StatusBar.tsx:25-61`). `MeterBar` repeats phase, tokens, and elapsed as three visual meters (`src/ui/MeterBar.tsx:66-85`). Wave 2's static render probe captured the duplicate first rows and classified this as the highest avoidable dashboard clutter (`research-output/openweft-production-ux-review/wave-2/progressive-diagnostics-ux-design.md:54-66`).
- **User impact:** On a normal 80x24 terminal, users spend top-of-screen attention on repeated telemetry before they reach the actual work list.
- **Recommended fix:** Make `StatusBar` the only always-on health strip. Remove default `MeterBar` rendering from the main dashboard or move the meter concept into a focused detail pane/toggle.

  Proposed health strip formats:

  ```text
  openweft | ready | 3 queued | codex gpt-5.5 medium | 0 tokens | 0:00
  openweft | running phase 1/3 | active 1 pending 1 | codex gpt-5.5 medium | 45.2k tokens | 2:05
  openweft | stopping after phase 1/3 | active 1 pending 1 | 45.2k tokens | 2:05
  openweft | failed | merged 2/3 | durability warning | 49.0k tokens | 8:41
  ```

  Implementation notes:
  - Add a run-state/status marker prop to `StatusBar` instead of relying only on phase presence.
  - Keep token and elapsed data; render them once.
  - If meters remain, expose them only in detail mode as `Progress: phase 1/3, features 0/2, tokens 45k, time 2:05`.
- **Confidence:** High
- **What would disconfirm:** Real 80x24 and narrow-width terminal renders showing duplicate bars remain readable and intentionally preferred by target users.

### Finding 2 - Keep Agent Cards Stable And Move Details Into A Focused Pane

- **Severity:** Medium
- **Area:** Compact agent cards / detail pane
- **Evidence:** `AgentCard` renders summary row, secondary feature text, focused files, current tool, ready-state detail, and nested approval content in one vertical card (`src/ui/AgentCard.tsx:57-101`). `App` maps every visible agent to these cards (`src/ui/App.tsx:345-368`). The store already keeps richer per-agent `outputLines`, files, current tool, approval, tokens, and elapsed fields (`src/ui/store.ts:18-36`, `src/ui/store.ts:174-182`). Wave 2 recommended stable work list rows plus a detail pane (`research-output/openweft-production-ux-review/wave-2/progressive-diagnostics-ux-design.md:68-76`).
- **User impact:** The selected row grows taller at the exact moment the user needs to compare agents or inspect a problem. Deeper diagnostics exist but are not arranged as a clear detail model.
- **Recommended fix:** Split agent display into compact rows and a focused detail pane.

  Agent row copy:

  ```text
  001 running  Add password reset flow        3 files  12.4k tok  2:05
  002 queued   Add audit log export           ready to run
  003 failed   Refactor auth middleware       last error available
  ```

  Focus detail pane copy:

  ```text
  Detail: 001 Add password reset flow
  State: running in isolated worktree
  Current: editing src/auth/reset.ts
  Files: src/auth/reset.ts, src/email.ts, tests/auth/reset.test.ts
  Last output: wrote tests, running validation
  Next: wait; OpenWeft will merge after this phase completes.
  ```

  Approval detail copy:

  ```text
  Approval needed: write src/auth/reset.ts
  Meaning: the worker is blocked until you choose an action.
  Next: y approve, n deny, s skip, a always approve this run.
  Detail: <approval request detail>
  ```

  Implementation notes:
  - Keep inline approval marker to one row: `approval needed - press Enter for detail`.
  - Reuse `AgentState.outputLines` for the "Last output" section.
  - Cap detail pane height and truncate older output lines.
- **Confidence:** High
- **What would disconfirm:** Constrained terminal snapshots proving current focused cards preserve list readability while still exposing output detail elsewhere.

### Finding 3 - Make Empty And Ready States State-Aware

- **Severity:** Medium
- **Area:** Empty states / ready dashboard / resumable checkpoint copy
- **Evidence:** `EmptyState` renders a full animated loom and hard-coded `Press a to add... s to start` hint (`src/ui/EmptyState.tsx:106-114`, `src/ui/EmptyState.tsx:199-243`). `App` shows it only when no agents are visible and execution has not started (`src/ui/App.tsx:113-114`, `src/ui/App.tsx:345-348`). Ready-state launch can emit `No queued or resumable work to start.` as a transient notice (`src/cli/handlers.ts:1952-1957`), but that state is not part of the empty surface. Wave 1 and Wave 2 both flagged shallow empty-state guidance (`research-output/openweft-production-ux-review/wave-1/status-history-detail-help.md:103-112`, `research-output/openweft-production-ux-review/wave-2/progressive-diagnostics-ux-design.md:78-86`).
- **User impact:** Empty screens are memorable but can hide whether the user is looking at a fresh repo, no queued work, no resumable checkpoint, stopped work, or a prior failure.
- **Recommended fix:** Add a compact state-aware empty pane that can replace or sit over the loom, especially on short terminals and after abnormal states.

  Empty/ready copy:

  ```text
  No queued work.
  Next: press a to add a request, or run openweft add "feature".
  ```

  ```text
  Ready: 3 requests queued.
  Next: press s to start, or m to change model defaults.
  ```

  ```text
  Checkpoint found: planned or retryable work is waiting.
  Next: press s to resume this checkpoint.
  Detail: openweft status shows checkpoint and feature state.
  ```

  Current-build safety copy for the confirmed stopped-work bug:

  ```text
  Stopped checkpoint found with planned work.
  Next: inspect openweft status before starting; this build may not resume stopped planned work automatically.
  ```

  Implementation notes:
  - Do not promise stopped-checkpoint resume until the Wave 2 C8 semantics bug is fixed.
  - Add a `readyStateSummary` input to the empty/ready surface rather than hard-coding action hints inside `EmptyState`.
- **Confidence:** Medium-High
- **What would disconfirm:** Product decision or user-tested terminal captures showing the decorative empty state is intentionally prioritized over state interpretation in operational contexts.

### Finding 4 - Add Meaning To Help And Footer Without Making Them Noisy

- **Severity:** Medium
- **Area:** Help overlay / footer
- **Evidence:** `Footer` renders mode labels and shortcuts only (`src/ui/Footer.tsx:16-64`). `HelpOverlay` is a shortcut table only (`src/ui/HelpOverlay.tsx:15-107`). Quit/stop semantics exist as a transient keyboard notice: `Press q again to stop after current phase, Esc to cancel` (`src/ui/hooks/useKeyboard.ts:96-99`). Wave 1 found help teaches keys, not outcomes (`research-output/openweft-production-ux-review/wave-1/status-history-detail-help.md:69-89`), and Wave 2 recommended a state sentence before shortcuts (`research-output/openweft-production-ux-review/wave-2/progressive-diagnostics-ux-design.md:88-96`).
- **User impact:** Users learn controls but not consequences. In stopped, failed, approval, or resumable states, shortcut-only help increases trial-and-error.
- **Recommended fix:** Keep the footer one row, but add a short state phrase before shortcuts when the state is abnormal or consequential.

  Footer formats:

  ```text
  READY  3 queued | s start  m model  a add  d remove  h history  ? help
  RUNNING  stop waits for this phase | a add  h history  q stop  ? help
  APPROVAL  worker is blocked | y approve  n deny  s skip  a always
  FAILED  inspect before rerun | h history  q exit  ? help
  ```

  Help overlay format:

  ```text
  Current state: running phase 1/3
  Meaning: workers are isolated in worktrees; q requests a phase-safe stop.
  Next safe action: wait, inspect a focused agent, or press q twice to stop after this phase.

  Shortcuts
  ...
  ```

  Implementation notes:
  - Use the same state-to-copy helper for footer and help so semantics do not drift.
  - Do not show long guidance in the footer during normal ready/running states.
- **Confidence:** High
- **What would disconfirm:** User-tested evidence showing shortcut-only help is sufficient for failed, stopped, paused, approval, and checkpoint states.

### Finding 5 - Enrich History And Completion With Outcome Context

- **Severity:** High
- **Area:** History list/detail / completion and failure screens
- **Evidence:** `CompletedFeature` only stores `id`, `request`, and `mergeCommit` (`src/ui/store.ts:32-36`). `HistoryView` renders checkmark, truncated request, and short commit or dash (`src/ui/HistoryView.tsx:15-50`). `HistoryDetailView` renders completed status, ID, commit, and request (`src/ui/HistoryDetailView.tsx:14-37`). Completion screens show planned/merged counts, HEAD, durability, cleanup, and exit/history hint but no next safe action (`src/ui/App.tsx:201-275`). Wave 2 classified this as a high-severity outcome-context gap (`research-output/openweft-production-ux-review/wave-2/progressive-diagnostics-ux-design.md:98-106`).
- **User impact:** Operators can see that a feature completed, but not whether the completion was durable, when it happened, whether cleanup succeeded, or what to do after partial/failure outcomes.
- **Recommended fix:** Add optional outcome metadata to history/completion state and render it progressively.

  Completion screen copy:

  ```text
  Run complete: planned 3, merged 3.
  Meaning: merge durability was verified for completed features.
  Next: press h for history, or q to exit.
  Details: HEAD abc1234; checkpoint updated 2026-06-10T17:22:00Z.
  ```

  Failure completion copy:

  ```text
  Run failed: planned 3, merged 2.
  Meaning: merge durability was not verified for 1 completed feature.
  Next: do not rerun blindly; run openweft status and inspect the affected commit.
  Details: HEAD abc1234; durability FAILED (002 not reachable from current HEAD).
  ```

  History row copy:

  ```text
  001 completed  Add password reset flow      durability verified  abc1234
  002 completed  Add audit log export         commit unavailable   recovered
  ```

  History detail copy:

  ```text
  Outcome: completed
  Request: Add password reset flow
  Commit: abc1234
  Durability: verified from final HEAD
  Cleanup: codex-home cleaned
  Next: inspect commit or return to dashboard.
  ```

  Implementation notes:
  - Keep new fields optional for checkpoint compatibility.
  - Source data can be derived from checkpoint features plus finalization diagnostics.
  - Include `lastError` and durability status when available.
- **Confidence:** High
- **What would disconfirm:** Another always-visible post-run surface already gives per-feature outcome, durability, cleanup, and recovery guidance.

### Finding 6 - Make Model Menu Persistence Scope Inline

- **Severity:** Medium
- **Area:** Model menu / model persistence copy
- **Evidence:** `ModelMenu` says only how to move/save/cancel (`src/ui/ModelMenu.tsx:39-94`). Save success is a transient notice: `Saved model + effort for the next run.` (`src/cli/handlers.ts:2064-2067`). Unsupported editing is also a transient notice (`src/ui/hooks/useKeyboard.ts:211-216`, `src/ui/hooks/useKeyboard.ts:439-444`). Wave 1 and Wave 2 found users can misread whether model changes affect the active run (`research-output/openweft-production-ux-review/wave-1/status-history-detail-help.md:91-101`, `research-output/openweft-production-ux-review/wave-2/progressive-diagnostics-ux-design.md:108-116`).
- **User impact:** Users may think the selected model applies immediately, or miss why saving is unavailable for non-JSON config sources.
- **Recommended fix:** Add persistence copy inside the menu and disable or explain save when unsupported.

  Menu copy:

  ```text
  Model + Effort
  Backend: codex
  Scope: saved defaults apply to the next run; active runs are unchanged.

  Model: [gpt-5.5] gpt-5 gpt-5-mini
  Effort: low [medium] high xhigh

  Enter save defaults | Esc cancel
  ```

  Unsupported copy:

  ```text
  This config source cannot be edited here.
  Next: edit the config file manually or use .openweftrc.json.
  ```

  Success notice:

  ```text
  Defaults saved for next run: codex gpt-5.5 medium.
  Current run is unchanged.
  ```

  Implementation notes:
  - Include config path in the success/failure detail when available.
  - Keep `m` unavailable during active execution unless there is a future one-run override design.
- **Confidence:** High
- **What would disconfirm:** User-facing copy at the moment of selection already makes next-run-only persistence unmistakable.

### Finding 7 - Add Onboarding Auth Mode And Final Preflight Copy

- **Severity:** Medium-High
- **Area:** Onboarding preflight / auth mode / init failure copy
- **Evidence:** `runOnboardingWizard` writes config from defaults and overrides backend, model, and effort only (`src/ui/onboarding/runOnboardingWizard.ts:75-90`). `StepBackends` checks installed/authenticated status and gives subscription login commands, but has no `subscription` versus `api_key` choice (`src/ui/onboarding/StepBackends.tsx:38-63`, `src/ui/onboarding/StepBackends.tsx:253-353`). `StepLaunch` says `Ready to start` and offers start/exit before the authoritative `ensureConfiguredBackendReady` gate that runs later (`src/ui/onboarding/StepLaunch.tsx:64-98`, `src/cli/handlers.ts:1311-1343`). `StepInit` shows only raw error plus `Check file permissions and disk space.` (`src/ui/onboarding/StepInit.tsx:128-141`). Wave 1 and Wave 2 both flagged auth-mode and preflight clarity (`research-output/openweft-production-ux-review/wave-1/onboarding-wizard.md:46-88`, `research-output/openweft-production-ux-review/wave-2/progressive-diagnostics-ux-design.md:118-126`).
- **User impact:** First run can feel complete before the chosen auth path is explicit or fully validated. API-key teams discover their path late, and setup errors remain more generic than the rest of onboarding.
- **Recommended fix:** Add an auth-mode step after backend/model/effort and a final preflight checklist before the start option is enabled.

  Auth-mode step copy:

  ```text
  Choose auth mode
  subscription  Use your existing Codex/Claude CLI login. No API key needed.
  api_key       Use an environment variable for this backend.

  Codex API key variable: CODEX_API_KEY
  Claude API key variable: ANTHROPIC_API_KEY
  ```

  Preflight success copy:

  ```text
  Setup ready
  Backend: codex installed
  Auth: subscription ready
  Git: repository ready
  Queue: 3 requests queued

  Next: start now or exit and run openweft later.
  ```

  Preflight failure copy:

  ```text
  Setup is not ready to start.
  Backend auth: codex needs login.
  Next: run codex login, then press r to recheck.
  ```

  Init failure copy:

  ```text
  Initialization failed: <error>
  Meaning: OpenWeft could not write required setup files.
  Next: fix the named path, permission, or disk issue, then retry.
  ```

  Missing Git copy:

  ```text
  Git is required and was not found.
  Next: install Git, reopen the terminal, then run openweft again.
  ```

  Implementation notes:
  - Store auth method and optional env var in onboarding state.
  - Persist `auth[backend].method` and `auth[backend].envVar` intentionally.
  - Reuse `ensureConfiguredBackendReady` style checks before showing "Ready to start".
- **Confidence:** High
- **What would disconfirm:** Product strategy intentionally excludes API-key onboarding and final preflight, with docs explicitly naming those as manual advanced setup.

### Finding 8 - Reorder `openweft status` Around Health, Meaning, Next Action, Details

- **Severity:** High
- **Area:** CLI status and TTY status card
- **Evidence:** Non-TTY `renderStatusReport` starts with raw status, machine state, background, queue counts, feature counts, tokens, feature lists, and diagnostics (`src/status/renderStatus.ts:78-132`). TTY `StatusCard` shows phase/tokens, checkpoint source, diagnostics, pending queue, and agents (`src/ui/styledOutput.tsx:31-61`). The `status` handler passes those through directly (`src/cli/handlers.ts:2455-2528`). Wave 2 called for a `diagnosticSummary + nextAction + details` model (`research-output/openweft-production-ux-review/wave-2/progressive-diagnostics-ux-design.md:128-140`).
- **User impact:** Operators get useful facts but must infer triage. This is risky when status is failed, stopped, backup-sourced, stale, or durability-suspect.
- **Recommended fix:** Keep the existing details, but reorder and prefix the report with a compact triage block.

  Non-TTY status template:

  ```text
  OpenWeft: failed
  Meaning: 1 completed feature did not pass merge durability checks.
  Next: inspect HEAD and affected merge commits before rerunning.

  Details
  Background: not running
  Checkpoint: primary
  Machine State: stopped
  Queue: 0 pending, 3 processed
  Features: 3 total (2 completed, 1 failed)
  Tokens: 384000 input / 4000 output
  Current HEAD: abc1234
  Durability: FAILED (002 not reachable from current HEAD)
  Runtime Artifacts: codex-home missing

  Failed:
    [003] Refactor auth middleware (medium 0.544) | Permission denied
  Completed:
    [001] Add password reset flow (high 0.891)
    [002] Add audit log export (high 0.912)
  ```

  Backup checkpoint template:

  ```text
  OpenWeft: recovered from backup checkpoint
  Meaning: the primary checkpoint was unavailable or invalid; this is the previous snapshot by design.
  Next: inspect feature states before starting more work.
  ```

  Implementation notes:
  - Build a shared `RunCopySummary` helper with `{health, meaning, nextAction, severity, detailLines}`.
  - TTY and non-TTY status should consume the same helper.
  - Keep raw diagnostic lines below the triage block.
- **Confidence:** High
- **What would disconfirm:** Existing external operational docs require expert users to infer next actions from raw diagnostics and intentionally avoid command-level guidance.

### Finding 9 - Tighten Background, Stop, Resume, And Failure Output

- **Severity:** High
- **Area:** CLI `start --bg`, `stop`, resume semantics, stream completion/failure output
- **Evidence:** `buildProgram` registers `init`, `add`, `start`, `status`, and `stop`; `launch` is default/internal and there is no `resume` command (`src/cli/buildProgram.ts:31-90`). Background spawn writes stdout/stderr to `.openweft/output.log` (`src/cli/handlers.ts:1376-1399`), but success copy only says `Backgrounded (PID...). Use 'openweft status' to check progress.` (`src/cli/handlers.ts:2290-2292`). Stop sends SIGTERM and waits for the current phase, then may SIGKILL after 300 seconds (`src/cli/handlers.ts:2556-2609`). Stream completion/failure prints one dense line with finalization facts but no next action (`src/cli/handlers.ts:2442-2447`). Wave 2 confirmed stopped planned work can be stranded in the current semantics (`research-output/openweft-production-ux-review/wave-2-intelligence-summary.md:10-14`).
- **User impact:** Users may not know where background logs are, may expect immediate stop, may over-trust `start` as resume in a stopped edge case, and may miss safe recovery guidance after streamed failures.
- **Recommended fix:** Use explicit mode and safety copy.

  Background success:

  ```text
  Background run started: PID 1234.
  Logs: .openweft/output.log
  Next: run openweft status to check progress; run openweft stop to request a phase-safe stop.
  ```

  Background already running:

  ```text
  OpenWeft is already running: PID 1234.
  Next: run openweft status, or openweft stop to request a phase-safe stop.
  ```

  Stop request:

  ```text
  Stop requested for background run 1234.
  Meaning: OpenWeft will finish the current phase, write a checkpoint, then exit.
  Next: openweft status shows progress; logs are in .openweft/output.log.
  ```

  Stop success:

  ```text
  OpenWeft stopped safely after the current phase.
  Next: run openweft status to inspect the checkpoint before resuming.
  ```

  Forced stop:

  ```text
  Background process 1234 did not exit after a phase-safe stop request.
  Action taken: sent SIGKILL and removed the PID file.
  Next: run openweft status before starting again.
  ```

  Resume/status copy before a code-level resume fix:

  ```text
  Checkpoint status: stopped.
  Meaning: this build may not resume stopped planned work automatically.
  Next: inspect openweft status and avoid deleting checkpoint artifacts.
  ```

  Resume/status copy after the C8 semantics fix:

  ```text
  Resumable checkpoint found.
  Next: run openweft start to resume planned and retryable work.
  ```

  Streamed failure:

  ```text
  Run failed: planned 3, merged 2, status failed.
  Meaning: durability or execution diagnostics need review.
  Next: run openweft status before rerunning.
  ```

  Implementation notes:
  - Add `openweft resume` as an alias only if it is truly equivalent to fixed `start` semantics.
  - If no alias is added, put `Run openweft start to resume this checkpoint` in status only for states the code can actually resume.
  - Keep stop phase-synchronous. Improve copy; do not make stop immediate by default.
- **Confidence:** High
- **What would disconfirm:** A product contract deciding that OpenWeft intentionally expects operators to know log paths, stop semantics, and resume behavior from docs instead of command output.

### Finding 10 - Centralize Copy So CLI, TUI, Help, And Completion Do Not Drift

- **Severity:** Medium
- **Area:** Shared diagnostics/copy implementation
- **Evidence:** Equivalent facts are currently rendered by separate paths: dashboard completion (`src/ui/App.tsx:201-275`), status report (`src/status/renderStatus.ts:78-156`), TTY status card (`src/ui/styledOutput.tsx:31-61`), background/start/stop handlers (`src/cli/handlers.ts:2250-2625`), help/footer (`src/ui/HelpOverlay.tsx:15-107`, `src/ui/Footer.tsx:16-64`), and model/onboarding notices. Wave 2 explicitly warned that CLI and TUI copy can drift and recommended a shared helper (`research-output/openweft-production-ux-review/wave-2/progressive-diagnostics-ux-design.md:198-235`, `research-output/openweft-production-ux-review/wave-2/progressive-diagnostics-ux-design.md:238-245`).
- **User impact:** Users can receive different wording for the same state depending on whether they are in the dashboard, TTY status card, non-TTY status, or stream output.
- **Recommended fix:** Add a small copy contract module consumed by all terminal outputs.

  Proposed shape:

  ```typescript
  interface TerminalStateCopy {
    severity: 'normal' | 'warning' | 'error';
    health: string;
    meaning: string;
    nextAction: string;
    details: string[];
  }
  ```

  Required states:
  - idle
  - ready-empty
  - ready-queued
  - ready-resumable
  - running
  - re-analysis
  - approval-needed
  - background-running
  - stop-requested
  - stopped
  - paused
  - failed-auth
  - failed-permission
  - failed-durability
  - failed-unknown
  - completed
  - backup-checkpoint
  - model-saved
  - model-unsupported
  - onboarding-preflight-failed

  Implementation notes:
  - Snapshot both TTY and non-TTY renderers from the same copy fixtures.
  - Treat copy tests as safety tests for recovery behavior, not cosmetic tests.
- **Confidence:** High
- **What would disconfirm:** A deliberate architecture decision that each terminal surface should own independent copy and can safely diverge.

## Proposed Minimal Copy Matrix

| State | Primary copy | Meaning copy | Next safe action |
|---|---|---|---|
| Idle, no config | `OpenWeft is not initialized here.` | `This repo has no OpenWeft config yet.` | `Run openweft init, or run openweft to start onboarding.` |
| Empty, no queue | `No queued work.` | `There are no requests ready to plan or run.` | `Press a to add a request, or run openweft add "feature".` |
| Ready with queue | `Ready: N requests queued.` | `OpenWeft can plan and phase this backlog.` | `Press s to start.` |
| Ready with checkpoint | `Checkpoint found: planned or retryable work is waiting.` | `OpenWeft has durable state from an earlier run.` | `Press s to resume, or run openweft status for details.` |
| Running | `Running: phase X/Y, A active, P pending.` | `Workers are isolated in git worktrees.` | `Focus a row for detail; q requests a phase-safe stop.` |
| Re-analysis | `Re-analyzing after merge.` | `Remaining plans are being adjusted against real changes.` | `Wait; workers resume after plan update.` |
| Approval needed | `Approval needed: worker is blocked.` | `The selected worker needs a file/action decision.` | `Review detail, then approve, deny, skip, or always approve.` |
| Background running | `Background run active: PID N.` | `Output is detached from this terminal.` | `Run openweft status; logs are in .openweft/output.log.` |
| Stop requested | `Stop requested.` | `OpenWeft will finish the current phase and write a checkpoint.` | `Wait, or run openweft status from another shell.` |
| Stopped | `Run stopped safely after a phase.` | `A checkpoint remains on disk.` | `Run openweft status before resuming.` |
| Stopped with planned work, current semantics | `Stopped checkpoint has planned work.` | `This build may not resume stopped planned work automatically.` | `Inspect openweft status; do not delete checkpoint artifacts.` |
| Paused | `Run paused.` | `A policy or threshold paused execution.` | `Inspect status, then resume when ready.` |
| Failed, auth/backend | `Backend is not ready.` | `The selected CLI is missing, logged out, or missing its API key.` | `Install/login/export the API key, then start again.` |
| Failed, permission/env | `Environment permission failed.` | `OpenWeft likely cannot read or write required repo/runtime files.` | `Fix permissions/path/disk state before retrying.` |
| Failed, durability | `Merge durability not verified.` | `One or more completed feature commits are missing or unreachable from HEAD.` | `Do not rerun blindly; inspect HEAD and affected commits.` |
| Failed, unknown | `Run failed.` | `OpenWeft recorded an error but cannot classify it safely.` | `Run openweft status and inspect the last error before retrying.` |
| Completed | `Run complete: N planned, M merged.` | `Recorded completion and durability checks passed where available.` | `Press h for history, or q to exit.` |
| Backup checkpoint | `Recovered from backup checkpoint.` | `The primary checkpoint was unavailable or invalid; backup is the previous snapshot.` | `Inspect feature states before starting more work.` |
| Model saved | `Defaults saved for next run.` | `The active run is unchanged.` | `Start the next run to use the new defaults.` |
| Model unsupported | `This config source cannot be edited here.` | `OpenWeft can only save model defaults to a dedicated JSON config.` | `Edit the config manually or use .openweftrc.json.` |
| Onboarding missing Git | `Git is required and was not found.` | `OpenWeft needs git worktrees for isolation.` | `Install Git, reopen the terminal, then run openweft again.` |
| Onboarding init failed | `Initialization failed.` | `OpenWeft could not write required setup files.` | `Fix the named path, permission, or disk issue, then retry.` |
| Onboarding preflight failed | `Setup is not ready to start.` | `At least one backend/auth/Git check is not satisfied.` | `Fix the listed item, then press r to recheck.` |

## Implementation Order

1. Copy-only safety pass:
   - Add next-action lines to status, completion/failure, background success, stop output, model menu, help, and footer.
   - Include `.openweft/output.log` in background copy.
   - Add current-build safe stopped-checkpoint wording until C8 is fixed.

2. Shared terminal copy helper:
   - Centralize `health`, `meaning`, `nextAction`, `details`, and `severity`.
   - Use it in non-TTY status, TTY status card, completion/failure screen, help context, and stream output.

3. Dashboard compaction:
   - Collapse `StatusBar` and `MeterBar` into one default strip.
   - Add selected-agent detail pane using existing `AgentState` fields and `outputLines`.
   - Add 80x24 and narrow-width render assertions.

4. History/detail enrichment:
   - Add optional outcome fields to completed history state.
   - Derive durability, cleanup, timestamp, and last error from checkpoint/finalization data.

5. Onboarding preflight:
   - Add auth-mode selection and env var copy.
   - Add final preflight checklist before `Ready to start`.
   - Improve init and missing-Git failures with retry-oriented copy.

6. Command ergonomics follow-through:
   - Add `resume` alias only after stopped/resume semantics match the promise.
   - Add `launch` alias if discoverability is prioritized, while preserving no-arg behavior.
   - Update help text with dashboard/stream/background/tmux/dry-run mode table.

## Regression Coverage Targets

- One telemetry source renders by default in the dashboard.
- Every abnormal state has exactly one `Meaning:` or equivalent semantic sentence and one `Next:` action.
- `openweft status` and TTY `StatusCard` agree on health/meaning/next action for failed, stopped, paused, backup, and completed states.
- Background success output includes PID, `.openweft/output.log`, `openweft status`, and `openweft stop`.
- Stop output states phase-safe semantics and forced-stop fallback.
- Model menu states next-run-only persistence inline.
- Onboarding tests cover subscription/api_key copy, env var names, preflight failure, missing Git, and init failure retry guidance.
- History/detail tests cover durability verified, missing merge commit, not reachable from HEAD, missing commit, and last error.

###COMPLETE###
