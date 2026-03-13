# OpenWeft CLI UI Design Spec

## Overview

OpenWeft is an AI coding work orchestrator that runs multiple agents in parallel across git worktrees. This spec defines the terminal UI for monitoring and controlling orchestration runs. The design targets power users who are comfortable with lazygit, tmux, btop, and AI coding tools.

Two UI modes exist:
- **Full-screen TUI** for `openweft start` — the orchestration dashboard
- **Styled text output** for one-shot commands (`init`, `add`, `status`, `stop`)

Framework: Ink 5.x (React for the terminal). Same foundation as Claude Code, Codex CLI, and Gemini CLI. Full-screen mode via `fullscreen-ink` package.

---

## TUI: `openweft start`

### Layout

Two-column layout (lazygit-style):

```
┌─ Status Bar (Segmented Chips) ────────────────────────────────────┐
├─ Sidebar ──────────┬─ Main Output Panel ──────────────────────────┤
│ > Alpha   ● 1:23   │ ◆ Alpha                                     │
│   Beta    ● 0:45   │ I'll implement the auth middleware...        │
│   Gamma   ✓ done   │                                              │
│   Delta   ○ queue  │  read_file src/routes/index.ts ✓ 82 lines   │
│                    │                                              │
│ ┌─ Expanded ─────┐ │ Good, I see the Express router. Creating     │
│ │ Alpha          │ │ JWT auth middleware:                          │
│ │ auth-system    │ │                                              │
│ │ write_file     │ │  ┌ src/middleware/auth.ts ─────────────────┐ │
│ │ $0.04 · 1:23   │ │  │ export const authMiddleware = ...       │ │
│ └────────────────┘ │  └─────────────────────────────────────────┘ │
│                    │                                              │
│ Phase 2/4 · $0.24  │ Now I need to wire this into the router█     │
├────────────────────┴──────────────────────────────────────────────┤
│ NORMAL  Tab switch panel  ↑↓ navigate  Enter focus  / filter  q quit │
└───────────────────────────────────────────────────────────────────┘
```

- **Sidebar**: Narrow left panel (~20-25 columns)
- **Main panel**: Wide right panel (remaining width)
- **Status bar**: 1 line at top
- **Footer**: 1 line at bottom
- `Tab` switches focus between sidebar and main panel
- Arrow keys navigate within the focused panel
- Full-screen via `fullscreen-ink` (`withFullScreen`) — manages alternate screen buffer automatically

### Status Bar: Segmented Chips

Single-line bar with pill-shaped segments. Each data point is a chip with a color-coded accent border.

```
◆ openweft │ ⚙ Phase 2/4 │ ⠋ 3 active │ $0.84 │ ⏱ 4:32
```

Chips and their colors:
| Chip | Color | Content |
|------|-------|---------|
| App name | mauve (`#cba6f7`) | `◆ openweft` |
| Phase | blue (`#89b4fa`) | `⚙ Phase X/Y` |
| Agents | green (`#a6e3a1`) | `⠋ N active` (spinner when running) |
| Cost | peach (`#fab387`) | `$X.XX` |
| Elapsed | text (`#cdd6f4`) | `⏱ M:SS` |

Chips are conditional: cost only appears after first token spend, phase only during execution.

### Sidebar: Expandable Agent List

Default state shows compact one-line rows:

```
> Alpha   ● 1:23
  Beta    ● 0:45
  Gamma   ✓ done
  Delta   ○ queued
```

Status icons:
| State | Icon | Color |
|-------|------|-------|
| Running | `●` (animated spinner) | blue |
| Completed | `✓` | green |
| Failed | `✗` | red |
| Queued | `○` | muted |
| Approval needed | `⚠` | yellow |

When an agent is focused/selected, its row expands to show detail:

```
┌─ Alpha ──────────┐
│ auth-system       │
│ write_file        │
│ $0.04 · 1:23     │
└──────────────────┘
```

Expanded detail fields:
- Feature name/request
- Current tool being called (or "thinking...")
- Cost and elapsed time

Footer shows phase summary: `Phase 2/4 · $0.24 total`

### Main Output Panel: Chat Transcript

Claude Code-style linear scrolling stream. The focused agent's output renders here.

Content types in the stream:

**1. AI thinking text** — streams in naturally, word by word:
```
◆ Alpha
I'll implement the authentication middleware. Let me check the
existing router structure first.
```

**2. Tool call blocks** — inline decorated blocks with left-border accent:
```
│ read_file src/routes/index.ts ✓ 82 lines
```

