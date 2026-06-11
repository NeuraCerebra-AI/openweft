# Wave 1 Findings: status-history-detail-help

## Scope
Wave 1 UX audit of state comprehension around status/history/detail/help/footer/model-menu/empty-state, with focus on whether the UI tells users **what happened** and **what to do next**.

## Files Inspected
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `ARCHITECTURE.md`
- `package.json`
- `research-output/openweft-production-ux-review/00_research_target_matrix.md`
- `src/ui/App.tsx`
- `src/ui/store.ts`
- `src/ui/HistoryView.tsx`
- `src/ui/HistoryDetailView.tsx`
- `src/ui/HelpOverlay.tsx`
- `src/ui/Footer.tsx`
- `src/ui/ModelMenu.tsx`
- `src/ui/EmptyState.tsx`
- `src/ui/StatusBar.tsx`
- `src/ui/styledOutput.tsx`
- `src/ui/hooks/useKeyboard.ts`
- `src/status/renderStatus.ts`
- `src/status/runtimeDiagnostics.ts`
- `src/cli/handlers.ts`
- `tests/ui/HelpOverlay.test.tsx`
- `tests/ui/Footer.test.tsx`
- `tests/ui/ModelMenu.test.tsx`
- `tests/ui/StatusBar.test.tsx`
- `tests/ui/App.test.tsx`
- `tests/ui/styledOutput.test.tsx`
- `tests/cli/handlers.tui.test.ts`
- `tests/status/renderStatus.test.ts`

## Commands Run
- `rg -n "No completed features yet|..." src/ui src/status tests/ui tests/status`
- `cd /Users/warrencain/Documents/openweft && nl -ba src/ui/HistoryView.tsx | sed -n '1,260p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba src/ui/HistoryDetailView.tsx | sed -n '1,260p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba src/ui/HelpOverlay.tsx | sed -n '1,260p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba src/ui/Footer.tsx | sed -n '1,260p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba src/ui/ModelMenu.tsx | sed -n '1,260p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba src/ui/EmptyState.tsx | sed -n '1,260p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba src/ui/StatusBar.tsx | sed -n '1,260p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba src/status/renderStatus.ts | sed -n '1,260p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba src/cli/handlers.ts | sed -n '1600,2100p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba tests/ui/HelpOverlay.test.tsx | sed -n '1,220p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba tests/ui/Footer.test.tsx | sed -n '1,220p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba tests/status/renderStatus.test.ts | sed -n '1,260p'`
- `cd /Users/warrencain/Documents/openweft && nl -ba tests/cli/handlers.tui.test.ts | sed -n '1,220p'`
- `mkdir -p research-output/openweft-production-ux-review/wave-1`
- `ls research-output/openweft-production-ux-review`
- No tests were executed in this audit (read-only review only).

## Findings

### High — Completed-history views do not communicate outcome context or recovery context
- **Severity:** High
- **Area:** History list/detail (`HistoryView.tsx`, `HistoryDetailView.tsx`)
- **Evidence:**
  - History list only shows a checkmark, a truncated request (first 67 chars), and a commit hash/placeholder (`src/ui/HistoryView.tsx:16-50`).
  - Detail view shows only `✓ Completed`, `ID`, `Commit`, and full `Request` (`src/ui/HistoryDetailView.tsx:17-37`).
  - Completed feature store type only includes `id/request/mergeCommit` (`src/ui/store.ts:32-36`), so richer status context is never present in UI state.
- **User impact:** Users can confirm that a feature exists in history, but cannot see why it succeeded, whether merge checks passed, or what to do next if a commit is missing/unreachable.
- **Recommended fix:** Include summary outcome fields in completion rows (status detail, merge/repair result, timestamp), and add explicit next steps (for example: rerun, inspect diagnostics, clean workspace) directly in history/detail cards.
- **Confidence:** High (directly reflected by renderable fields and store schema).
- **What would disconfirm the finding:** UI/history would include explicit completion status, merge-reachability info, and actionable follow-up text in code/tests, not just commit/request snippets.

