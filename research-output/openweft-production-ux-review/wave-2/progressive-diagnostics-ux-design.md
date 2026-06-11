# Progressive Diagnostics / Terminal UX Design

## Scope

Wave 2 read-only UX synthesis for OpenWeft's terminal-first product surface. This pass designs evidence-backed recommendations that reduce visual clutter and cognitive load without weakening OpenWeft's core promise: durable planning, worktree isolation, checkpoint recovery, and inspectable diagnostics.

Out of scope: source-code changes, live Codex/Claude provider smoke, new tests, screenshots from a real terminal emulator, and implementation of these recommendations. I only wrote this report.

## Files Inspected

Required top-level context:
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `ARCHITECTURE.md`
- `package.json`
- `research-output/openweft-production-ux-review/wave-1-intelligence-summary.md`
- `research-output/openweft-production-ux-review/wave-1/terminal-ui-visual-clutter.md`
- `research-output/openweft-production-ux-review/wave-1/status-history-detail-help.md`
- `research-output/openweft-production-ux-review/wave-1/onboarding-wizard.md`
- `research-output/openweft-production-ux-review/wave-1/cli-command-ergonomics.md`
- `research-output/openweft-production-ux-review/wave-1/diagnostics-failure-messaging.md`

Source surfaces inspected:
- All files under `src/ui/`
- All files under `src/ui/hooks/`
- All files under `src/ui/onboarding/`
- All files under `src/cli/`
- All files under `src/status/`

Test surfaces inspected:
- All files under `tests/ui/`
- All files under `tests/ui/hooks/`
- All files under `tests/ui/onboarding/`
- All files under `tests/cli/`
- Also inspected `tests/status/renderStatus.test.ts` because `src/status/` is central to this review.

## Commands Run

- `wc -l AGENTS.md CLAUDE.md README.md ARCHITECTURE.md package.json ...`
- `find src/ui src/cli src/status tests/ui tests/cli -type f | sort`
- `find research-output/openweft-production-ux-review -maxdepth 3 -type f | sort`
- `nl -ba` and `sed -n` reads over all required docs, Wave 1 reports, key source files, and key tests.
- `rg -n` searches over `src/ui`, `src/cli`, `src/status`, `tests/ui`, and `tests/cli` for status, history, help, model, onboarding, background, stop, resume, diagnostics, and failure copy.
- `PATH=/opt/homebrew/bin:$PATH npx vitest run tests/ui tests/cli tests/status/renderStatus.test.ts --reporter=dot`
  - Result: 39 test files passed, 533 tests passed.
- `PATH=/opt/homebrew/bin:$PATH npx tsx -e "...static render probe..."`
  - Result: failed due `yoga-layout` top-level await under CJS transform, not an OpenWeft app failure.
- `PATH=/opt/homebrew/bin:$PATH node --import tsx --input-type=module -e "...static render probe..."`
  - Result: succeeded. The rendered 24-row-ish frame showed line 1 with phase/tokens/time and lines 2-3 repeating phase/tokens/time in `MeterBar` before agent cards.

## UX Findings

### 1. Duplicate telemetry creates the highest avoidable dashboard clutter

- **Severity:** Medium
- **Area:** Status bar / meter bar duplication
- **Evidence:** `App` renders `StatusBar` first and `MeterBar` immediately above the agent list when a phase exists (`src/ui/App.tsx:285-320`). `StatusBar` already shows phase, active/pending, tokens, elapsed, and model selection (`src/ui/StatusBar.tsx:26-61`). `MeterBar` repeats phase, tokens, and elapsed as three visual meters (`src/ui/MeterBar.tsx:66-85`). The static render probe showed:
  - `01: ◆ openweft │ ⚙ 1/3 │ active 1 · pending 1 │ 45.2k tokens │ 2:05`
  - `02: Phase 1/3 0/2 Tokens 45k Time 2:05`
  - `03: ━━━━━━━━━...`
  Tests currently lock in both paths: `tests/ui/App.test.tsx:54-63`, `tests/ui/StatusBar.test.tsx:24-71`, and `tests/ui/MeterBar.test.tsx:8-32`.
