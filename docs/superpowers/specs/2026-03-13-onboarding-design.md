# OpenWeft Onboarding — Design Spec

## Overview

An interactive first-run onboarding wizard that guides users from `npm install -g openweft` to their first orchestration run. Triggered when a user types bare `openweft` in a TTY and no config file exists.

**Interaction model:** Step wizard with progress dots, back navigation (`←`), and a collapsed completed-steps summary. Each step replaces the previous on screen (Ink alternate screen or cursor clear). 6 steps for the happy path, with early-exit error states for missing git and missing backends.

**Transition:** On launch confirmation, the wizard exits and hands off to `startCommand`, which enters the full-screen TUI dashboard.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Surface | Step wizard (not sequential cards, not conversational scroll) | Clean focus on one step at a time. Progress dots give spatial awareness. Back key solves "can't review" weakness. |
| Navigation | `←` back, `↑↓` select, `Enter` confirm, `Esc` quit | Consistent with existing TUI footer keybinding conventions (Decision 6 from CLI design). |
| Step count | 6 (happy path) | Welcome/Env, Backends, Init, Feature Input, Add More, Launch. Prompt files folded into Init as a tip — no standalone step needed. |
| Progress indicator | Filled dots (green done, blue active, dim pending) + "N / 6" counter | Lightweight, doesn't assume fixed labels, works with step skipping. |
| Completed summary | Bottom row with checkmarks | Gives context without showing full previous steps. |
| Error handling | Inline error states at the step where the problem is detected | No git → error at step 1 with offer to `git init`. No backends → error at step 2 with install/auth instructions. |
| Non-interactive | Skip wizard entirely, fall through to existing `launchCommand` behavior | Scripts, CI, piped stdin — unchanged. |

---

## Flow Specification

### Phase 0: Environment Gate

```
if (!process.stdout.isTTY) → existing launchCommand behavior (no wizard)
if (configExists) → existing launchCommand behavior (returning user flow)
```

The wizard ONLY runs when: TTY + no config file found.

### Phase 1: System Checks (pre-wizard, before rendering)

These run before the wizard UI appears. They're fast checks that determine whether the wizard can proceed and what steps to show.

```
1a. git --version
    → not found: hard exit with message "Git is required. Install it and try again."
    → found: continue

1b. git rev-parse --git-dir
    → success: isGitRepo = true
    → failure: isGitRepo = false (wizard step 1 will offer to init)

1c. git rev-parse HEAD (only if isGitRepo)
    → success: hasCommits = true
    → failure: hasCommits = false (will create empty initial commit after git init or at init step)

1d. detectCodex() + detectClaude() (run in parallel)
    → store results for step 2
```

### Wizard Steps

#### Step 1: Welcome & Environment

**Purpose:** Orient the user. Confirm environment is viable.

**Content:**
- Brand: `◆ openweft` with `setup` label
- One-liner: "Orchestrate AI coding agents across parallel git worktrees."
- Second line: "You give it feature requests. It plans, phases, executes, and merges."
- Git status: `✓ Git repository detected` OR git-init prompt (see error state below)
- Node.js version: `✓ Node.js vX.Y.Z`

**Interaction:** `Enter` to continue.

**Error — No git repo:**
- Title: "No git repository found" (yellow)
- Description: "OpenWeft uses git worktrees to run agents in parallel. This directory needs to be a git repository."
- Select: "Initialize git here" (runs `git init`) / "Exit"
- If git init chosen and no commits exist: run `git commit --allow-empty -m "Initial commit"` and note it.

**Footer:** `Enter continue` · `Esc quit`

#### Step 2: Backend Detection

**Purpose:** Confirm at least one backend is available. Choose default if both are.

**Content:**
- Detection results for codex and claude, each showing:
  - `✓` green if installed + authenticated
  - `!` yellow if installed but not authenticated
  - `✗` red if not installed
- If both authenticated: show select prompt "Choose your default backend" with ↑↓ selection (Codex / Claude), showing model name as hint
- If one authenticated: auto-select, show "Using [backend] as your default backend." and `Enter` to continue
- If one installed but not authed, other ready: auto-select the ready one, mention the other needs auth

**Error — No backends available:**
- Title: "No backends available" (red)
- Shows status of each backend
- Provides install/auth commands
- "Run `openweft` again after authenticating."
- Footer: only `← back` and `Esc quit`

**Interaction:** `↑↓` select (if choice), `Enter` confirm, `←` back.

**Footer:** `↑↓ select` · `Enter confirm` · `← back` · `Esc quit`

#### Step 3: Project Initialization

**Purpose:** Create all project scaffolding. Show what was created.

**This step is automatic** — no user input required. It runs init, then displays results.

**Actions performed:**
1. Write `.openweftrc.json` with selected backend and defaults
2. Create `.openweft/` runtime directory structure
3. Create `feature_requests/queue.txt` with header comment
4. Create `prompts/prompt-a.md` with starter template
5. Create `prompts/plan-adjustment.md` with starter template
6. Add `.openweft/` to `.gitignore` (create `.gitignore` if needed, append if exists and entry missing)