AI thinking text is rendered through `marked` + `marked-terminal` to convert markdown to ANSI. This handles bold, italic, lists, links, and inline code. Fenced code blocks are extracted and rendered by the dedicated `<CodeBlock>` component.

Tool block elements:
- Left border: single-character left accent via Ink `<Box borderLeft borderStyle="bold" borderColor={colors.mauve}>` in mauve (`#cba6f7`)
- Tool name: bold mauve
- File/argument: peach (`#fab387`)
- Result: green checkmark + summary

**3. Code blocks** — rendered with syntax highlighting via Shiki:
```
┌ src/middleware/auth.ts ──────────────────────┐
│ export const authMiddleware = (req, res) => {│
│   const token = req.headers['authorization'];│
│   // verify JWT...                           │
│ }                                            │
└──────────────────────────────────────────────┘
```

**4. Approval prompts** — inline yellow-bordered box:
```
⚠ Approval Required
Modify src/routes/index.ts (add import + middleware)
[y] approve  [n] deny  [a] always  [s] skip
```

When an approval appears, the footer bar switches to APPROVAL mode.

**5. Scrolling** — output is managed as a virtual scroll buffer. The zustand store holds `outputLines` per agent and a `scrollOffset`. The `<MainPanel>` slices `outputLines[scrollOffset..scrollOffset+viewportHeight]` for rendering. When the user switches focused agent (via sidebar), the panel re-renders with the new agent's buffer. `<Static>` is NOT used in the main panel (it's append-only and can't switch between agents). Instead, `React.memo` on individual `<OutputLine>` components prevents unnecessary re-renders.

Buffer cap: 5000 entries per agent. Older entries are pruned on append.

### Footer: Contextual Mode Bar

The entire bar changes based on current mode. A color-coded mode tag sits on the left.

**NORMAL mode** (blue tag):
```
NORMAL  Tab switch panel  ↑↓ navigate  Enter focus  / filter  q quit  ? help
```

**APPROVAL mode** (yellow tag — when any agent requests approval):
```
APPROVAL  y approve  n deny  a always  s skip  d diff  Esc back
```

**INPUT mode** (green tag — when user is typing a filter or command):
```
INPUT  Enter submit  Esc cancel  ↑↓ history
```

Mode transitions:
- NORMAL is the default
- APPROVAL activates when any agent emits an approval request
- INPUT activates when user presses `/` to filter
- `Esc` returns to NORMAL from any mode

---

## Styled Text: One-Shot Commands

Non-TUI commands use Ink's `render()` without `alternateScreen` to print styled output that remains in the scrollback. Each command wraps its output in a color-coded bordered card.

### `openweft status`

```
┌──────────────────────────────────────────────┐
│ ◆ openweft                Phase 2/4 · $0.24  │
├──────────────────────────────────────────────┤
│ ✓ Alpha  auth-system           done · $0.12  │
│ ● Beta   api-routes         1:23 · $0.08     │
│ ● Gamma  test-suite          0:45 · $0.04    │
│ ○ Delta  docs-update            queued       │
└──────────────────────────────────────────────┘
```

Border: default single-line, `#45475a` (surface1).

### `openweft init`

```
┌ ✓ Initialized ───────────────────────────────┐
│ Created .openweft/ with checkpoint.json       │
│ Run openweft add "feature" to add work        │
└──────────────────────────────────────────────┘
```

Border: green accent (`#a6e3a1`).

### `openweft add "auth system"`

```
┌──────────────────────────────────────────────┐
│ + auth system added to queue                  │
│ Queue: 5 features (3 pending, 2 completed)    │
└──────────────────────────────────────────────┘
```

Border: blue accent (`#89b4fa`).

### `openweft stop`

```
┌ ⏹ Stopping... ──────────────────────────────┐
│ ✓ Alpha shutdown · checkpoint saved           │
│ ✓ Beta shutdown · checkpoint saved            │
│ Resume: openweft start                        │
└──────────────────────────────────────────────┘
```

Border: yellow accent (`#f9e2af`).

---

## Theme System

### Architecture

React Context `<ThemeProvider>` wraps the Ink app root. Components access colors via `useTheme()` hook.