- **User impact:** A normal terminal spends multiple early rows on repeated telemetry before showing the work list. Users must scan past duplication to find the first meaningful change.
- **Recommended fix:** Make `StatusBar` the single always-on health strip. Move meters into a toggled detail mode, a compact detail pane, or remove them unless a run has a warning threshold. Preserve token and elapsed facts, but render them once.
- **Confidence:** High
- **What would disconfirm:** A product requirement or real-terminal screenshot proving the duplicate meter band is intentionally central and still preserves list readability at 80x24 and other common terminal sizes.

### 2. Agent cards mix summary, detail, and interruption handling in one vertical block

- **Severity:** Medium
- **Area:** Agent card expansion and focused detail
- **Evidence:** `AgentCard` renders summary row, secondary feature line, focused file list, current tool, ready-state detail, and a nested approval box in the same card (`src/ui/AgentCard.tsx:57-101`). `App` maps every visible agent to one card (`src/ui/App.tsx:349-367`). Meanwhile the store already retains richer per-agent `outputLines` (`src/ui/store.ts:24-29`, `src/ui/store.ts:174-182`), and `useOrchestratorBridge` appends text, tool calls, results, code blocks, approvals, and errors (`src/ui/hooks/useOrchestratorBridge.ts:55-128`). No current view exposes those logs as a progressive detail panel. Tests assert the inline expansion behavior for files, tools, approval, and ready-state detail (`tests/ui/AgentCard.test.tsx:63-107`, `tests/ui/AgentCard.test.tsx:130-147`).
- **User impact:** The focused card can become tall exactly when the user needs fast comparison across agents. At the same time, deeper diagnostic data is collected but not exposed through a clear detail model.
- **Recommended fix:** Keep list rows compact and stable: one summary line plus one optional secondary line. Put files, last output, current tool, approval detail, and last error into a focused detail pane or drawer. Approval can keep an inline one-line interruption marker, with full action details in the detail area.
- **Confidence:** High
- **What would disconfirm:** Rendered constrained-height snapshots showing focused approval/file states remain compact enough and users can access stored `outputLines` elsewhere.

### 3. Empty and ready states are visually strong but not state-aware enough

- **Severity:** Medium
- **Area:** Empty states / no-work states
- **Evidence:** `EmptyState` builds a full animated loom with hard-coded action hint text only: press `a` to add and `s` to start (`src/ui/EmptyState.tsx:106-114`, `src/ui/EmptyState.tsx:199-243`). `App` shows it when no agents are visible and execution has not been requested (`src/ui/App.tsx:113-114`, `src/ui/App.tsx:345-348`). The ready-state dashboard can also emit a transient notice for no actionable work (`src/cli/handlers.ts:1952-1957`, tested at `tests/cli/handlers.tui.test.ts:1357-1397`), but this state is not incorporated into the empty surface. Default terminal dimensions fall back to 80x24 (`src/ui/hooks/useTerminalSize.ts:9-14`).
- **User impact:** The first-run/idle screen is memorable, but after a completed, stopped, or empty run it can feel decorative instead of operational. Users need to know whether there is no queue, no resumable checkpoint, a hidden prior failure, or simply nothing started yet.
- **Recommended fix:** Add a compact state-aware empty variant: one status sentence, one next action, one optional command. Keep the loom as a first-run or idle backdrop, but reduce or replace it at short heights and after abnormal run states.
- **Confidence:** Medium-High
- **What would disconfirm:** A real-terminal design target showing the animated loom improves first-action success without obscuring no-work or recovery context.

### 4. Help and footer teach controls but not operational meaning

