# Single-Column Card Redesign

## Problem

The current two-column layout wastes the entire right panel on raw agent output that nobody reads. During idle it shows "Waiting for output..." in a giant empty box. During execution it shows unstructured LLM chatter. The footer bar is a confusing key dump.

## Decision

Kill the right panel. Replace the two-column layout with a single-column card-based UI. Add htop-style meter bars for phase/tokens/time during execution. Redesign the footer as a contextual hint line.

Prototype: `prototype/winner.html`

## Design

### Layout Structure

```
StatusBar:  ◆ openweft │ Phase 1/3 │ 2 active · 3 queued │ 14.2k tokens │ 0:47
Meters:     [Phase 1/3 ███░░░ 0/5]  [Tokens ██░░░ 14.2k]  [Time █░░░░░ 0:47]
Cards:      ┌─────────────────────────────────────────────────────────────────┐
            │ ◐ auth-middleware                     3 files  8.4k tok  0:47  │
            │   Add JWT refresh token rotation                               │
            │   files: src/auth/refresh.ts, src/auth/middleware.ts, ...       │
            │   ▸ Edit src/auth/refresh.ts                                   │
            │   0:32 Created src/auth/refresh.ts                             │
            │   0:41 Modified src/auth/middleware.ts                          │
            └─────────────────────────────────────────────────────────────────┘
            ┌─────────────────────────────────────────────────────────────────┐
            │ ◐ rate-limiter                        2 files  5.8k tok  0:42  │
            │   Sliding window rate limiting                                 │
            │   ▸ Read src/middleware/index.ts                               │
            └─────────────────────────────────────────────────────────────────┘
            ┌─────────────────────────────────────────────────────────────────┐
            │ ○ db-migrations                       2 files           0:00  │
            │   User preferences table migration                             │
            └─────────────────────────────────────────────────────────────────┘
Footer:     NORMAL  a add · d remove · q stop run · ? help
```

### Components

#### StatusBar (existing, minor changes)
- Replace `$0.20` cost with `14.2k tokens` display
- No structural changes

#### MeterBar (new component)
- Three horizontal meters: Phase (blue), Tokens (peach), Time (green)
- Each meter has: label (left), value (right), colored fill bar
- Only rendered when `phase !== null` (during execution)
- Phase denominator = total agents, numerator = completed agents
- Tokens: total across all agents, max scale TBD (auto-scale or configurable)
- Time: elapsed seconds, max scale = 10 minutes (600s)

#### AgentCard (replaces Sidebar + MainPanel)
- Full-width card per agent
- Border-left color indicates status: green (running), gray (queued), green (completed, dimmed), red (failed), yellow (approval)
- Focused card gets blue border + subtle background highlight
- Card top row: status icon, agent name (bold), badges (file count, token count), elapsed time
- Card detail (always shown): feature description text
- Card detail (focused only): file list, current tool, approval box, events timeline
- Unfocused running agents show current tool inline in detail area
- Completed agents are dimmed (opacity)

#### Footer (redesigned)
- Mode badge: colored background pill (`NORMAL` blue, `APPROVAL` yellow)
- Contextual hint text, not a key dump
- States:
  - Idle: `Press s to start · a add · d remove · ? help`
  - Executing: `a add · d remove · q stop run · ? help`
  - Approval: `Approve y · Deny n · Always a · Skip s`
- `d` remove available in both idle and executing states (for queued items)

### Data Changes

#### AgentState additions
- `files: string[]` — manifest files (create + modify + delete) from the plan
- `tokens: number` — token count for this agent (input + output)

#### UIStore additions
- `totalTokens: number` — sum of all agent tokens
- Remove: `sidebarFocused` (no sidebar), `scrollOffset` (cards handle own scroll)
- `togglePanel()` removed — single panel, no toggling

### Keyboard Changes
- Remove `Tab` (switch panel) — single panel
- `d` works during execution (not just idle) for removing queued items
- `↑↓` navigates between cards
- `Enter` could toggle expand/collapse on focused card (optional, all cards show detail by default for focused)

### Files to Delete
- `src/ui/MainPanel.tsx` — replaced by AgentCard
- `src/ui/Sidebar.tsx` — replaced by AgentCard
- `src/ui/AgentRow.tsx` — merged into AgentCard
- `src/ui/AgentExpanded.tsx` — merged into AgentCard
- `src/ui/OutputLine.tsx` — no longer needed (no raw output view)

### Files to Create
- `src/ui/AgentCard.tsx` — card component (icon, name, badges, detail, events)
- `src/ui/MeterBar.tsx` — three-meter progress bar component

### Files to Modify
- `src/ui/App.tsx` — remove two-column layout, render meters + card list + footer
- `src/ui/store.ts` — add `files`, `tokens`, `totalTokens`; remove `sidebarFocused`, `scrollOffset`, `togglePanel`
- `src/ui/StatusBar.tsx` — show tokens instead of cost
- `src/ui/Footer.tsx` — redesign as contextual hint with mode badge; add `d` to executing state
- `src/ui/hooks/useKeyboard.ts` — remove Tab/panel switching, enable `d` during execution
- `src/ui/hooks/useOrchestratorBridge.ts` — pipe manifest files + token counts into store
- `src/ui/events.ts` — add token/file events if needed
- `src/ui/theme.ts` — no changes expected
- Tests: update all affected test files to match new component structure