```typescript
// src/ui/theme.ts
import { createContext, useContext } from 'react';

export interface Theme {
  colors: {
    bg: string;       // '#1e1e2e'
    bgDeep: string;   // '#11111b'
    bgMid: string;    // '#181825'
    surface0: string; // '#313244'
    surface1: string; // '#45475a'
    surface2: string; // '#585b70'
    text: string;     // '#cdd6f4'
    subtext: string;  // '#a6adc8'
    blue: string;     // '#89b4fa'
    mauve: string;    // '#cba6f7'
    pink: string;     // '#f5c2e7'
    peach: string;    // '#fab387'
    sky: string;      // '#89dceb'
    teal: string;     // '#94e2d5'
    lavender: string; // '#b4befe'
    green: string;    // '#a6e3a1'
    red: string;      // '#f38ba8'
    yellow: string;   // '#f9e2af'
    muted: string;    // '#585b70'
  };
  // These map to Ink's <Box borderStyle="..."> prop values
  borders: {
    panel: 'single';       // ┌─┐└─┘ for persistent panels
    panelActive: 'bold';   // ┏━┓┗━┛ for focused/active panel
    prompt: 'round';       // ╭─╮╰─╯ for approval prompts
  };
}

export const catppuccinMocha: Theme = { /* ... values above ... */ };
export const ThemeContext = createContext<Theme>(catppuccinMocha);
export const useTheme = () => useContext(ThemeContext);
```

For non-TUI commands: import `catppuccinMocha` directly (no React context needed).

### Semantic Color Roles

| Role | Color | Hex |
|------|-------|-----|
| Primary accent | blue | `#89b4fa` |
| Brand / app name | mauve | `#cba6f7` |
| Success / done | green | `#a6e3a1` |
| Error / failed | red | `#f38ba8` |
| Warning / approval | yellow | `#f9e2af` |
| Cost / money | peach | `#fab387` |
| Tool calls | mauve | `#cba6f7` |
| File paths | peach | `#fab387` |
| Timestamps / meta | muted | `#585b70` |
| Secondary text | subtext | `#a6adc8` |

---

## State Management

### Zustand Store

A zustand store bridges the xstate orchestrator (which runs outside React) with the Ink UI.

```typescript
// src/ui/store.ts
import { create } from 'zustand';

interface AgentState {
  id: string;
  name: string;
  feature: string;
  status: 'running' | 'completed' | 'failed' | 'queued' | 'approval';
  currentTool: string | null;
  cost: number;
  elapsed: number;
  outputLines: OutputLine[];
  approvalRequest: ApprovalRequest | null;
}

interface OutputLine {
  type: 'text' | 'tool' | 'code' | 'approval';
  content: string;
  timestamp: number;
}

interface UIStore {
  // Session
  phase: { current: number; total: number } | null;
  totalCost: number;
  elapsed: number;

  // Agents
  agents: AgentState[];
  focusedAgentId: string | null;

  // UI state
  mode: 'normal' | 'approval' | 'input';
  sidebarFocused: boolean;
  filterText: string;
  scrollOffset: number;        // Main panel scroll position
  showHelp: boolean;           // Help overlay visible

  // Actions
  setAgents: (agents: AgentState[]) => void;
  updateAgent: (id: string, patch: Partial<AgentState>) => void;
  appendOutput: (agentId: string, line: OutputLine) => void;
  setFocusedAgent: (id: string | null) => void;
  setMode: (mode: UIStore['mode']) => void;
  togglePanel: () => void;
}

export const useStore = create<UIStore>((set) => ({
  // ... initial state and actions
}));
```

### Orchestrator Event Contract

The orchestrator emits structured events via a callback. The UI bridge converts these into zustand mutations.

```typescript
// src/ui/events.ts
type OrchestratorEvent =
  | { type: 'agent:started'; agentId: string; name: string; feature: string }
  | { type: 'agent:text'; agentId: string; text: string }
  | { type: 'agent:tool-call'; agentId: string; tool: string; args: string; result?: string }
  | { type: 'agent:code-block'; agentId: string; filename: string; content: string; language: string }
  | { type: 'agent:approval'; agentId: string; request: ApprovalRequest }
  | { type: 'agent:approval-resolved'; agentId: string; decision: 'approve' | 'deny' | 'skip' }
  | { type: 'agent:completed'; agentId: string; cost: number }
  | { type: 'agent:failed'; agentId: string; error: string }
  | { type: 'phase:started'; phase: number; total: number; featureIds: string[] }
  | { type: 'phase:completed'; phase: number }
  | { type: 'session:cost-update'; totalCost: number };
```

The existing `realRun.ts` orchestrator will be extended with an `onEvent: (event: OrchestratorEvent) => void` callback parameter. The `useOrchestratorBridge` hook subscribes this callback to zustand mutations.

