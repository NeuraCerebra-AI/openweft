# OpenWeft CLI Design Research — Synthesized Findings

> Research conducted March 2026 via 5 parallel Perplexity Reason agents

---

## TL;DR — The Stack

| Layer | Package | Purpose |
|-------|---------|---------|
| **UI Framework** | `ink` 5.x | React-based terminal renderer (flexbox via Yoga) |
| **UI Components** | `@inkjs/ui` | Official ProgressBar, Select, MultiSelect, ConfirmInput, Spinner |
| **CLI Routing** | `commander` (current) or `pastel` (upgrade path) | Arg parsing. Pastel adds Next.js-style file routing + Zod schemas |
| **Markdown** | `marked` + `marked-terminal` | Render AI responses to ANSI |
| **Syntax Highlighting** | `@shikijs/cli` (`codeToANSI`) | VS Code-quality themes, 500+ options |
| **Gradients** | `ink-gradient` | 14 presets + custom color stops |
| **Big Text** | `ink-big-text` | ASCII art headers |
| **Spinners** | `ink-spinner` + `cli-spinners` | 60+ spinner styles |
| **Tables** | `ink-table` or `cli-table3` | cli-table3 comes free with marked-terminal |
| **Links** | `terminal-link` + OSC 8 | Clickable hyperlinks with fallback |
| **Images** | `terminal-image` | Auto-detects Kitty/iTerm2/Sixel/ANSI fallback |
| **Icons** | `figures` + Nerd Fonts (optional) | Cross-platform symbols with Windows fallback |
| **Colors** | `chalk` 5.x or `picocolors` | Picocolors is 2x faster, 6x smaller |
| **Capability Detection** | `supports-color` + `is-unicode-supported` | Graceful degradation |
| **AI Chat UI** | `@assistant-ui/react-ink-markdown` | Pre-built streaming markdown for AI chat (evaluate) |

---

## Ink 5.x Key Features

### Render Options
```typescript
render(<App />, {
  alternateScreen: true,      // Clean canvas, restores on exit
  incrementalRendering: true,  // Only redraws changed lines (anti-flicker!)
  concurrent: true,            // Enables Suspense, useTransition, useDeferredValue
  maxFps: 30,                  // Default frame rate cap
  patchConsole: true,          // Intercepts console.log to prevent corruption
});
```