- **Severity:** Medium
- **Area:** Help overlay and footer
- **Evidence:** `HelpOverlay` is a shortcut table only (`src/ui/HelpOverlay.tsx:15-107`). `Footer` renders mode and key hints only (`src/ui/Footer.tsx:16-64`). Tests assert shortcut presence and absence rather than state interpretation (`tests/ui/HelpOverlay.test.tsx:9-109`, `tests/ui/Footer.test.tsx:21-87`). Quit/stop meaning appears as a transient notice in keyboard handling: `Press q again to stop after current phase, Esc to cancel` (`src/ui/hooks/useKeyboard.ts:96-99`), but help/footer do not carry the consequence consistently.
- **User impact:** In normal use, users learn keys quickly. In abnormal states, they still have to infer whether `q` exits, gracefully stops after phase, dismisses a completed run, or needs confirmation.
- **Recommended fix:** Keep footer terse, but add a state sentence before shortcuts: `Running: stop waits for this phase to finish.` Add a context strip to help: `Current state`, `Meaning`, `Next safe action`. Help should explain outcome semantics, not just key mechanics.
- **Confidence:** High
- **What would disconfirm:** A user-tested workflow showing shortcut-only help is enough for failed, stopped, paused, and resumable checkpoint states.

### 5. History and completion screens preserve identity, not enough outcome context

- **Severity:** High
- **Area:** History/detail context and failure screens
- **Evidence:** `CompletedFeature` only includes `id`, `request`, and `mergeCommit` (`src/ui/store.ts:32-36`). `HistoryView` renders a checkmark, truncated request, and short commit or dash (`src/ui/HistoryView.tsx:15-50`). `HistoryDetailView` renders completed status, ID, commit, and request only (`src/ui/HistoryDetailView.tsx:14-37`). TUI completion screens render status, planned/merged counts, HEAD, durability, cleanup, and exit/history hint (`src/ui/App.tsx:201-275`) but do not give a next safe action for failure. `createCommandHandlers` populates completed history from checkpoint fields only (`src/cli/handlers.ts:1773-1781`, `src/cli/handlers.ts:1905-1915`).
- **User impact:** Users can tell a feature existed and sometimes which commit belongs to it, but not whether durability was verified, what changed, whether cleanup succeeded, or what to do if completion is partial or failed.
- **Recommended fix:** Enrich completion/history state with optional outcome fields: timestamp, status detail, merge durability result, cleanup result, last error, validation summary, and safe next action. For failed completion, show `Do not rerun blindly` when durability is suspect; show `Fix environment/auth, then start again` when preflight or permission failures are known.
- **Confidence:** High
- **What would disconfirm:** Another always-visible post-run surface already provides per-feature outcome context and safe recovery guidance.

### 6. Model menu persistence scope is technically correct but easy to misread

- **Severity:** Medium
- **Area:** Model menu persistence wording
- **Evidence:** `ModelMenu` says `Use up/down to move, left/right to adjust, Enter to save, Esc to cancel` (`src/ui/ModelMenu.tsx:40-94`) but does not state scope. Save success is a transient notice: `Saved model + effort for the next run.` (`src/cli/handlers.ts:2064-2067`). Unsupported editing is also a transient notice (`src/ui/hooks/useKeyboard.ts:211-216`, `src/ui/hooks/useKeyboard.ts:439-444`). Tests assert only that the menu renders active backend/model/effort and controls (`tests/ui/ModelMenu.test.tsx:9-30`), while TUI tests cover current notices in handler flows (`tests/cli/handlers.tui.test.ts:1442-1624`).
- **User impact:** Users may think a save changes the current run or miss why save is unavailable for non-JSON config sources.
- **Recommended fix:** Add inline scoping copy in the menu: `Changes are saved as defaults for the next run; active runs are unchanged.` If editing is unsupported, render the reason in-menu and keep the save action disabled/absent. Include the config path in success/failure detail when available.
- **Confidence:** High
- **What would disconfirm:** User-facing docs or UI outside this menu already make next-run-only model persistence unmistakable at the moment of selection.

