# Wave 1 Findings: onboarding-wizard

## Scope
Wave 1 audits the first-run onboarding wizard and first-run CLI launch/init path against production-readiness UX goals: reducing setup fear, making prerequisites and auth/model choices clear, and giving users an unambiguous “what to do next” path before they run live work.

Focus files: `src/ui/onboarding/*`, onboarding-related tests, and first-run handler branches in `src/cli/handlers.ts`.

## Files Inspected
- `/Users/warrencain/Documents/openweft/AGENTS.md`
- `/Users/warrencain/Documents/openweft/CLAUDE.md`
- `/Users/warrencain/Documents/openweft/README.md`
- `/Users/warrencain/Documents/openweft/ARCHITECTURE.md`
- `/Users/warrencain/Documents/openweft/package.json`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/00_research_target_matrix.md`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/runOnboardingWizard.ts`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/OnboardingApp.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/StepWelcome.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/StepBackends.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/StepSuperpowers.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/StepInit.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/StepFeatureInput.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/StepAddMore.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/StepLaunch.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/WizardFooter.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/ProgressBar.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/CompletedSummary.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/onboarding/types.ts`
- `/Users/warrencain/Documents/openweft/src/cli/handlers.ts`
- `/Users/warrencain/Documents/openweft/src/config/schema.ts`
- `/Users/warrencain/Documents/openweft/src/config/options.ts`
- `/Users/warrencain/Documents/openweft/tests/ui/onboarding/runOnboardingWizard.test.ts`
- `/Users/warrencain/Documents/openweft/tests/ui/onboarding/StepBackends.test.tsx`
- `/Users/warrencain/Documents/openweft/tests/ui/onboarding/StepInit.test.tsx`
- `/Users/warrencain/Documents/openweft/tests/ui/onboarding/StepLaunch.test.tsx`
- `/Users/warrencain/Documents/openweft/tests/cli/handlers.launch.test.ts`

## Commands Run
- `wc -l AGENTS.md CLAUDE.md README.md ARCHITECTURE.md package.json`
- `wc -l research-output/openweft-production-ux-review/00_research_target_matrix.md`
- `rg --files src/ui/onboarding tests/ui/onboarding`
- Multiple `nl -ba` reads of the source and test files listed above (line-numbered evidence capture).
- `npx vitest run tests/ui/onboarding/runOnboardingWizard.test.ts tests/ui/onboarding/StepBackends.test.tsx tests/ui/onboarding/StepInit.test.tsx tests/ui/onboarding/StepLaunch.test.tsx`
  - Failed: `zsh:1: command not found: npx` (Node toolchain unavailable in this environment).

## Findings
### 1) Backend auth-mode is effectively hidden in onboarding
- **Severity:** Medium
- **Area:** Onboarding flow → backend setup and model selection
- **Evidence:**
  - `runOnboardingWizard` builds the config write payload with `getDefaultConfig()` and writes `auth` from defaults, only overriding `backend`, `models[backend]`, and `effort[backend]` (`src/ui/onboarding/runOnboardingWizard.ts:75-90`).
  - `src/ui/onboarding/StepBackends.tsx` only surfaces whether each backend is installed/authenticated and suggests `codex login` or `claude auth login`; there is no auth-mode chooser for `subscription` vs `api_key` (`src/ui/onboarding/StepBackends.tsx:38-50`, `:198-205`, `:257-267`, `:307-330`).
  - Auth config supports both modes in schema and defaults to subscription (`src/config/schema.ts:107-113`, `src/config/schema.ts:19-27`), and README documents API-key as an option (`README.md:9`, `README.md:246-251`, `README.md:312-313`).
- **User impact:** New users can complete onboarding without ever seeing API-key mode, then discover that operational preference only by editing config later. This can create unnecessary uncertainty for teams with API-key-only constraints.
- **Recommended fix:** Add an explicit auth-mode step (or optional advanced toggle) in onboarding after backend selection:
  - choose `subscription` (default) or `api_key`;
  - show exact `CODEX_API_KEY` / `ANTHROPIC_API_KEY` variable names and next action;
  - persist both choices into config.
- **Confidence:** High
- **What would disconfirm the finding:** If API-key mode is intentionally out-of-scope for production onboarding by design, and docs are updated to explicitly state that limitation.

### 2) Initialization failure path gives too little actionable recovery guidance
- **Severity:** Medium
- **Area:** Onboarding flow → `StepInit`
- **Evidence:**
  - On init error, UI renders only the raw error and a generic hint: `Check file permissions and disk space.` (`src/ui/onboarding/StepInit.tsx:128-141`).
  - `onRunInit` failures are passed through as-is from async setup operations (`src/ui/onboarding/StepInit.tsx:55-63`), while setup creates several filesystem/artifact types (`src/ui/onboarding/runOnboardingWizard.ts:68-73`, `src/ui/onboarding/runOnboardingWizard.ts:94-101`, `src/ui/onboarding/runOnboardingWizard.ts:102-103`).
  - Error-state footer gives only back/quit (`src/ui/onboarding/StepInit.tsx:84-93`), reducing ability to quickly attempt common recoveries.
- **User impact:** A first-run failure (e.g., permission/path issues) can leave users staring at a generic message with limited next-step clarity, which increases setup friction and support questions.
- **Recommended fix:** Add a small error taxonomy in `StepInit`:
  - detect common failure classes (permission denied, existing non-empty file, missing parent dir);
  - show 1–2 concrete remediation commands;
  - provide a direct retry action after user acknowledgment.
- **Confidence:** High
- **What would disconfirm the finding:** If `onRunInit` errors are already sanitized upstream into one of a tiny, actionable code set and this behavior is surfaced through a more specific message layer.

### 3) First-run launch can feel “done” before backend readiness is actually validated
- **Severity:** Medium
- **Area:** Wizard-to-CLI handoff (`StepLaunch` + launch handlers)
- **Evidence:**
  - `StepLaunch` presents a strong “Ready to start” transition and only generic queue/overview actions (`src/ui/onboarding/StepLaunch.tsx:64-103`).
  - Actual backend readiness check happens only when `openweft start` executes, in `ensureConfiguredBackendReady` (`src/cli/handlers.ts:2261-2263`, `src/cli/handlers.ts:1311-1343`).
  - Start-handler flow is triggered directly from step 7 when user chooses “Start now” (`src/ui/onboarding/OnboardingApp.tsx:231-246`).
- **User impact:** Users can be shown a polished “ready” state and then hit a hard runtime error if auth/backend is still wrong, which can feel like a trust break at the worst possible point (first execution attempt).
- **Recommended fix:** Add a preflight summary in `StepLaunch`:
  - run lightweight backend check before presenting “Start now” as the default path;
  - if not ready, downgrade to “Fix setup first” with concrete auth/install commands and keep launch blocked.
- **Confidence:** High
- **What would disconfirm the finding:** If preflight is already guaranteed to have run with identical checks outside the onboarding path for every launch route and users are consistently blocked before reaching this screen.

### 4) Git prerequisite coverage is partial for low-confidence environments
- **Severity:** Low
- **Area:** Onboarding flow → environment onboarding (`StepWelcome`, launch prechecks)
- **Evidence:**
  - Onboarding exits immediately when git is missing, with a single hard-stop line and no install/link instructions (`src/ui/onboarding/runOnboardingWizard.ts:39-43`; no corresponding actionable text in `StepWelcome`).
  - `StepWelcome` explains worktrees and offers repo initialization when Git exists, but only emits `No git repository found` + init buttons in that branch, with no direct explanation of commit-state implications (`src/ui/onboarding/StepWelcome.tsx:106-149`, `:123-155`).
  - README flags Git as a hard prerequisite (`README.md:83`) but the missing-git failure surface could still benefit from remediation copy.
- **User impact:** Most users can recover, but users in fresh or constrained environments may pause at the first block and not see next exact action.
- **Recommended fix:** Make both failure branches instructional:
  - missing git: include install command(s) + restart hint;
  - non-repo: explicitly explain why repo init is required and the impact of continuing with a non-committed tree.
- **Confidence:** Medium
- **What would disconfirm the finding:** If this project intentionally treats missing git as a hard hard-stop and this behavior already aligns with support expectations.

## Onboarding Clarity Map
- **Step 1 — Welcome/Environment:** High clarity for positive path; users quickly see git/Node prerequisites and “You’re ready” signal.
- **Step 2 — Backend selection:** Medium clarity; install/auth status is visible, but auth mode/config nuance is incomplete.
- **Step 3 — Superpowers optional:** Clear and safe (“optional” surfaced), but tangential to core first-run success.
- **Step 4 — Init:** Medium clarity; good progress list and completion UI, weak on actionable failure recovery.
- **Step 5/6 — Queue input & add-more:** High clarity; prompts and queue summary are readable.
- **Step 7 — Launch decision:** Medium-high clarity for normal run path; lower clarity on preflight validity before launching.
- **CLI first-run handoff:** Medium clarity; behavior differs by TTY/non-TTY but that branching is not deeply surfaced in onboarding itself.

## Domino / Second-Order Risks
- **If onboarding defaults hide choices (especially auth mode):** users may infer hidden constraints and switch to external workaround paths (manual config edits, reruns, support tickets), increasing trust cost.
- **If preflight validation is deferred too far downstream:** false “ready” states can appear in first-run completion, and users may over-trust the onboarding flow before a runtime failure.
- **If error copy stays generic in Step 4:** recovery attempts become trial-and-error; repeated retries can create the impression that setup is brittle even when underlying issues are simple.
- **If simplification removes backend status context:** you could accidentally regress into “successful setup + impossible start” cases that are only caught later, the most expensive trust failure pattern for onboarding.

## Recommended Follow-Up
- Add auth-mode onboarding UI and ensure it writes `auth` config intentionally (`subscription` vs `api_key` + env var names).
- Add targeted onboarding-specific failure UX for Step 4 init (permission/permission- denied / path issues + one-click retry).
- Add a preflight readiness check screen/action in `StepLaunch` before “Start now” is enabled.
- Add/expand screenshot or renderer tests for:
  - auth-mode absence/absence-inclusion,
  - init error states with actionable messaging,
  - launch state when backends are unavailable.

###COMPLETE###
