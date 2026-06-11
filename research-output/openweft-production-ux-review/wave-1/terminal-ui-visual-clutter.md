# Wave 1 Findings: terminal-ui-visual-clutter

## Scope
Read-only review of the main terminal UI surfaces that control visual density and scanability: app shell, status bars, agent cards, empty state, footer, text input, theme, utility helpers, keyboard hooks, and the matching UI tests. I stayed within the requested scope and did not expand into adjacent UI modules unless they were directly referenced by these files.

## Files Inspected
- `/Users/warrencain/Documents/openweft/AGENTS.md`
- `/Users/warrencain/Documents/openweft/CLAUDE.md`
- `/Users/warrencain/Documents/openweft/README.md`
- `/Users/warrencain/Documents/openweft/ARCHITECTURE.md`
- `/Users/warrencain/Documents/openweft/package.json`
- `/Users/warrencain/Documents/openweft/tsconfig.json`
- `/Users/warrencain/Documents/openweft/tsconfig.build.json`
- `/Users/warrencain/Documents/openweft/research-output/openweft-production-ux-review/00_research_target_matrix.md`
- `/Users/warrencain/Documents/openweft/src/ui/App.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/AgentCard.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/StatusBar.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/Footer.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/MeterBar.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/StyledCard.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/EmptyState.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/TextInputField.tsx`
- `/Users/warrencain/Documents/openweft/src/ui/theme.ts`
- `/Users/warrencain/Documents/openweft/src/ui/utils.ts`
- `/Users/warrencain/Documents/openweft/src/ui/hooks/useTerminalSize.ts`
- `/Users/warrencain/Documents/openweft/src/ui/hooks/useKeyboard.ts`
- `/Users/warrencain/Documents/openweft/tests/ui/App.test.tsx`
- `/Users/warrencain/Documents/openweft/tests/ui/AgentCard.test.tsx`
- `/Users/warrencain/Documents/openweft/tests/ui/StatusBar.test.tsx`
- `/Users/warrencain/Documents/openweft/tests/ui/MeterBar.test.tsx`
- `/Users/warrencain/Documents/openweft/tests/ui/Footer.test.tsx`
- `/Users/warrencain/Documents/openweft/tests/ui/StyledCard.test.tsx`
- `/Users/warrencain/Documents/openweft/tests/ui/theme.test.ts`
- `/Users/warrencain/Documents/openweft/tests/ui/utils.test.ts`
- `/Users/warrencain/Documents/openweft/tests/ui/hooks/useKeyboard.test.ts`
- `/Users/warrencain/Documents/openweft/tests/ui/hooks/useTerminalSize.test.ts`
- `/Users/warrencain/Documents/openweft/tests/ui/onboarding/TextInputField.test.tsx`
- `/Users/warrencain/Documents/openweft/tests/ui/onboarding/StepFeatureInput.test.tsx`
- `/Users/warrencain/Documents/openweft/tests/ui/onboarding/StepAddMore.test.tsx`