**Content:**
- Title: "Project initialized" (green)
- List of created items with checkmarks and brief descriptions:
  - `.openweftrc.json` — config (backend: [selected])
  - `.openweft/` — runtime directory
  - `feature_requests/queue.txt` — work queue
  - `prompts/prompt-a.md` — plan creation prompt
  - `prompts/plan-adjustment.md` — post-merge re-planning prompt
  - `.gitignore` — added .openweft/
- Tip line (peach): "The prompt files are the biggest lever for quality. Customize them after your first run."

**Interaction:** `Enter` to continue, `←` to go back.

**Back behavior:** Going back from this step to step 2 does NOT undo initialization. The files stay on disk. If the user changes the backend selection, only `.openweftrc.json` is rewritten.

**Footer:** `Enter continue` · `← back` · `Esc quit`

#### Step 4: First Feature Request

**Purpose:** Get the user's first piece of work into the queue.

**Content:**
- Title: "What should OpenWeft build?" (sky)
- Description: "Type a feature request. One line, plain language. You can add more after."
- Text input field with `›` prompt and blinking cursor

**Interaction:** Type text, `Enter` to submit, `←` to go back (when input is empty).

**Validation:** Non-empty after trim. If empty on Enter, do nothing (stay on step).

**On submit:** Write to queue file, advance to step 5.

**Footer:** `Enter submit` · `← back` · `Esc quit`

#### Step 5: Add More Requests

**Purpose:** Let the user queue multiple features. Show what's been queued.

**Content:**
- Title: "Add more?" (sky)
- List of queued items, each showing `#NNN` ID and the request text in a bordered row
- Count: "N requests queued. Add another or continue to launch."
- Select: "Continue to launch" / "Add another request"

**If "Add another" selected:** Show text input inline (same as step 4), on submit: append to queue, refresh the list, stay on step 5.

**Interaction:** `↑↓` select, `Enter` confirm, `←` back.

**Back behavior:** Going back to step 4 does NOT remove queued items. Step 4 shows as already completed (the user can type another request there too, which just adds to the queue).

**Footer:** `↑↓ select` · `Enter confirm` · `← back` · `Esc quit`

#### Step 6: Launch

**Purpose:** Explain what's about to happen. Let user start or exit.

**Content:**
- Title: "Ready to start" (lavender)
- Pipeline explanation:
  1. Create an implementation plan for each request
  2. Score and group by file overlap — non-conflicting work runs in parallel
  3. Execute each in an isolated git worktree using [backend]
  4. Merge results, re-plan remaining work, repeat until done
- Useful commands: `openweft status`, `openweft add`, `openweft stop`
- Select: "Start now — N requests queued" (green) / "Exit — run openweft later to start"

**If Start selected:** Exit the wizard Ink app, call `startCommand({})` which will launch the full-screen TUI.

**If Exit selected:** Print "Run `openweft` when you're ready. Your queued work will be waiting." and exit cleanly.

**Interaction:** `↑↓` select, `Enter` confirm, `←` back.

**Footer:** `↑↓ select` · `Enter confirm` · `← back` · `Esc quit`

---

## State Management

The wizard maintains an internal state object:

```typescript
interface OnboardingState {
  currentStep: number;             // 1-6
  gitDetected: boolean;
  hasCommits: boolean;
  codexStatus: BackendDetection;
  claudeStatus: BackendDetection;
  selectedBackend: 'codex' | 'claude' | null;
  initialized: boolean;
  queuedRequests: string[];
  launchDecision: 'start' | 'exit' | null;
}
```

**Back navigation rules:**
- `←` moves to `currentStep - 1` (minimum 1)
- State from completed steps is preserved (selections, queued items)
- Initialization is idempotent — going back and forward through step 3 doesn't duplicate files
- Text input steps: `←` only works when the input field is empty (otherwise `←` is cursor movement)

**Esc behavior:** Exits the wizard immediately. Any files already created (from init) remain on disk. The user can resume by running `openweft` again — config will exist, so they'll get the returning-user flow instead of re-running onboarding.

---

## Rendering Architecture

### Ink Component Tree

```
<OnboardingApp>
  <WizardHeader brand="openweft" label="setup" />
  <ProgressBar steps={6} current={state.currentStep} />
  <Divider />
  <WizardContent>
    {/* Renders the current step component */}
    <StepWelcome />        | step 1
    <StepBackends />       | step 2
    <StepInit />           | step 3
    <StepFeatureInput />   | step 4
    <StepAddMore />        | step 5
    <StepLaunch />         | step 6
  </WizardContent>
  <CompletedSummary items={completedItems} />
  <WizardFooter keys={currentStepKeys} />
</OnboardingApp>
```

### Key Components

- **`WizardHeader`**: Brand name + "setup" label. Always visible.
- **`ProgressBar`**: Row of dots. Green filled = done, blue glowing = active, dim = pending. Plus "N / 6" count.
- **`WizardContent`**: Renders only the active step component. Step components receive state and callbacks.
- **`CompletedSummary`**: Horizontal row of `✓ label` items for completed steps. Grows as user progresses.
- **`WizardFooter`**: Keybinding hints. Content varies per step.
- **`SelectInput`**: Reusable ↑↓ selection component (used in steps 2, 5, 6, and error states).
- **`TextInputField`**: Bordered text input with `›` prompt (used in step 4, and inline in step 5).