### 7. Onboarding has good backend detection but lacks auth-mode and final preflight clarity

- **Severity:** Medium-High
- **Area:** Onboarding auth mode, preflight, and missing-Git guidance
- **Evidence:** `runOnboardingWizard` writes config from defaults and overrides backend/model/effort only (`src/ui/onboarding/runOnboardingWizard.ts:75-90`). `OnboardingState` and `WizardCallbacks.onRunInit` do not carry auth method or API-key env var selection (`src/ui/onboarding/types.ts:10-36`). `StepBackends` checks installed/authenticated status and gives subscription-login commands (`src/ui/onboarding/StepBackends.tsx:38-63`, `src/ui/onboarding/StepBackends.tsx:253-353`), but not `subscription` vs `api_key`. Final launch says `Ready to start` and provides useful commands (`src/ui/onboarding/StepLaunch.tsx:64-98`), while the authoritative backend readiness gate happens later in `ensureConfiguredBackendReady` (`src/cli/handlers.ts:1311-1343`) and in ready dashboard start handling (`src/cli/handlers.ts:1960-1968`). Missing Git before Ink is a single hard-stop line (`src/ui/onboarding/runOnboardingWizard.ts:39-43`), while non-repo Git guidance is better inside `StepWelcome` (`src/ui/onboarding/StepWelcome.tsx:140-153`). Tests confirm current behavior, including missing Git text (`tests/ui/onboarding/runOnboardingWizard.test.ts:303-311`) and launch title/default start action (`tests/ui/onboarding/StepLaunch.test.tsx:27-30`, `tests/ui/onboarding/StepLaunch.test.tsx:115-138`).
- **User impact:** First-run can feel complete before the selected auth path is fully explained. Teams that require API-key mode must discover it later, and users can hit a runtime start error immediately after a polished launch screen.
- **Recommended fix:** Add an advanced auth-mode choice after backend selection: default `subscription`, optional `api_key`, exact env var shown. Add a final preflight summary on `StepLaunch`: backend installed, auth path satisfied, Git repo/commit state acceptable, queue count, and start enabled only when green. Improve missing-Git hard-stop copy with install/restart guidance.
- **Confidence:** High
- **What would disconfirm:** Product strategy intentionally excludes API-key onboarding and final preflight from first-run UX, with docs explicitly saying those paths are manual advanced setup.

### 8. CLI status/background/stop/resume output needs a progressive recovery hierarchy

- **Severity:** High
- **Area:** CLI status, background, stop, resume, and failure messaging
- **Evidence:** `buildProgram` registers only `init`, `add`, `start`, `status`, and `stop`; `launch` is default/internal and there is no `resume` command (`src/cli/buildProgram.ts:31-90`, tested at `tests/cli/buildProgram.test.ts:6-25`). `status` renders raw state, queue counts, feature lists, tokens, checkpoint timestamps, HEAD, durability, and artifacts (`src/status/renderStatus.ts:99-156`) and is passed through directly for non-TTY (`src/cli/handlers.ts:2519-2528`). TTY status displays diagnostic lines in `StatusCard` (`src/ui/styledOutput.tsx:31-61`). Background success says `Backgrounded (PID ...). Use 'openweft status' to check progress.` but omits the log path even though `spawnBackground` writes stdout/stderr to `.openweft/output.log` (`src/cli/handlers.ts:1376-1399`, `src/cli/handlers.ts:2274-2292`). Stop wording says SIGTERM and waits for current phase, then may SIGKILL after 300 seconds (`src/cli/handlers.ts:2556-2609`, tested at `tests/cli/handlers.test.ts:768-838`). Streamed completion/failure prints one dense line with no next action (`src/cli/handlers.ts:2442-2447`, `tests/cli/handlers.stream.test.ts:137-211`).
- **User impact:** Operators get facts but not triage. They must know when `start` means resume, where background logs are, whether stop is immediate, and which failure action is safe.
- **Recommended fix:** Use a shared `diagnosticSummary + nextAction + details` model for CLI and TUI:
  - First line: current health and whether work is running, stopped, resumable, failed, or complete.
  - Second line: next safe action.
  - Details block: checkpoint source, HEAD, durability, artifacts, feature list.
  Add `openweft resume` as an alias or at least explicit help/status copy: `Run openweft start to resume this checkpoint.` Add `.openweft/output.log` to background success text.
