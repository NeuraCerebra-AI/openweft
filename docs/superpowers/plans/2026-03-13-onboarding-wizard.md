# Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive first-run onboarding wizard that guides users from installation to their first orchestration run.

**Architecture:** 6-step Ink wizard rendered via `fullscreen-ink`, triggered from `launchCommand` when no config exists and stdout is a TTY. Wizard collects environment info, backend selection, and feature requests, then hands off to `startCommand` for the TUI dashboard. All side effects go through injectable `WizardCallbacks`.

**Tech Stack:** Ink 5.x, React, fullscreen-ink, execa (git commands), existing theme/config/queue modules.

**Spec:** `docs/superpowers/specs/2026-03-13-onboarding-design.md`

**Conventions (from CLAUDE.md):**
- ESM-only, `.js` extensions on imports, `import type` for type-only
- `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- Zod `.strict()` for schemas
- Tests mirror `src/` under `tests/`, Vitest with globals
- DI pattern for all external calls

---

## File Structure

```
src/ui/onboarding/
  types.ts                — OnboardingState, BackendDetection (extracted), WizardCallbacks, StepKey
  runOnboardingWizard.ts  — Pre-checks → Ink app → result. Main export consumed by handlers.ts
  OnboardingApp.tsx       — Root Ink component. State machine, useInput, step routing
  ProgressBar.tsx         — Dot progress indicator (green/blue/dim + "N/6" count)
  WizardFooter.tsx        — Contextual keybinding hints per step
  CompletedSummary.tsx    — Horizontal "✓ label" row of completed steps
  SelectInput.tsx         — Reusable ↑↓ selector with highlight
  TextInputField.tsx      — Bordered text input with › prompt
  StepWelcome.tsx         — Step 1: welcome, git/node checks, git-init error state
  StepBackends.tsx        — Step 2: detection results, backend select, error state
  StepInit.tsx            — Step 3: auto-init, file list, error state
  StepFeatureInput.tsx    — Step 4: text input for first feature request
  StepAddMore.tsx         — Step 5: queued list + add-more/continue select
  StepLaunch.tsx          — Step 6: pipeline explanation, start/exit select

tests/ui/onboarding/
  types.test.ts
  runOnboardingWizard.test.ts
  OnboardingApp.test.tsx
  ProgressBar.test.tsx
  WizardFooter.test.tsx
  CompletedSummary.test.tsx
  SelectInput.test.tsx
  TextInputField.test.tsx
  StepWelcome.test.tsx
  StepBackends.test.tsx
  StepInit.test.tsx
  StepFeatureInput.test.tsx
  StepAddMore.test.tsx
  StepLaunch.test.tsx

Modified:
  src/cli/handlers.ts     — Extract BackendDetection, export templates, add git deps, wire wizard into launchCommand
```

---

## Chunk 1: Foundation — Types, Shared Components, and Extraction

### Task 1: Extract shared types and constants from handlers.ts

**Files:**
- Create: `src/ui/onboarding/types.ts`
- Modify: `src/cli/handlers.ts`
- Test: `tests/ui/onboarding/types.test.ts`

- [ ] **Step 1: Write type test** — Import `BackendDetection`, `OnboardingState`, `WizardCallbacks` from types.ts. Assert they compile with correct shapes using `expectTypeOf` or assignment tests.

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/ui/onboarding/types.test.ts`

- [ ] **Step 3: Create types.ts** — Define all types per spec:
```typescript
// src/ui/onboarding/types.ts
export interface BackendDetection {
  installed: boolean;
  authenticated: boolean;
}

export type StepKey = 1 | 2 | 3 | 4 | 5 | 6;

export interface OnboardingState {
  currentStep: StepKey;
  gitDetected: boolean;
  hasCommits: boolean;
  codexStatus: BackendDetection;
  claudeStatus: BackendDetection;
  selectedBackend: 'codex' | 'claude' | null;
  gitInitError: string | null;
  initialized: boolean;
  initError: string | null;
  queuedRequests: string[];
  launchDecision: 'start' | 'exit' | null;
}

export interface WizardCallbacks {
  onGitInit: () => Promise<void>;
  onRunInit: (backend: 'codex' | 'claude') => Promise<void>;
  onQueueRequest: (request: string) => Promise<void>;
  onRedetectBackends: () => Promise<{ codex: BackendDetection; claude: BackendDetection }>;
}
```