### Rendering Strategy

Use Ink with `fullscreen-ink` (same as the main TUI). The wizard runs as a separate Ink app that exits before `startCommand` launches its own Ink app. This avoids nesting two full-screen Ink apps.

```
onboarding wizard (Ink app #1)
  → user selects "Start now"
  → wizard unmounts, exits
  → startCommand launches TUI (Ink app #2)
```

No alternate-screen flicker between them — `fullscreen-ink` handles cleanup, then `startCommand` enters its own alternate screen.

---

## Integration with Existing Code

### Entry Point (`src/bin/openweft.ts`)

No changes needed. The existing `handlers.launch()` path handles the bare `openweft` command.

### Handler Changes (`src/cli/handlers.ts`)

The `launchCommand` function is modified to detect TTY + no config and invoke the onboarding wizard instead of calling `initCommand` directly.

```typescript
// Current behavior (simplified):
if (config.configFilePath === null) {
  await initCommand();
  writeLine('OpenWeft is ready. Next: run openweft add...');
  return;
}

// New behavior:
if (config.configFilePath === null) {
  if (process.stdout.isTTY) {
    const result = await runOnboardingWizard(resolvedDependencies);
    if (result.launch) {
      await startCommand({});
    }
    return;
  }
  // Non-TTY: existing behavior
  await initCommand();
  writeLine('OpenWeft is ready...');
  return;
}
```

### Dependencies Added to `CliDependencies`

```typescript
detectGitInstalled: () => Promise<boolean>;
detectGitRepo: () => Promise<boolean>;
detectGitHasCommits: () => Promise<boolean>;
initGitRepo: () => Promise<void>;
createInitialCommit: () => Promise<void>;
```

These wrap `execa('git', [...])` calls and are injectable for testing.

### New Files

```
src/ui/onboarding/
  OnboardingApp.tsx       — Root component, state machine, keyboard handling
  WizardHeader.tsx        — Brand + "setup" label
  ProgressBar.tsx         — Dot progress indicator
  CompletedSummary.tsx    — Completed steps row
  WizardFooter.tsx        — Keybinding hints
  SelectInput.tsx         — Reusable ↑↓ selector
  TextInputField.tsx      — Bordered text input
  StepWelcome.tsx         — Step 1
  StepBackends.tsx        — Step 2
  StepInit.tsx            — Step 3
  StepFeatureInput.tsx    — Step 4
  StepAddMore.tsx         — Step 5
  StepLaunch.tsx          — Step 6
  types.ts                — OnboardingState, step types
  runOnboardingWizard.ts  — Orchestration function (pre-checks → Ink app → result)
```

### Reused Existing Components

- **Theme**: `ThemeContext` + `catppuccinMocha` from `src/ui/theme.ts`
- **Init logic**: Reuses `ensureRuntimeDirectories`, `ensureStarterFile`, `ensureQueueFile`, `writeTextFileAtomic` from handlers
- **Queue logic**: Reuses `appendRequestsToQueueContent`, `getNextFeatureIdFromQueue` from `src/domain/queue.ts`
- **Backend detection**: Reuses `detectCodex`, `detectClaude` from `CliDependencies`
- **Config**: Reuses `getDefaultConfig`, `loadOpenWeftConfig` from `src/config/`

---

## Test Strategy

### Unit Tests

- **Step navigation**: forward/back transitions, boundary behavior (can't go before step 1)
- **State preservation**: going back retains selections and queued items
- **Backend selection logic**: auto-select when one available, prompt when both, error when none
- **Queue accumulation**: multiple add cycles in step 5
- **Git detection**: all combinations (no git, no repo, no commits, all good)
- **Progress bar**: correct dot states at each step

### Integration Tests

- **Full wizard flow**: mock all dependencies, simulate keypresses through all 6 steps
- **Error flows**: no git → git init, no backends → exit
- **Back navigation**: step 5 → step 4 → step 5 preserves queue
- **Launch handoff**: wizard exits cleanly, returns `{ launch: true }`, handler calls startCommand
- **Non-TTY bypass**: verify wizard doesn't run when not a TTY
- **Idempotent init**: going back through step 3 doesn't duplicate files

### Snapshot Tests

- Each step rendered at its default state
- Error states rendered

---

## Non-Functional Requirements

- **Performance**: Pre-checks (git, backends) run in parallel before the wizard UI appears. No visible delay on step transitions.
- **Accessibility**: All information conveyed through text, not just color. Checkmarks (✓), crosses (✗), and exclamation marks (!) provide status independent of color.
- **Graceful degradation**: If not a TTY, entire wizard is skipped — existing non-interactive behavior preserved.
- **Idempotency**: Running `openweft` after partial onboarding (Esc mid-flow, Ctrl+C) works correctly — config exists → returning user flow. No duplicate files.