### High — Help overlay teaches keys, not outcomes
- **Severity:** High
- **Area:** Help overlay (`HelpOverlay.tsx`)
- **Evidence:**
  - `HelpOverlay` content is mode-specific shortcut lists only (`src/ui/HelpOverlay.tsx:15-109`).
  - It never renders current run state, failure causes, or recovery suggestions.
- **User impact:** In abnormal states (paused, failed, resumable checkpoint, stop requested), users only get control labels and no interpretation of consequences, increasing trial-and-error.
- **Recommended fix:** Add one-line context per mode, plus 1–2 recovery actions (for example: “If a feature failed, run `openweft status` to inspect diagnostics, then retry / remove checkpoint rows as needed.”).
- **Confidence:** High.
- **What would disconfirm the finding:** A mode-sensitive, state-aware overlay that includes explicit state interpretation and remediation guidance.

### Medium — Footer and status bar optimize control discoverability over state explanation
- **Severity:** Medium
- **Area:** Footer + Status bar (`Footer.tsx`, `StatusBar.tsx`)
- **Evidence:**
  - Footer renders command hints only (`src/ui/Footer.tsx:16-64`) and does not communicate what phase of work the user is currently in beyond mode hint.
  - `StatusBar` exposes token/phase/model/active/pending counts but not run result summary or recommended next action when work is stopped/failed (`src/ui/StatusBar.tsx:26-63`).
- **User impact:** Users can see where keys go, but have weak affordance for interpreting current health. This is especially confusing when transitions occur (e.g., from execution to failed/durability warning).
- **Recommended fix:** Add a compact status sentence (e.g., `Status: running – 2 feature(s) executing, 1 failed, 3 in queue`) plus a short next-step hint for each state.
- **Confidence:** High.
- **What would disconfirm the finding:** Tests and UI showing explicit run-state summaries and state-specific next actions in these bars.

### Medium — Model menu saves to next run without clearly stating immediate effect
- **Severity:** Medium
- **Area:** Model menu and model persistence (`ModelMenu.tsx`, `src/cli/handlers.ts`, `src/ui/hooks/useKeyboard.ts`)
- **Evidence:**
  - Menu instructions stop at control-level UX (`Use up/down..., Enter to save, Esc to cancel`, `src/ui/ModelMenu.tsx:43-94`) with no persistence semantics.
  - Save handler confirms success with a generic notice: “Saved model + effort for the next run” (`src/cli/handlers.ts:2064-2067`).
  - Keyboard path blocks save entirely if callback unavailable, with only a terse error (`src/ui/hooks/useKeyboard.ts:439-444`).
- **User impact:** Users may assume save affects current run or understand failure conditions poorly; “why it didn’t save” is not explained in-menu and requires noticing a transient notice line.
- **Recommended fix:** Add inline persistence status (“Current run unchanged; saved for next run”), explicit fallback text when unsupported, and inline validation of selected combinations.
- **Confidence:** Medium-High.
- **What would disconfirm the finding:** Persistent model menu UI includes explicit scoping and success/failure explanations plus test assertions covering both success and unsupported-config cases.

### Medium — Empty-state onboarding is visually rich but guidance is shallow for recovery actions
- **Severity:** Medium
- **Area:** Empty state (`EmptyState.tsx`, dashboard rendering path in `App.tsx`)
- **Evidence:**
  - Empty state is primarily a visual animation with a hard-coded visual hint only (“Press a ... to add, s ... to start”) (`src/ui/EmptyState.tsx:108-114`) and no contextual text about why queue is empty or how to proceed after a failure history.
  - Dashboard enters this state when no agents are present (`src/ui/App.tsx:346-369`) and immediately prioritizes agent listing/loom over state narrative.
- **User impact:** A new operator can start, but may miss safer next actions after a failed run or a stopped checkpoint because next-step framing is absent once the animation passes.
- **Recommended fix:** Keep a static text footer in empty state with explicit next actions and paths (`openweft add`, `openweft status`, `openweft launch`, `openweft stop`), and include run-state context if a checkpoint exists.
- **Confidence:** Medium.
- **What would disconfirm the finding:** Empty-state tests and code showing persisted narrative (run status + suggested command) in both animated and post-animation phases.