### Approval Propagation

Agents (Codex CLI, Claude Code) are subprocesses launched via `execa`. Approval detection works by parsing agent stdout for known patterns:
- Claude Code: `--output-format json` emits structured JSON events including tool approval requests
- Codex CLI: stdout patterns for approval prompts are parsed via regex
- Mock adapter: emits synthetic approval events for testing

When an approval is detected, the bridge emits `agent:approval`. The UI switches to APPROVAL mode. User keypress (y/n/a/s) is sent back to the subprocess via stdin write. On resolution, the bridge emits `agent:approval-resolved`.

Note: Approval support is backend-dependent. Initial implementation may only support Claude Code's JSON mode. Codex approval support is stretch goal.

Data flow:
```
xstate orchestrator
  → calls onEvent({ type: 'agent:text', agentId, text })
  → useOrchestratorBridge calls useStore.getState().appendOutput(...)
  → zustand notifies subscribed React components
  → Ink re-renders only changed components
```

### Integration with Existing Code

The `start` command handler in `src/cli/handlers.ts` currently calls `runRealOrchestration()` and outputs via `writeLine`. The new flow:

1. `start` handler detects TTY → launches Ink `render(<App />)` with `alternateScreen: true`
2. `<App>` creates the zustand store and passes it to the orchestrator
3. Orchestrator pushes state updates into the store
4. When orchestrator completes, Ink app exits and restores terminal

For non-TTY (piped output, CI), fall back to the existing `writeLine` text output.

---

## Component Tree

```
<ThemeProvider theme={catppuccinMocha}>
  <App>
    <StatusBar />                    // Segmented chips
    <Box flexDirection="row">
      <Sidebar>                      // Left panel
        <AgentList>
          <AgentRow />               // Compact row per agent (React.memo)
          <AgentExpanded />          // Expanded detail for focused agent
        </AgentList>
        <SidebarFooter />            // Phase + total cost
      </Sidebar>
      <MainPanel>                    // Right panel, keyed by focusedAgentId
        <ScrollableOutput>           // Virtual scroll buffer (offset slicing)
          <OutputLine />             // Individual line (React.memo)
          <TextBlock />              // AI thinking text (via marked-terminal)
          <ToolBlock />              // Tool call inline block
          <CodeBlock />              // Syntax-highlighted code
          <ApprovalPrompt />         // Approval request
        </ScrollableOutput>
      </MainPanel>
      <HelpOverlay />               // Conditional: replaces main panel when ? pressed
    </Box>
    <Footer />                       // Contextual mode bar
  </App>
</ThemeProvider>
```

---

## Keyboard Navigation

| Key | NORMAL mode | APPROVAL mode | INPUT mode |
|-----|-------------|---------------|------------|
| `Tab` | Switch focus: sidebar <-> main | — | — |
| `↑` / `↓` | Navigate agent list (sidebar) or scroll (main) | — | History |
| `Enter` | Focus selected agent in main panel | — | Submit |
| `/` | Enter filter mode (INPUT) | — | — |
| `q` | Quit | — | — |
| `?` | Show help overlay (replaces main panel, Esc to dismiss) | — | — |
| `y` | — | Approve | — |
| `n` | — | Deny | — |
| `a` | — | Always allow | — |
| `s` | — | Skip | — |
| `d` | — | Show diff | — |
| `Esc` | — | Back to NORMAL | Cancel to NORMAL |

---

## New Dependencies

```json
{
  "ink": "^5.1.0",
  "react": "^19.0.0",
  "fullscreen-ink": "^1.0.0",
  "@inkjs/ui": "^2.0.0",
  "zustand": "^5.0.0",
  "marked": "^15.0.0",
  "marked-terminal": "^7.0.0",
  "figures": "^6.0.0",
  "cli-spinners": "^4.0.0",
  "supports-color": "^10.0.0",
  "is-unicode-supported": "^2.0.0"
}
```

Dev dependencies:
```json
{
  "@types/react": "^19.0.0"
}
```

TSConfig change required: add `"jsx": "react-jsx"` to compiler options (React 19 automatic runtime).

Note: `ink@^5.1.0` minimum is required for React 19 compatibility. The `@inkjs/ui` package includes a `<Spinner>` component, so a separate `ink-spinner` is not needed. `chalk` is not needed since Ink's `<Text color="...">` handles coloring, and the `writeLine` fallback path can use `picocolors` (already lighter).