- [ ] **Step 4: Update handlers.ts** — Change the local `BackendDetection` interface to `import type { BackendDetection } from '../ui/onboarding/types.js'`. Export the two template constants (`DEFAULT_PROMPT_A_TEMPLATE`, `DEFAULT_PLAN_ADJUSTMENT_TEMPLATE`).

- [ ] **Step 5: Run tests** — `npx vitest run tests/ui/onboarding/types.test.ts` and `npx vitest run tests/cli/handlers.test.ts` (ensure existing tests still pass).

- [ ] **Step 6: Commit** — `git commit -m "refactor: extract BackendDetection and onboarding types"`

### Task 2: Add git detection dependencies to CliDependencies

**Files:**
- Modify: `src/cli/handlers.ts`
- Test: `tests/cli/handlers.test.ts`

- [ ] **Step 1: Write tests** — Test the 5 new git dependency functions: `detectGitInstalled`, `detectGitRepo`, `detectGitHasCommits`, `initGitRepo`, `createInitialCommit`. Test both success and failure paths using the existing mock injection pattern.

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/cli/handlers.test.ts -t "git"`

- [ ] **Step 3: Implement** — Add 5 new functions to `CliDependencies` interface and `defaultDependencies`. Each wraps an `execa('git', [...])` call. `detectGitInstalled`: `git --version`. `detectGitRepo`: `git rev-parse --git-dir`. `detectGitHasCommits`: `git rev-parse HEAD`. `initGitRepo`: `git init`. `createInitialCommit`: `git commit --allow-empty -m "Initial commit"`.

- [ ] **Step 4: Run tests** — `npx vitest run tests/cli/handlers.test.ts`

- [ ] **Step 5: Commit** — `git commit -m "feat(cli): add git detection dependencies to CliDependencies"`

### Task 3: ProgressBar component

**Files:**
- Create: `src/ui/onboarding/ProgressBar.tsx`
- Test: `tests/ui/onboarding/ProgressBar.test.tsx`

- [ ] **Step 1: Write tests** — Render ProgressBar with `steps={6}` and `current={3}`. Assert: 2 green dots (done), 1 blue dot (active), 3 dim dots (pending), text "3 / 6".

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement** — Simple `<Box>` with mapped dots. Each dot is a `<Text>` with color based on position vs current. Use theme colors from `useTheme()`.

- [ ] **Step 4: Run tests** — Pass

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add ProgressBar component for onboarding wizard"`

### Task 4: WizardFooter component

**Files:**
- Create: `src/ui/onboarding/WizardFooter.tsx`
- Test: `tests/ui/onboarding/WizardFooter.test.tsx`

- [ ] **Step 1: Write tests** — Render with different key sets. Assert correct labels appear. E.g., `keys={['select', 'confirm', 'back', 'quit']}` shows `↑↓ select · Enter confirm · ← back · Esc quit`.

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement** — Map key identifiers to display strings. Render as a horizontal `<Box>` with `<Text>` elements. Styled like the existing Footer component (surface background, dim text).

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add WizardFooter component"`

### Task 5: CompletedSummary component

**Files:**
- Create: `src/ui/onboarding/CompletedSummary.tsx`
- Test: `tests/ui/onboarding/CompletedSummary.test.tsx`

- [ ] **Step 1: Write tests** — Render with items `['Environment', 'Backend: codex']`. Assert `✓ Environment` and `✓ Backend: codex` appear. Render with empty array, assert nothing renders.

- [ ] **Step 2-4: Implement and verify**

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add CompletedSummary component"`

### Task 6: SelectInput component

**Files:**
- Create: `src/ui/onboarding/SelectInput.tsx`
- Test: `tests/ui/onboarding/SelectInput.test.tsx`

- [ ] **Step 1: Write tests** — Render with options `[{label:'A', value:'a'}, {label:'B', value:'b'}]`. Assert first option has `›` indicator. Simulate down arrow, assert second option gets indicator. Simulate Enter, assert `onSelect` callback fires with `'b'`.

- [ ] **Step 2-4: Implement and verify** — Track `focusedIndex` in local state. `useInput` for arrow keys and Enter. Render options with active/inactive styling per mockup.

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add SelectInput component for onboarding wizard"`

### Task 7: TextInputField component

**Files:**
- Create: `src/ui/onboarding/TextInputField.tsx`
- Test: `tests/ui/onboarding/TextInputField.test.tsx`