### High — CLI status output is diagnostic-heavy but does not give next-step guidance
- **Severity:** High
- **Area:** Status rendering (`src/status/renderStatus.ts`, `src/cli/handlers.ts`)
- **Evidence:**
  - `renderStatusReport` produces raw state/counters/diagnostic buckets (`src/status/renderStatus.ts:99-133`, `135-156`) but no command-level recommendation at the end of failure/durability edge cases.
  - `status` handler outputs this string directly for non-TTY without explanatory remediation (`src/cli/handlers.ts:2519-2528`).
  - TTY `StatusCard` similarly outputs diagnostics only (`src/ui/styledOutput.tsx:20-63`).
- **User impact:** Operators get enough signal to debug manually, but not enough guidance to recover quickly (e.g., rerun policy, checkpoint recovery, or when to escalate).
- **Recommended fix:** Add a compact “Next step” block per state/diagnostic class (e.g., failure/reachability not verified, merge missing commit, diagnostics stale).
- **Confidence:** High.
- **What would disconfirm the finding:** Status/report tests and snapshots validating context-specific recovery suggestions for failed/paused/backup-sourced runs.

## User State Comprehension Map
- **Idle dashboard (no run):**
  - Learns: keys and current model/run-level metadata.
  - Understands partially: how to start and modify queue.
  - Missing: clear confirmation of whether any prior run state exists and what to do first after a failed previous run.

- **Queue running (agents visible):**
  - Learns: queued/running items and token counts.
  - Understands partially: how to pause/remove/add.
  - Missing: why an item is failing/retriable, what “resumable checkpoint” implies in practice.

- **History mode:**
  - Learns: each completed entry text + commit.
  - Understands partially: completion happened.
  - Missing: what changed, if it is healthy, and what to recover next.

- **History detail:**
  - Learns: request text and identity.
  - Understands partially: which commit belongs to the item.
  - Missing: execution result breakdown, validation status, and next operational action.

- **Help overlay:**
  - Learns: available key combinations.
  - Understands partially: navigation mechanics.
  - Missing: contextual interpretation (“what happened”, “what next now”).

- **Model menu:**
  - Learns: backend/model/effort options and when to save/cancel.
  - Understands partially: control changes.
  - Missing: persistence scope and immediate effect.

- **CLI status (`openweft status`):**
  - Learns: technical internals and diagnostics.
  - Understands partially: machine state and artifact health.
  - Missing: direct next-step recommendations for remediation.

## Domino / Second-Order Risks
- **Hiding detail in history mode** can push operators to trust completion history blindly. If recovery is later needed, they may restart from ambiguous “completed” artifacts and duplicate work because failure mode visibility is not retained.
- **Moving detail into history-only screens** creates context switching between live run and post-run introspection. In incident moments (failures while running), users need inline recovery direction, not just a separate navigation path.
- **Simplifying help into shortcuts-only text** increases dependence on out-of-band docs and raises the cost of recovery under pressure; in practice, this tends to delay action and increase wrong-key attempts.
- **Changing model defaults silently (or without persistence framing)** can cause silent drift between runs: a user may think a new model change is active now when it will apply next run only, or fail to notice unsupported persistence and keep retrying the same command with no effect.

## Recommended Follow-Up
- Add state-aware overlay lines for each mode (`running`, `paused`, `failed`, `backup`) including recommended first action.
- Expand `HistoryDetailView` to include runtime outcomes (success/fail reason, durability summary, timestamp), and expose “safe action” entries.
- Update `HelpOverlay` and `StatusBar` to include 1-line state interpretation + next command.
- Add explicit model menu persistence messaging in-line and an explicit “not supported” fallback path when config edits cannot be saved.
- Add tests in `tests/ui` and `tests/cli` that fail if these user-facing recovery hints are removed or regress.

###COMPLETE###