- **Confidence:** High
- **What would disconfirm:** Existing external docs or a product decision showing OpenWeft intentionally expects expert operators to infer recovery actions from raw diagnostics.

## Proposed Progressive Disclosure Model

**Tier 0: Always-on health strip**
- One line only.
- Shows product name, run state, phase/progress, active/pending, model, tokens, elapsed.
- Includes one abnormal-state marker when needed: `failed`, `stopping`, `resumable`, `backup checkpoint`.

**Tier 1: Compact work list**
- Stable-height agent rows/cards.
- Shows status icon, feature name, one short status phrase, elapsed, optional token/file badges.
- No nested approval/detail blocks except a one-line interruption marker.

**Tier 2: Focused detail pane**
- Opened by focus/enter or always shown below the list when space allows.
- Shows selected agent files, current tool, last output line, approval detail, last error, and next safe action.
- Reuses existing `outputLines` rather than inventing a new event stream.

**Tier 3: Status diagnostics**
- Used by `openweft status`, completion/failure screens, and help context.
- Ordered as: health summary, next action, feature summary, diagnostics details.
- Details include checkpoint source, timestamps, HEAD, durability, codex-home/runtime artifacts, background PID/log path.

**Tier 4: Raw artifacts**
- Explicitly named but not dumped into the main UI.
- Examples: `.openweft/audit-trail.jsonl`, `.openweft/checkpoint.json`, `.openweft/output.log`, feature plans, Work Briefs, shadow plans.

Design rule: every abnormal state should answer three questions in this order:
1. What happened?
2. What does it mean?
3. What is the next safe action?

## Copy/State Matrix

| State | Primary copy | Next safe action | Detail trigger |
|---|---|---|---|
| Empty, no queue | `No queued work.` | `Press a to add a request.` | `openweft status` for prior run state |
| Ready with queue | `2 requests queued.` | `Press s to start.` | Show queue list |
| Ready with checkpoint | `Resumable checkpoint found.` | `Press s to resume planned/retryable work.` | Show checkpoint feature list |
| Running | `Phase 1/3 running: 1 active, 1 pending.` | `q stops after this phase; status shows diagnostics.` | Focus agent |
| Re-analysis | `Re-analyzing after merge.` | `Wait; workers resume after plan update.` | Show overlapping changed paths if available |
| Approval | `Approval needed for file action.` | `Review detail, then approve, deny, skip, or always approve.` | Detail pane |
| Background running | `Background run active, PID 1234.` | `openweft status checks progress; logs are in .openweft/output.log.` | Status details |
| Stop requested | `Stop requested; current phase is finishing.` | `Wait for checkpoint, or inspect status from another shell.` | Background log |
| Stopped | `Run stopped safely after a phase.` | `Run openweft start/resume to continue.` | Status diagnostics |
| Paused | `Run paused by policy or threshold.` | `Inspect status, then resume when ready.` | Status diagnostics |
| Failed, backend/auth | `Backend is not ready.` | `Install/login/export API key, then start again.` | Preflight detail |
| Failed, permission/env | `Environment permission failed.` | `Fix filesystem/auth permissions before retrying.` | Error detail |
| Failed, durability | `Merge durability not verified.` | `Do not rerun blindly; inspect HEAD and affected feature commits.` | Diagnostics detail |
| Completed | `Run complete: N planned, M merged.` | `Press h for history or q to exit.` | History detail |
| Model saved | `Defaults saved for next run.` | `Current run is unchanged.` | Config path detail |
| Model unsupported | `This config source cannot be edited here.` | `Edit the config file manually or use a JSON config.` | Config source detail |
| Onboarding missing Git binary | `Git is required and was not found.` | `Install Git, reopen the terminal, then rerun openweft.` | Install command |
| Onboarding non-repo | `No git repository found.` | `Initialize git here or exit and choose a repo.` | Worktree explanation |
| Onboarding init failed | `Initialization failed.` | `Fix the named path/permission/disk issue, then retry.` | Error taxonomy |
| Onboarding launch preflight failed | `Setup is not ready to start.` | `Fix backend/auth/Git item shown above.` | Preflight checklist |