### Built-in Components
- **`<Box>`** — Flexbox container (every prop you'd expect: padding, margin, gap, flexGrow, position, overflow, borders, backgroundColor, ARIA)
- **`<Text>`** — Text with color, bold, italic, underline, strikethrough, dimColor, inverse, wrap/truncate
- **`<Static>`** — Renders items permanently above dynamic UI. Append-only, never re-renders. Perfect for completed task logs
- **`<Transform>`** — Transforms string output (e.g., add line numbers)
- **`<Spacer>`** — Flexible space (equivalent to `flexGrow: 1`)
- **`<Newline>`** — Insert newlines within Text

### Built-in Hooks
- **`useInput(handler, { isActive })`** — Keyboard input (arrow keys, return, escape, ctrl, tab, etc.)
- **`useFocus({ autoFocus, id })`** — Make component focusable, Tab/Shift+Tab cycling
- **`useFocusManager()`** — Programmatic focus: `focusNext()`, `focusPrevious()`, `focus(id)`
- **`useApp()`** — `exit()`, `waitUntilRenderFlush()`
- **`useStdout()` / `useStderr()`** — Direct write access
- **`useWindowSize()`** — Terminal dimensions, auto re-renders on resize
- **`useBoxMetrics(ref)`** — Layout measurements for a Box element
- **`usePaste(handler)`** — Bracketed paste mode

### Border Styles
| Style | Look | Best For |
|-------|------|----------|
| `round` | `╭─╮╰─╯` | Prompts, overlays, friendly feel |
| `single` | `┌─┐└─┘` | Persistent panels, clean layout |
| `bold` | `┏━┓┗━┛` | Focused/active panel |
| `double` | `╔═╗╚═╝` | Important sections |
| `classic` | `+-+\|` | ASCII fallback |

### Gotchas
- **ESM-only** — Need `"type": "module"` in package.json (you already have this)
- **No overlays/z-index** — Modals via conditional rendering, not layering
- **All text must be in `<Text>`** — Bare strings in `<Box>` will error
- **`<Static>` is append-only** — Can't update/remove already-rendered items
- **Memory**: ~50MB dev, ~32MB bundled (vs <4MB for Go/Bubbletea)
- **No built-in scroll container** — Implement via offset slicing + `useInput` arrow keys

---

## Design System

### Color Palette (Catppuccin Mocha — Most Popular 2025-2026)

```typescript
const theme = {
  // Backgrounds
  bg:       '#1e1e2e', // Base
  bgDeep:   '#11111b', // Crust
  bgMid:    '#181825', // Mantle
  surface0: '#313244',
  surface1: '#45475a',
  surface2: '#585b70',

  // Foreground
  text:     '#cdd6f4',
  subtext:  '#a6adc8',

  // Accents
  blue:     '#89b4fa',
  mauve:    '#cba6f7',
  pink:     '#f5c2e7',
  peach:    '#fab387',
  sky:      '#89dceb',
  teal:     '#94e2d5',
  lavender: '#b4befe',

  // Semantic
  success:  '#a6e3a1', // Green
  error:    '#f38ba8', // Red
  warning:  '#f9e2af', // Yellow
  info:     '#89dceb', // Sky
  muted:    '#585b70', // Surface2
};
```

### Typography Hierarchy
```
Level 1: <Text bold color={theme.blue}>Agent Name</Text>          — Bold + Color
Level 2: <Text bold>Section Header</Text>                         — Bold
Level 3: <Text>Primary content</Text>                             — Normal
Level 4: <Text dimColor>Timestamps, metadata</Text>               — Dim
Semantic: <Text color={theme.success}>✓ Success</Text>            — Color-coded
Semantic: <Text color={theme.error}>✗ Error</Text>                — Color-coded
```

### Border Strategy
- `round` borders for prompts and overlays (friendly, attention-grabbing)
- `single` borders for persistent panels (clean, minimal)
- `bold` borders for focused/active panel
- Color active panel border with accent; inactive panels get dim borders

### Spacing Rules
- Use consistent padding units (1 = 1 terminal cell)
- `paddingX={1}` for inline elements
- `padding={1}` for panels
- `gap={1}` between stacked items
- `marginBottom={1}` between sections

---

## Inspiration Patterns to Implement

### 1. Command Blocks (from Warp)
Group agent actions into discrete visual blocks with clear boundaries:
```
┌──────────────────────────────┐
│ Tool: read_file              │
│ src/index.ts                 │
│ ✓ 245 lines read             │
└──────────────────────────────┘
```

### 2. Contextual Status Bar (from Zellij)
Bottom bar shows available keybindings based on current state:
```
[Normal] Tab:switch  Enter:approve  q:quit  ?:help
```

### 3. Multi-Panel with Focus (from lazygit)
```
┌─ Agents ──────┬─ Output ────────────────────┐
│ > Alpha ◉     │ [Streaming AI response...]   │
│   Beta  ○     │                              │
│   Gamma ✓     │                              │
└───────────────┴──────────────────────────────┘
```

### 4. Conditional Status Segments (from Starship)
Only show what's relevant — cost only when tokens consumed, git info only when files modified.

### 5. Beautiful Approval Prompts (from Charm/Gum)
```
╭──────────────────────────────────────╮
│ Allow write to src/index.ts?         │
│ [Y]es  [N]o  [A]lways  [S]kip       │
╰──────────────────────────────────────╯
```

### 6. Region Toggling (from btop)
Let users hide/show panels with keyboard shortcuts to handle any terminal size.

### 7. Streaming Text (from Claude Code)
```typescript
// Pattern both Claude Code and Codex CLI use:
for await (const chunk of response) {
  if (chunk.type === "content_block_delta") {
    currentConvo = handleDelta(chunk, currentConvo);
    setMessages([...currentConvo]); // Triggers Ink re-render
  }
}
```

---

## Agent State Visualization

| State | Visual |
|-------|--------|
| **Thinking** | `<Spinner type="dots" />` + dim "thinking..." |
| **Executing tool** | Bold tool name + streaming output in command block |
| **Waiting for approval** | Round-bordered prompt with `[Y]es [N]o` |
| **Completed** | Green `✓` + summary line |
| **Error** | Red-bordered box + error details |
| **Idle/queued** | Dim text with queue position |

---

## Responsive Strategy

| Terminal Width | Layout |
|---------------|--------|
| **120+ cols** | Three columns: agents \| main \| details |
| **80-119 cols** | Two columns: agents \| main, details as overlay |
| **<80 cols** | Single column, agents as collapsible header |

Detect via `useWindowSize()` hook — auto re-renders on resize.

---

## Markdown & Code Rendering

### Recommended Pipeline
```
AI Stream → Buffer chunks → marked.parse() with markedTerminal
  → Code blocks: Shiki codeToANSI() (VS Code themes)
  → Tables: cli-table3 (comes with marked-terminal)
  → Links: OSC 8 escape sequences
  → Images: terminal-image (if terminal supports)
→ Ink <Text> component for display
```

### Key Libraries
- **`marked` + `marked-terminal`** — Single best starting point, bundles cli-highlight + cli-table3 + chalk
- **`@shikijs/cli`** (`codeToANSI`) — Upgrade from cli-highlight for VS Code-quality syntax highlighting
- **`@assistant-ui/react-ink-markdown`** — Pre-built for AI chat UIs in Ink (worth evaluating)
- **`terminal-link`** — OSC 8 hyperlinks with automatic text-only fallback

### Graceful Degradation
```typescript
import supportsColor from 'supports-color';
import isUnicodeSupported from 'is-unicode-supported';

// Color levels: 0=none, 1=basic 16, 2=256, 3=truecolor
const colorLevel = supportsColor.stdout?.level ?? 0;
const unicode = isUnicodeSupported();
const isTTY = process.stdout.isTTY;

// Degrade: no color → strip ANSI, no unicode → ASCII borders, pipe → plain text
```

---

## Anti-Flicker Techniques

1. **`incrementalRendering: true`** — Only redraws changed lines (Ink 5.x)
2. **`React.memo`** — Wrap stable components
3. **Batch state updates** — React auto-batches within same event loop tick
4. **Stable layout dimensions** — Keep root `<Box>` dimensions fixed
5. **`<Static>`** — Completed items never re-render
6. **`patchConsole: true`** — Prevent console.log from corrupting output
7. **`alternateScreen: true`** — Clean canvas for full-screen apps

---

## Community Component Ecosystem

### Must-Have
- `ink-spinner` — Animated spinners (60+ styles)
- `ink-text-input` — Text input with cursor
- `ink-select-input` — Selection menu
- `ink-gradient` — Gradient text
- `ink-big-text` — ASCII art headers
- `ink-table` — Data tables
- `ink-link` — Clickable hyperlinks

### Worth Evaluating
- `ink-task-list` — Task status display (pending/running/success/failure)
- `ink-tab` — Tabbed interface
- `ink-divider` — Horizontal separator
- `ink-titled-box` — Box with title in border
- `ink-chart` — Sparklines and bar charts
- `@assistant-ui/react-ink` — AI chat UI components

### Build Custom
- Scrollable viewport (offset slicing + arrow keys)
- Toast notifications (auto-dismiss with setTimeout)
- Modal/overlay (conditional rendering)
- Skeleton loading (pulsing dim text)
- Shadow effects (half-block chars in dimmed colors)

---

## Notable Production Users of Ink

Claude Code (Anthropic), Gemini CLI (Google), Qwen Code (Alibaba), Codex CLI (OpenAI), Shopify CLI, Gatsby CLI, Prisma CLI

---

## Sources

### Frameworks & Libraries
- Ink GitHub: github.com/vadimdemedes/ink
- Pastel: github.com/vadimdemedes/pastel
- @inkjs/ui: github.com/vadimdemedes/ink-ui
- Codex CLI (open source): github.com/openai/codex

### Design Inspiration
- Charm tools: charm.sh (Bubbletea, Lipgloss, Gum, Glow)
- Catppuccin palette: github.com/catppuccin/catppuccin
- Nerd Fonts: nerdfonts.com

### Key NPM Packages
- marked-terminal, @shikijs/cli, ink-gradient, ink-big-text, ink-spinner
- cli-spinners, figures, log-symbols, supports-color, is-unicode-supported
- terminal-link, terminal-image, gradient-string
- @assistant-ui/react-ink-markdown