- [ ] **Step 1: Write tests** — Render, type text, assert `onChange` fires. Press Enter, assert `onSubmit` fires with trimmed text. Press Enter with empty input, assert `onSubmit` NOT called. Press Esc with text, assert input clears. Press Esc with empty input, assert `onExit` fires.

- [ ] **Step 2-4: Implement and verify** — Bordered box with `›` prompt. Use Ink's `useInput` to capture characters. Track value in local state. Handle Esc double-tap logic per spec.

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add TextInputField component"`

---

## Chunk 2: Step Components

### Task 8: StepWelcome (Step 1)

**Files:**
- Create: `src/ui/onboarding/StepWelcome.tsx`
- Test: `tests/ui/onboarding/StepWelcome.test.tsx`

- [ ] **Step 1: Write tests** — (a) Render with `gitDetected=true`: assert "Git repository detected" with checkmark. (b) Render with `gitDetected=false`: assert "No git repository found" title and SelectInput with "Initialize git here" / "Exit". (c) Render with `gitInitError`: assert error message displayed.

- [ ] **Step 2-4: Implement and verify** — Show brand header, description, environment checks. Conditionally render git-init select or success state. Call `callbacks.onGitInit()` when "Initialize git here" selected; catch errors and set `gitInitError`.

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add StepWelcome onboarding component"`

### Task 9: StepBackends (Step 2)

**Files:**
- Create: `src/ui/onboarding/StepBackends.tsx`
- Test: `tests/ui/onboarding/StepBackends.test.tsx`

- [ ] **Step 1: Write tests** — (a) Both authed: render SelectInput with Codex/Claude. (b) One authed: assert auto-select message. (c) Neither ready: assert error state with install instructions.

- [ ] **Step 2-4: Implement and verify** — Detection results displayed with ✓/!/✗ icons. Branch on availability per spec. Call `callbacks.onRedetectBackends()` on mount (to support back-nav re-detection).

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add StepBackends onboarding component"`

### Task 10: StepInit (Step 3)

**Files:**
- Create: `src/ui/onboarding/StepInit.tsx`
- Test: `tests/ui/onboarding/StepInit.test.tsx`

- [ ] **Step 1: Write tests** — (a) Success: assert all 6 items with checkmarks. (b) Error: assert error title and message. (c) Tip text present.

- [ ] **Step 2-4: Implement and verify** — Call `callbacks.onRunInit(selectedBackend)` on mount. Display results or error. The `onRunInit` callback in `runOnboardingWizard` calls the extracted init logic (ensureRuntimeDirectories, ensureStarterFile, config write, .gitignore update).

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add StepInit onboarding component"`

### Task 11: StepFeatureInput (Step 4)

**Files:**
- Create: `src/ui/onboarding/StepFeatureInput.tsx`
- Test: `tests/ui/onboarding/StepFeatureInput.test.tsx`

- [ ] **Step 1: Write tests** — (a) Render: assert title and TextInputField. (b) Submit text: assert `callbacks.onQueueRequest` called. (c) Submit empty: assert no callback.

- [ ] **Step 2-4: Implement and verify**

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add StepFeatureInput onboarding component"`

### Task 12: StepAddMore (Step 5)

**Files:**
- Create: `src/ui/onboarding/StepAddMore.tsx`
- Test: `tests/ui/onboarding/StepAddMore.test.tsx`

- [ ] **Step 1: Write tests** — (a) Shows queued items with IDs. (b) "Continue to launch" fires advance. (c) "Add another" shows inline TextInputField. (d) Submitting inline input adds to queue and refreshes list.

- [ ] **Step 2-4: Implement and verify** — Two modes: select mode (Continue/Add another) and input mode (TextInputField). Toggle between them.

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add StepAddMore onboarding component"`

### Task 13: StepLaunch (Step 6)

**Files:**
- Create: `src/ui/onboarding/StepLaunch.tsx`
- Test: `tests/ui/onboarding/StepLaunch.test.tsx`

- [ ] **Step 1: Write tests** — (a) Shows pipeline steps 1-4. (b) Shows useful commands. (c) "Start now" fires launch decision. (d) "Exit" fires exit decision.

- [ ] **Step 2-4: Implement and verify**

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add StepLaunch onboarding component"`

---

## Chunk 3: Orchestration — OnboardingApp, runOnboardingWizard, Handler Wiring

### Task 14: OnboardingApp root component

**Files:**
- Create: `src/ui/onboarding/OnboardingApp.tsx`
- Test: `tests/ui/onboarding/OnboardingApp.test.tsx`