## Proposed Implementation Phases

1. **Copy-only quick wins**
   - Add next-action lines to completion/failure screens, status output, background success, stop output, help overlay, footer mode copy, and model menu.
   - Add tests for exact next-action text where safety matters.

2. **Shared diagnostics copy helper**
   - Centralize state-to-copy mapping so CLI, TTY status, TUI completion, and help overlay share the same interpretation.
   - Output shape: `summary`, `meaning`, `nextAction`, `details[]`, `severity`.

3. **Dashboard layout compaction**
   - Collapse `StatusBar` + `MeterBar` into one always-on strip.
   - Add a detail toggle or detail pane for meter-style progress and selected-agent detail.
   - Add small-terminal assertions using 80x24 and a narrower width.

4. **History/detail enrichment**
   - Extend UI state with optional outcome metadata derived from checkpoint/finalization.
   - Keep fields optional for checkpoint compatibility.
   - Add history/detail tests for durability, missing commit, failed feature, and next action.

5. **Onboarding preflight and auth-mode clarity**
   - Add auth method to onboarding selection state and config write payload.
   - Add final preflight checklist before `Ready to start`.
   - Improve missing-Git and init-error taxonomy copy.

6. **CLI ergonomics follow-through**
   - Add `resume` as an alias for `start` or document `start` as resume in help/status.
   - Add `launch` as a named alias for default/no-arg behavior if command discoverability is prioritized.
   - Add mode table to help/README: dashboard, stream, background, tmux, dry-run.

7. **Regression coverage**
   - Tests should protect the progressive disclosure contract:
     - one telemetry source by default,
     - state-specific next action for failed/stopped/paused/background/resumable,
     - model persistence scope,
     - onboarding auth-mode/preflight messages,
     - CLI/TUI copy parity via shared helper tests.

## Domino Risks

- **Overcompaction can hide trust-building diagnostics.** Mitigation: collapse default chrome, not the data. Keep detail one key away and keep `openweft status` diagnostic-rich.
- **Next-action copy can become unsafe if too generic.** Mitigation: base it on known state classes and avoid telling users to rerun when durability, permission, or auth state is unresolved.
- **CLI and TUI copy can drift.** Mitigation: use a shared copy/diagnostics helper and snapshot both renderers from the same matrix.
- **A `resume` alias may imply new semantics.** Mitigation: make it an alias of `start` first, with wording that explains the current checkpoint behavior.
- **Onboarding preflight could slow first-run flow.** Mitigation: keep it lightweight and reuse existing detection functions; avoid live provider calls beyond current CLI/auth checks.
- **History enrichment can pressure checkpoint compatibility.** Mitigation: make new UI fields optional and derive them from current checkpoint/finalization data when available.
- **Removing always-visible meters may disappoint users who like visual progress.** Mitigation: keep meters in a detail view or toggle instead of deleting the concept.
- **Failure copy may overpromise recovery.** Mitigation: phrase uncertain states as inspection-first: `inspect status`, `verify HEAD`, `fix auth`, not `run again` unless the system can prove rerun is safe.

###COMPLETE###