## Commands Run
- `sed -n` reads across the repo instructions, docs, target matrix, and the scoped UI files/tests.
- `nl -ba` reads across the scoped UI files and matching tests for exact line references.
- `rg -n` searches for target-matrix wording, UI density cues, and component/test references.
- `/opt/homebrew/bin/node --version` and `/opt/homebrew/bin/npm --version` -> `v24.9.0`, `11.6.0`.
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm exec vitest run tests/ui/App.test.tsx tests/ui/AgentCard.test.tsx tests/ui/StatusBar.test.tsx tests/ui/MeterBar.test.tsx tests/ui/Footer.test.tsx tests/ui/StyledCard.test.tsx tests/ui/theme.test.ts tests/ui/utils.test.ts tests/ui/hooks/useKeyboard.test.ts tests/ui/hooks/useTerminalSize.test.ts tests/ui/onboarding/TextInputField.test.tsx tests/ui/onboarding/StepFeatureInput.test.tsx tests/ui/onboarding/StepAddMore.test.tsx`
- Result: `13` test files passed, `189` tests passed.

## Findings

1. **Severity:** Medium
   **Area:** Dashboard chrome duplication and low-height crowding
   **Evidence:** `/Users/warrencain/Documents/openweft/src/ui/App.tsx:284-378` always stacks `StatusBar`, optional notice, `MeterBar`, the main content, and `Footer` inside a `height={rows}` container. `StatusBar` already shows phase, model, active/pending counts, tokens, and elapsed time at `/Users/warrencain/Documents/openweft/src/ui/StatusBar.tsx:26-61`, while `MeterBar` repeats phase, tokens, and elapsed in a second band at `/Users/warrencain/Documents/openweft/src/ui/MeterBar.tsx:66-85`. The terminal-size hook defaults to `80x24` when stdout is absent at `/Users/warrencain/Documents/openweft/src/ui/hooks/useTerminalSize.ts:9-30`. Tests keep both bands visible in the normal dashboard path at `/Users/warrencain/Documents/openweft/tests/ui/App.test.tsx:54-63,126-140` and `/Users/warrencain/Documents/openweft/tests/ui/MeterBar.test.tsx:8-32`.
   **User impact:** On a normal 24-row terminal, the UI spends several rows on repeated telemetry before the agent list appears, so the screen reads busier than the underlying task state really is.
   **Recommended fix:** Collapse the telemetry into one always-on strip, or make `MeterBar` an explicit compact/optional mode so `StatusBar` remains the single summary line.
   **Confidence:** High
   **What would disconfirm:** A terminal screenshot or product spec showing the duplicate metrics band is intentional and still leaves enough room for the agent list at standard terminal heights.

2. **Severity:** Medium
   **Area:** Focused agent card expansion
   **Evidence:** `/Users/warrencain/Documents/openweft/src/ui/AgentCard.tsx:57-100` renders the summary row, secondary feature line, file list, current tool, ready-state detail, and nested approval box inside one bordered card. The main dashboard maps one card per agent at `/Users/warrencain/Documents/openweft/src/ui/App.tsx:349-367`. The component tests explicitly exercise the stacked states at `/Users/warrencain/Documents/openweft/tests/ui/AgentCard.test.tsx:63-107,130-147`, and the dashboard test shows the removable queued hint inline at `/Users/warrencain/Documents/openweft/tests/ui/App.test.tsx:253-261`.
   **User impact:** A single focused approval or queued item can become a tall block that pushes neighboring agents offscreen, which makes scan/comparison harder right when the user is trying to inspect a problem row.
   **Recommended fix:** Keep the card body fixed-height and move deeper details into a separate detail pane or expandable drawer; if inline expansion stays, cap it to one detail block at a time.
   **Confidence:** Medium-High
   **What would disconfirm:** Rendered snapshots at common widths/heights show the focused card stays compact enough to preserve list readability.

3. **Severity:** Low
   **Area:** Empty-state visual density
   **Evidence:** `/Users/warrencain/Documents/openweft/src/ui/EmptyState.tsx:43-244` paints a full-screen glyph lattice with an animated center logo and hint text. The app swaps the whole list area to that animation when there are no agents at `/Users/warrencain/Documents/openweft/src/ui/App.tsx:113-114,345-347`. The existing tests in `/Users/warrencain/Documents/openweft/tests/ui/App.test.tsx:15-25` only prove the dashboard renders and shows the app name, not that the empty state stays calm or readable at small sizes.
   **User impact:** The no-agent state is memorable, but on a short terminal it can read as visual noise before the user has any concrete work to inspect or act on.
   **Recommended fix:** Add a compact/no-motion variant for small terminals or a toggle that swaps the loom for a calmer static empty state.
   **Confidence:** Medium
   **What would disconfirm:** Product design or screenshot evidence showing the loom is intentionally the desired centerpiece at the target terminal sizes.

## UX Clutter Map
- `StatusBar` + `MeterBar`: highest clutter pressure because the same run telemetry appears twice.
- `AgentCard`: medium-high clutter pressure when focused, because summary and detail states stack vertically.
- `EmptyState`: high visual density, but only in the zero-agent state.
- `Footer`: medium clutter pressure, mostly from the number of hints it keeps visible at once.
- `TextInputField` and the filter box: low clutter pressure; they are compact and predictable.

## Domino / Second-Order Risks
- The stacked telemetry banding makes the list area shrink first on 24-row and other short terminals.
- Once users learn to scan past duplicate metrics, they are more likely to miss the one line that actually changed.
- Focused-card expansion can encourage users to treat the list as a detail pane, which makes comparison across agents slower.
- The full-screen empty-state loom can set a precedent that the UI prefers atmosphere over scan speed, which is risky in an operational CLI.

## Recommended Follow-Up
1. Prototype a compact dashboard layout with one telemetry strip and compare 24-row renders against the current stack.
2. Add TUI snapshot or frame-assertion coverage for a small terminal size so telemetry and cards cannot grow silently.
3. Test a fixed-height focused card or split-pane detail pattern for approval and queued states.
4. Add a reduced-density empty-state variant for short terminals or first-run/zero-agent scenarios.

###COMPLETE###