- [ ] **Step 1: Write tests** — (a) Renders step 1 initially. (b) Pressing Enter advances to step 2. (c) Pressing ← on step 2 goes back to step 1. (d) ← on step 1 does nothing. (e) Esc calls exit. (f) Progress bar shows correct step. (g) CompletedSummary grows with each step. (h) Footer keys change per step.

- [ ] **Step 2-4: Implement and verify** — Manage `OnboardingState` with `useState`. Render: WizardHeader (brand text), ProgressBar, divider, active step component, CompletedSummary, WizardFooter. Handle `useInput` for global keys (← back, Esc quit). Pass state and callbacks to step components. Step components call `onAdvance()` / `onBack()` / `onSetState()` to drive transitions.

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add OnboardingApp root component with step navigation"`

### Task 15: runOnboardingWizard orchestration function

**Files:**
- Create: `src/ui/onboarding/runOnboardingWizard.ts`
- Test: `tests/ui/onboarding/runOnboardingWizard.test.ts`

- [ ] **Step 1: Write tests** — (a) Returns `{ launch: true }` when user completes wizard with "Start now". (b) Returns `{ launch: false }` when user selects "Exit". (c) Runs git detection pre-checks. (d) Creates WizardCallbacks that call correct dependencies. (e) Launches and exits Ink app. Use mock dependencies throughout.

- [ ] **Step 2-4: Implement and verify** — Function signature: `async function runOnboardingWizard(deps: CliDependencies): Promise<{ launch: boolean }>`. Phase 1: run git + backend checks via deps. Phase 2: create WizardCallbacks binding deps. Phase 3: launch Ink app (`withFullScreen`), pass initial state + callbacks. Phase 4: await exit, return result. The `onRunInit` callback must: call `ensureRuntimeDirectories`, `ensureQueueFile`, `ensureStarterFile` for both prompts, write config, update `.gitignore`.

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): add runOnboardingWizard orchestration function"`

### Task 16: Wire wizard into launchCommand

**Files:**
- Modify: `src/cli/handlers.ts`
- Test: `tests/cli/handlers.test.ts`

- [ ] **Step 1: Write tests** — (a) TTY + no config → calls `runOnboardingWizard`. (b) TTY + no config + wizard returns `{launch: true}` → calls `startCommand`. (c) TTY + no config + wizard returns `{launch: false}` → exits without starting. (d) Non-TTY + no config → existing `initCommand` behavior (no wizard). (e) Config exists → existing behavior unchanged.

- [ ] **Step 2-4: Implement and verify** — Modify `launchCommand` per spec: check `process.stdout.isTTY` and `config.configFilePath === null`. If both true, dynamic-import and call `runOnboardingWizard(resolvedDependencies)`. If result.launch, call `startCommand({})`.

- [ ] **Step 5: Run full test suite** — `npm test` — all existing tests plus new onboarding tests must pass.

- [ ] **Step 6: Commit** — `git commit -m "feat(cli): wire onboarding wizard into launch command"`

### Task 17: Add .gitignore handling to initCommand

**Files:**
- Modify: `src/cli/handlers.ts`
- Test: `tests/cli/handlers.test.ts`

- [ ] **Step 1: Write tests** — (a) `initCommand` creates `.gitignore` with `.openweft/` if no `.gitignore` exists. (b) Appends `.openweft/` to existing `.gitignore` if entry missing. (c) Does nothing if `.gitignore` already contains `.openweft/`.

- [ ] **Step 2-4: Implement and verify** — After existing init logic, add gitignore handling. Read `.gitignore` if exists, check for `.openweft/` line, append if missing.

- [ ] **Step 5: Run tests** — `npx vitest run tests/cli/handlers.test.ts`

- [ ] **Step 6: Commit** — `git commit -m "feat(cli): add .gitignore handling to init command"`

### Task 18: Final integration test and typecheck

- [ ] **Step 1: Run typecheck** — `npm run typecheck` — must pass clean

- [ ] **Step 2: Run full test suite** — `npm test` — all tests pass

- [ ] **Step 3: Manual smoke test** — `npm run openweft` in a temp directory (not a git repo) — verify the wizard launches, detects no git, offers to init, walks through all 6 steps

- [ ] **Step 4: Commit any fixes** — If smoke test reveals issues, fix and commit

- [ ] **Step 5: Create index export** — Create `src/ui/onboarding/index.ts` barrel export for `runOnboardingWizard` and types. Commit.