Optional / evaluate later:
- `@shikijs/cli` — VS Code-quality syntax highlighting (heavier, add when needed)
- `ink-gradient` — gradient text for branding
- `@assistant-ui/react-ink-markdown` — pre-built AI chat markdown renderer

---

## New File Structure

```
src/ui/
  theme.ts              // Theme definition, ThemeProvider, useTheme
  store.ts              // Zustand store definition
  App.tsx               // Root component
  StatusBar.tsx         // Segmented chips bar
  Sidebar.tsx           // Agent list panel
  AgentRow.tsx          // Compact agent row
  AgentExpanded.tsx     // Expanded agent detail
  MainPanel.tsx         // Chat transcript panel
  OutputLine.tsx        // Single output line (text/tool/code/approval)
  ToolBlock.tsx         // Inline tool call block
  CodeBlock.tsx         // Syntax-highlighted code block
  ApprovalPrompt.tsx    // Approval request UI
  Footer.tsx            // Contextual mode bar
  StyledCard.tsx        // Bordered card for non-TUI commands
  HelpOverlay.tsx     // Keybinding reference (replaces main panel on ?)
  events.ts           // OrchestratorEvent discriminated union
  hooks/
    useKeyboard.ts      // Keyboard navigation handler
    useTerminalSize.ts  // Terminal dimensions (useStdout + resize listener)
    useOrchestratorBridge.ts  // Connects orchestrator onEvent callback to zustand store
```

---

## Responsive Behavior

Detect terminal size via a custom `useTerminalSize()` hook (Ink's `useStdout()` provides `stdout.columns`/`stdout.rows`, combined with a `process.stdout.on('resize', ...)` listener for reactive updates):

| Width | Behavior |
|-------|----------|
| 120+ cols | Full two-column layout |
| 80-119 cols | Narrower sidebar (15 cols), agent names truncated |
| < 80 cols | Single column — sidebar becomes a collapsible header row |

---

## Graceful Degradation

```typescript
import supportsColor from 'supports-color';
import isUnicodeSupported from 'is-unicode-supported';

const colorLevel = supportsColor.stdout?.level ?? 0;
const unicode = isUnicodeSupported();
const isTTY = process.stdout.isTTY;
```

| Condition | Behavior |
|-----------|----------|
| No TTY (piped) | Skip Ink entirely, use existing `writeLine` text output |
| No color | Strip ANSI codes, output plain text |
| No unicode | Use ASCII fallbacks via `figures` package |
| Small terminal | Responsive layout (see above) |

---

## Anti-Flicker Strategy

1. `incrementalRendering: true` in Ink render options — only redraws changed lines
2. `React.memo` on stable components (StatusBar, completed AgentRows, individual OutputLines)
3. `patchConsole: true` to prevent console.log corruption
4. `fullscreen-ink` for alternate screen buffer — clean canvas
5. Zustand selector subscriptions — components only re-render when their slice changes
6. Virtual scroll buffer with offset slicing — only visible lines are rendered

---

## Integration Points

### `src/cli/handlers.ts` — `start` command

The `start` handler gains a branch: if `process.stdout.isTTY` and not `--bg` and not `--tmux`, launch the Ink TUI. Otherwise, use existing text output.

```typescript
// Pseudocode for the new branch in start handler
if (process.stdout.isTTY && !options.bg && !options.tmux) {
  const { withFullScreen } = await import('fullscreen-ink');
  const { App } = await import('../ui/App.js');
  const app = withFullScreen(<App config={config} />, {
    patchConsole: true,
    incrementalRendering: true,
  });
  await app.start();
  await app.waitUntilExit();
} else {
  // existing writeLine-based flow
}
```

### `src/cli/handlers.ts` — `status`, `init`, `add`, `stop` commands

These commands use the `StyledCard` component to render bordered output. They call Ink's `render()` without `alternateScreen` so output stays in scrollback.

```typescript
const { render } = await import('ink');
const { StatusCard } = await import('../ui/StyledCard.js');
const instance = render(<StatusCard data={statusData} />);
await instance.waitUntilExit();
```

### `src/orchestrator/realRun.ts` — Event bridge

The orchestrator emits events that the UI subscribes to. A bridge function connects xstate actor events to zustand store mutations.

---

## Out of Scope

- Light mode theme (future — context provider supports it, but only Catppuccin Mocha ships initially)
- Inline images / sixel rendering
- Mouse support
- Plugin/extension system for custom panels
- Remote/web-based dashboard
