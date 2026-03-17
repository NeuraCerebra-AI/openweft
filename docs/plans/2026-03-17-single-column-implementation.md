# Single-Column Card Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the two-column sidebar+output layout with a single-column card-based UI, htop-style meter bars, and a redesigned contextual footer.

**Architecture:** Delete Sidebar, MainPanel, AgentRow, AgentExpanded, OutputLine. Create AgentCard and MeterBar. Modify store to track tokens and files per agent. Rewire App.tsx to render meters + card list. Rewire keyboard handler to remove panel toggling and enable `d` during execution.

**Tech Stack:** React/Ink 5.x, Zustand, Catppuccin Mocha theme, Vitest

---

### Task 1: Add `files` and `tokens` to AgentState + UIStore

**Files:**
- Modify: `src/ui/store.ts`
- Modify: `src/ui/events.ts`
- Test: `tests/ui/store.test.ts`

**Step 1: Write failing tests for new store fields**

Add to `tests/ui/store.test.ts`:

```typescript
it('addAgent initializes files and tokens to defaults', () => {
  const store = createUIStore();
  store.getState().addAgent({ id: 'a1', name: 'test', feature: 'feat' });
  const agent = store.getState().agents[0]!;
  expect(agent.files).toEqual([]);
  expect(agent.tokens).toBe(0);
});

it('addAgent accepts files in init', () => {
  const store = createUIStore();
  store.getState().addAgent({ id: 'a1', name: 'test', feature: 'feat', files: ['a.ts', 'b.ts'] });
  expect(store.getState().agents[0]!.files).toEqual(['a.ts', 'b.ts']);
});

it('updateAgent patches tokens', () => {
  const store = createUIStore();
  store.getState().addAgent({ id: 'a1', name: 'test', feature: 'feat' });
  store.getState().updateAgent('a1', { tokens: 5000 });
  expect(store.getState().agents[0]!.tokens).toBe(5000);
});

it('tracks totalTokens', () => {
  const store = createUIStore();
  store.getState().addAgent({ id: 'a1', name: 'test', feature: 'feat' });
  store.getState().setTotalTokens(14200);
  expect(store.getState().totalTokens).toBe(14200);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/store.test.ts -t "addAgent initializes files"`
Expected: FAIL — `files` does not exist on AgentState

**Step 3: Implement store changes**

In `src/ui/store.ts`:

1. Add to `AgentState` interface (after line 25 `readonly outputLines: OutputLine[];`):
```typescript
readonly files: readonly string[];
readonly tokens: number;
```

2. Add to `UIStore` interface (after line 31 `totalCost: number;`):
```typescript
totalTokens: number;
```

3. Add to `UIStore` interface (in the `addAgent` init parameter, after `removable`):
```typescript
files?: readonly string[];
```

4. Add to `UIStore` interface methods (after `setTotalCost`):
```typescript
setTotalTokens: (tokens: number) => void;
```

5. Add to `updateAgent` Partial Pick (add `'tokens'` to the Pick union):
```typescript
updateAgent: (id: string, patch: Partial<Pick<AgentState, 'status' | 'cost' | 'elapsed' | 'currentTool' | 'approvalRequest' | 'tokens'>>) => void;
```

6. In `createUIStore`, add initial state (after `totalCost: 0`):
```typescript
totalTokens: 0,
```

7. In `addAgent` implementation, add to the spread (after `removable`):
```typescript
files: init.files ?? [],
tokens: 0,
```

8. Add `setTotalTokens` implementation (after `setTotalCost`):
```typescript
setTotalTokens: (tokens) => set({ totalTokens: tokens }),
```

9. Remove `sidebarFocused` from initial state and `UIStore` interface. Remove `togglePanel` method and its implementation. (These will be addressed in Task 5 when we rewire keyboard.)

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ui/store.test.ts`
Expected: PASS (new tests + existing tests)

**Step 5: Commit**

```bash
git add src/ui/store.ts tests/ui/store.test.ts
git commit -m "feat(store): add files, tokens to AgentState and totalTokens to UIStore"
```

---

### Task 2: Add token event to events.ts and wire in orchestrator bridge

**Files:**
- Modify: `src/ui/events.ts`
- Modify: `src/ui/hooks/useOrchestratorBridge.ts`
- Test: `tests/ui/hooks/useOrchestratorBridge.test.ts`

**Step 1: Write failing test for token event handling**

Add to `tests/ui/hooks/useOrchestratorBridge.test.ts`:

```typescript
it('session:token-update sets agent tokens and totalTokens', () => {
  handler({
    type: 'agent:started',
    agentId: 'a1',
    name: 'test',
    feature: 'feat',
    stage: 'execution',
  });
  handler({
    type: 'session:token-update',
    agentId: 'a1',
    tokens: 8400,
    totalTokens: 14200,
  });
  expect(store.getState().agents[0]!.tokens).toBe(8400);
  expect(store.getState().totalTokens).toBe(14200);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/hooks/useOrchestratorBridge.test.ts -t "session:token-update"`
Expected: FAIL — type 'session:token-update' does not exist

**Step 3: Add event type**

In `src/ui/events.ts`, add to the `OrchestratorEvent` union (before the closing semicolon on line 28):

```typescript
| { readonly type: 'session:token-update'; readonly agentId: string; readonly tokens: number; readonly totalTokens: number }
```

**Step 4: Handle event in bridge**

In `src/ui/hooks/useOrchestratorBridge.ts`, add a case before the `default` (before line 145):

```typescript
case 'session:token-update':
  getState().updateAgent(event.agentId, { tokens: event.tokens });
  getState().setTotalTokens(event.totalTokens);
  break;
```

**Step 5: Also handle agent:started with files**

Update the `agent:started` event type in `src/ui/events.ts` to include optional `files`:

```typescript
| {
    readonly type: 'agent:started';
    readonly agentId: string;
    readonly name: string;
    readonly feature: string;
    readonly stage: AgentStage;
    readonly files?: readonly string[];
  }
```

In `src/ui/hooks/useOrchestratorBridge.ts`, update both the `adoptQueuedPlaceholder` path and the `addAgent` path in the `agent:started` case to pass `files`:

```typescript
case 'agent:started': {
  const alreadyExists = getState().agents.some((agent) => agent.id === event.agentId);
  if (alreadyExists) {
    getState().updateAgent(event.agentId, {
      status: 'running',
      currentTool: null,
      approvalRequest: null
    });
  } else {
    const adoptedPlaceholder = event.stage === 'planning-s1'
      ? getState().adoptQueuedPlaceholder({
          id: event.agentId,
          name: event.name,
          feature: event.feature
        })
      : false;

    if (!adoptedPlaceholder) {
      getState().addAgent({
        id: event.agentId,
        name: event.name,
        feature: event.feature,
        files: event.files ? [...event.files] : undefined,
      });
    }
  }
  if (getState().focusedAgentId === null) {
    getState().setFocusedAgent(event.agentId);
  }
  break;
}
```

**Step 6: Run all bridge tests**

Run: `npx vitest run tests/ui/hooks/useOrchestratorBridge.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/ui/events.ts src/ui/hooks/useOrchestratorBridge.ts tests/ui/hooks/useOrchestratorBridge.test.ts
git commit -m "feat(events): add session:token-update event and files on agent:started"
```

---

### Task 3: Create MeterBar component

**Files:**
- Create: `src/ui/MeterBar.tsx`
- Create: `tests/ui/MeterBar.test.tsx`

**Step 1: Write failing tests**

Create `tests/ui/MeterBar.test.tsx`:

```typescript
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { MeterBar } from '../src/ui/MeterBar.js';
import { ThemeContext, catppuccinMocha } from '../src/ui/theme.js';

const wrap = (el: React.ReactElement) => (
  <ThemeContext.Provider value={catppuccinMocha}>{el}</ThemeContext.Provider>
);

describe('MeterBar', () => {
  it('renders three meters with labels and values', () => {
    const { lastFrame } = render(wrap(
      <MeterBar
        phase={{ current: 1, total: 3 }}
        completedCount={1}
        totalAgentCount={5}
        totalTokens={14200}
        elapsed={47}
      />
    ));
    const output = lastFrame()!;
    expect(output).toContain('Phase 1/3');
    expect(output).toContain('1/5');
    expect(output).toContain('Tokens');
    expect(output).toContain('14.2k');
    expect(output).toContain('Time');
    expect(output).toContain('0:47');
  });

  it('is not rendered when phase is null', () => {
    const { lastFrame } = render(wrap(
      <MeterBar
        phase={null}
        completedCount={0}
        totalAgentCount={0}
        totalTokens={0}
        elapsed={0}
      />
    ));
    expect(lastFrame()).toBe('');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/MeterBar.test.tsx`
Expected: FAIL — module not found

**Step 3: Implement MeterBar**

Create `src/ui/MeterBar.tsx`:

```typescript
import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import { formatTime } from './utils.js';

interface MeterBarProps {
  readonly phase: { current: number; total: number } | null;
  readonly completedCount: number;
  readonly totalAgentCount: number;
  readonly totalTokens: number;
  readonly elapsed: number;
}

const formatTokens = (t: number): string =>
  t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t);

const METER_WIDTH = 20;
const MAX_TIME_SECONDS = 600;
const MAX_TOKENS = 200_000;

const Meter: React.FC<{
  readonly label: string;
  readonly value: string;
  readonly percent: number;
  readonly color: string;
  readonly width: number;
}> = ({ label, value, percent, color, width }) => {
  const { colors } = useTheme();
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box justifyContent="space-between">
        <Text color={colors.muted}>{label}</Text>
        <Text color={colors.subtext}>{value}</Text>
      </Box>
      <Text>
        <Text color={color}>{'━'.repeat(filled)}</Text>
        <Text color={colors.surface0}>{'━'.repeat(empty)}</Text>
      </Text>
    </Box>
  );
};

export const MeterBar: React.FC<MeterBarProps> = React.memo(
  ({ phase, completedCount, totalAgentCount, totalTokens, elapsed }) => {
    const { colors } = useTheme();

    if (phase === null) return null;

    const phasePct = totalAgentCount > 0
      ? Math.round((completedCount / totalAgentCount) * 100)
      : 0;
    const tokenPct = Math.min(100, Math.round((totalTokens / MAX_TOKENS) * 100));
    const timePct = Math.min(100, Math.round((elapsed / MAX_TIME_SECONDS) * 100));

    return (
      <Box flexDirection="row" gap={2} paddingX={1}>
        <Meter
          label={`Phase ${phase.current}/${phase.total}`}
          value={`${completedCount}/${totalAgentCount}`}
          percent={phasePct}
          color={colors.blue}
          width={METER_WIDTH}
        />
        <Meter
          label="Tokens"
          value={formatTokens(totalTokens)}
          percent={tokenPct}
          color={colors.peach}
          width={METER_WIDTH}
        />
        <Meter
          label="Time"
          value={formatTime(elapsed)}
          percent={timePct}
          color={colors.green}
          width={METER_WIDTH}
        />
      </Box>
    );
  }
);

MeterBar.displayName = 'MeterBar';
```

**Step 4: Run tests**

Run: `npx vitest run tests/ui/MeterBar.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/MeterBar.tsx tests/ui/MeterBar.test.tsx
git commit -m "feat(ui): add MeterBar component with phase/tokens/time meters"
```

---

### Task 4: Create AgentCard component

**Files:**
- Create: `src/ui/AgentCard.tsx`
- Create: `tests/ui/AgentCard.test.tsx`

**Step 1: Write failing tests**

Create `tests/ui/AgentCard.test.tsx`:

```typescript
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import { AgentCard } from '../src/ui/AgentCard.js';
import { ThemeContext, catppuccinMocha } from '../src/ui/theme.js';

const wrap = (el: React.ReactElement) => (
  <ThemeContext.Provider value={catppuccinMocha}>{el}</ThemeContext.Provider>
);

describe('AgentCard', () => {
  it('renders agent name and feature', () => {
    const { lastFrame } = render(wrap(
      <AgentCard
        name="auth-middleware"
        feature="Add JWT refresh token rotation"
        status="queued"
        focused={false}
        files={['src/auth/refresh.ts']}
        tokens={0}
        cost={0}
        elapsed={0}
        currentTool={null}
        approvalRequest={null}
        spinnerFrame={0}
        readyStateDetail={null}
      />
    ));
    const output = lastFrame()!;
    expect(output).toContain('auth-middleware');
    expect(output).toContain('Add JWT refresh token rotation');
  });

  it('shows file count badge', () => {
    const { lastFrame } = render(wrap(
      <AgentCard
        name="test"
        feature="feat"
        status="running"
        focused={false}
        files={['a.ts', 'b.ts', 'c.ts']}
        tokens={8400}
        cost={0.12}
        elapsed={47}
        currentTool="Edit a.ts"
        approvalRequest={null}
        spinnerFrame={0}
        readyStateDetail={null}
      />
    ));
    const output = lastFrame()!;
    expect(output).toContain('3 files');
  });

  it('shows token badge when tokens > 0', () => {
    const { lastFrame } = render(wrap(
      <AgentCard
        name="test"
        feature="feat"
        status="running"
        focused={true}
        files={[]}
        tokens={8400}
        cost={0.12}
        elapsed={47}
        currentTool={null}
        approvalRequest={null}
        spinnerFrame={0}
        readyStateDetail={null}
      />
    ));
    expect(lastFrame()!).toContain('8.4k');
  });

  it('shows file list when focused', () => {
    const { lastFrame } = render(wrap(
      <AgentCard
        name="test"
        feature="feat"
        status="running"
        focused={true}
        files={['src/a.ts', 'src/b.ts']}
        tokens={0}
        cost={0}
        elapsed={0}
        currentTool={null}
        approvalRequest={null}
        spinnerFrame={0}
        readyStateDetail={null}
      />
    ));
    const output = lastFrame()!;
    expect(output).toContain('src/a.ts');
    expect(output).toContain('src/b.ts');
  });

  it('shows current tool for unfocused running agent', () => {
    const { lastFrame } = render(wrap(
      <AgentCard
        name="test"
        feature="feat"
        status="running"
        focused={false}
        files={[]}
        tokens={0}
        cost={0}
        elapsed={0}
        currentTool="Read src/index.ts"
        approvalRequest={null}
        spinnerFrame={0}
        readyStateDetail={null}
      />
    ));
    expect(lastFrame()!).toContain('Read src/index.ts');
  });

  it('shows approval box when focused with approval request', () => {
    const { lastFrame } = render(wrap(
      <AgentCard
        name="test"
        feature="feat"
        status="approval"
        focused={true}
        files={[]}
        tokens={0}
        cost={0}
        elapsed={0}
        currentTool={null}
        approvalRequest={{ file: 'pkg.json', action: 'Bash', detail: 'npm install foo' }}
        spinnerFrame={0}
        readyStateDetail={null}
      />
    ));
    const output = lastFrame()!;
    expect(output).toContain('APPROVAL');
    expect(output).toContain('Bash');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/AgentCard.test.tsx`
Expected: FAIL — module not found

**Step 3: Implement AgentCard**

Create `src/ui/AgentCard.tsx`:

```typescript
import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import { formatTime, getStatusIcon } from './utils.js';
import type { AgentStatus } from './store.js';
import type { ApprovalRequest } from './events.js';

interface AgentCardProps {
  readonly name: string;
  readonly feature: string;
  readonly status: AgentStatus;
  readonly focused: boolean;
  readonly files: readonly string[];
  readonly tokens: number;
  readonly cost: number;
  readonly elapsed: number;
  readonly currentTool: string | null;
  readonly approvalRequest: ApprovalRequest | null;
  readonly spinnerFrame: number;
  readonly readyStateDetail: string | null;
}

const formatTokens = (t: number): string =>
  t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t);

const STATUS_BORDER_COLORS: Record<AgentStatus, string> = {
  running: 'green',
  completed: 'green',
  failed: 'red',
  queued: 'surface2',
  approval: 'yellow',
};

export const AgentCard: React.FC<AgentCardProps> = React.memo(
  ({ name, feature, status, focused, files, tokens, cost: _cost, elapsed, currentTool, approvalRequest, spinnerFrame, readyStateDetail }) => {
    const { colors, borders } = useTheme();
    const { icon, colorKey } = getStatusIcon(status, spinnerFrame);
    const borderColorKey = STATUS_BORDER_COLORS[status];
    const borderColor = focused ? colors.blue : (colors as Record<string, string>)[borderColorKey] ?? colors.surface1;
    const dimmed = status === 'completed' && !focused;

    return (
      <Box
        flexDirection="column"
        borderStyle={focused ? borders.panelActive : borders.panel}
        borderColor={borderColor}
        paddingX={1}
        dimColor={dimmed}
      >
        {/* Top row: icon, name, badges, time */}
        <Box>
          <Text color={colors[colorKey]}>{icon} </Text>
          <Text bold={focused}>{name}</Text>
          <Box flexGrow={1} />
          {files.length > 0 && (
            <Text color={colors.green}>{` ${files.length} files `}</Text>
          )}
          {tokens > 0 && (
            <Text color={colors.peach}>{` ${formatTokens(tokens)} tok `}</Text>
          )}
          <Text color={colors.muted}>{` ${formatTime(elapsed)}`}</Text>
        </Box>

        {/* Feature description (always shown) */}
        <Box paddingLeft={2}>
          <Text color={colors.subtext}>{feature}</Text>
        </Box>

        {/* Focused-only detail */}
        {focused && files.length > 0 && (
          <Box paddingLeft={2}>
            <Text color={colors.green}>{'files: '}</Text>
            <Text color={colors.muted}>{files.join(', ')}</Text>
          </Box>
        )}

        {focused && currentTool !== null && (
          <Box paddingLeft={2}>
            <Text color={colors.mauve}>{`▸ ${currentTool}`}</Text>
          </Box>
        )}

        {!focused && currentTool !== null && (
          <Box paddingLeft={2}>
            <Text color={colors.mauve}>{`▸ ${currentTool}`}</Text>
          </Box>
        )}

        {focused && readyStateDetail !== null && (
          <Box paddingLeft={2}>
            <Text color={colors.teal}>{readyStateDetail}</Text>
          </Box>
        )}

        {focused && approvalRequest !== null && (
          <Box
            flexDirection="column"
            marginLeft={2}
            marginTop={0}
            borderStyle={borders.prompt}
            borderColor={colors.yellow}
            paddingX={1}
          >
            <Text bold color={colors.yellow}>{'APPROVAL NEEDED'}</Text>
            <Text>{`${approvalRequest.action}: ${approvalRequest.file}`}</Text>
            {approvalRequest.detail ? <Text color={colors.subtext}>{approvalRequest.detail}</Text> : null}
          </Box>
        )}
      </Box>
    );
  }
);

AgentCard.displayName = 'AgentCard';
```

**Step 4: Run tests**

Run: `npx vitest run tests/ui/AgentCard.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/AgentCard.tsx tests/ui/AgentCard.test.tsx
git commit -m "feat(ui): add AgentCard component with badges, file list, approval box"
```

---

### Task 5: Rewire keyboard — remove panel toggle, enable `d` during execution

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `tests/ui/hooks/useKeyboard.test.ts`

**Step 1: Write failing test for `d` during execution**

Add to `tests/ui/hooks/useKeyboard.test.ts`:

```typescript
it('d removes focused queued agent during execution', () => {
  const store = createUIStore();
  store.getState().addAgent({ id: 'a1', name: 'running', feature: 'f', status: 'running' });
  store.getState().addAgent({ id: 'a2', name: 'queued', feature: 'f', status: 'queued', removable: true });
  store.getState().setFocusedAgent('a2');
  store.getState().requestExecution();
  const onRemoveAgent = vi.fn();
  const result = handleKeypress(store, 'd', { onRemoveAgent });
  expect(result).toBe('handled');
  expect(onRemoveAgent).toHaveBeenCalledWith('a2');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/hooks/useKeyboard.test.ts -t "d removes focused queued agent during execution"`
Expected: FAIL — `d` is gated by `!state.executionRequested`

**Step 3: Modify keyboard handler**

In `src/ui/hooks/useKeyboard.ts`:

1. **Remove `tab` case** (line 84): Delete `case 'tab': state.togglePanel(); return 'handled';`

2. **Change `d` gate** (line 103): Remove the `!state.executionRequested &&` check. The `d` key should work whenever there's a focused removable agent:

```typescript
case 'd':
  if (state.focusedAgentId && handlers.onRemoveAgent) {
    const focused = visibleAgents.find((a) => a.id === state.focusedAgentId);
    if (focused?.removable) {
      handlers.onRemoveAgent(state.focusedAgentId);
      return 'handled';
    }
  }
  return 'unhandled';
```

3. **Remove sidebar-dependent navigation** (lines 115-145): The `k`/`up` and `j`/`down` handlers currently branch on `state.sidebarFocused`. Remove the branch — always navigate agents (no scroll offset logic):

```typescript
case 'k':
case 'up': {
  if (visibleAgents.length === 0) return 'handled';
  const idx = visibleAgents.findIndex((a) => a.id === state.focusedAgentId);
  if (idx === -1) {
    const first = visibleAgents[0];
    if (first !== undefined) state.setFocusedAgent(first.id);
    return 'handled';
  }
  if (idx > 0) {
    const prev = visibleAgents[idx - 1];
    if (prev !== undefined) state.setFocusedAgent(prev.id);
  }
  return 'handled';
}
case 'j':
case 'down': {
  if (visibleAgents.length === 0) return 'handled';
  const idx = visibleAgents.findIndex((a) => a.id === state.focusedAgentId);
  if (idx === -1) {
    const first = visibleAgents[0];
    if (first !== undefined) state.setFocusedAgent(first.id);
    return 'handled';
  }
  if (idx < visibleAgents.length - 1) {
    const next = visibleAgents[idx + 1];
    if (next !== undefined) state.setFocusedAgent(next.id);
  }
  return 'handled';
}
```

4. **Remove `Enter` toggling panel** — `Enter` on a card does nothing special now (or could expand, but not needed since focused card auto-expands).

**Step 4: Run all keyboard tests**

Run: `npx vitest run tests/ui/hooks/useKeyboard.test.ts`
Expected: Some existing tests may fail (e.g., tests for Tab, sidebar-focused navigation). Fix those tests to match new behavior.

**Step 5: Update failing tests**

Remove or update tests that:
- Test `Tab` toggling panel focus
- Test sidebar-focused vs main-panel-focused navigation branching
- Reference `sidebarFocused` state

**Step 6: Run all keyboard tests again**

Run: `npx vitest run tests/ui/hooks/useKeyboard.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/ui/hooks/useKeyboard.ts tests/ui/hooks/useKeyboard.test.ts
git commit -m "feat(keyboard): remove panel toggle, enable d during execution, simplify navigation"
```

---

### Task 6: Redesign Footer component

**Files:**
- Modify: `src/ui/Footer.tsx`
- Test: `tests/ui/Footer.test.tsx`

**Step 1: Write failing tests for new footer design**

Replace mode config tests in `tests/ui/Footer.test.tsx` with:

```typescript
it('shows mode badge and contextual hints in idle', () => {
  const { lastFrame } = render(wrap(
    <Footer mode="normal" executionStarted={false} composing={false} />
  ));
  const output = lastFrame()!;
  expect(output).toContain('NORMAL');
  expect(output).toContain('s');
  expect(output).toContain('start');
  expect(output).toContain('d');
  expect(output).toContain('remove');
});

it('shows d remove during execution', () => {
  const { lastFrame } = render(wrap(
    <Footer mode="normal" executionStarted={true} composing={false} />
  ));
  const output = lastFrame()!;
  expect(output).toContain('d');
  expect(output).toContain('remove');
  expect(output).toContain('q');
  expect(output).toContain('stop');
});

it('shows approval hints', () => {
  const { lastFrame } = render(wrap(
    <Footer mode="approval" executionStarted={true} composing={false} />
  ));
  const output = lastFrame()!;
  expect(output).toContain('APPROVAL');
  expect(output).toContain('y');
  expect(output).toContain('approve');
});
```

**Step 2: Run test to verify failures**

Run: `npx vitest run tests/ui/Footer.test.tsx`

**Step 3: Rewrite Footer**

Replace `src/ui/Footer.tsx` content:

```typescript
import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';

interface FooterProps {
  readonly mode: 'normal' | 'approval' | 'input';
  readonly executionStarted: boolean;
  readonly composing: boolean;
}

type Hint = readonly [key: string, label: string];

const getHints = (mode: FooterProps['mode'], executionStarted: boolean, composing: boolean): readonly Hint[] => {
  if (composing) return [['Enter', 'submit'], ['Esc', 'cancel']];

  if (mode === 'approval') return [['y', 'approve'], ['n', 'deny'], ['a', 'always'], ['s', 'skip']];

  if (mode === 'input') return [['Enter', 'submit'], ['Esc', 'cancel']];

  // normal
  if (!executionStarted) return [['s', 'start'], ['a', 'add'], ['d', 'remove'], ['?', 'help']];
  return [['a', 'add'], ['d', 'remove'], ['q', 'stop run'], ['?', 'help']];
};

const getModeInfo = (mode: FooterProps['mode'], composing: boolean): { label: string; colorKey: 'blue' | 'yellow' | 'green' } => {
  if (composing) return { label: 'INPUT', colorKey: 'green' };
  if (mode === 'approval') return { label: 'APPROVAL', colorKey: 'yellow' };
  return { label: 'NORMAL', colorKey: 'blue' };
};

export const Footer: React.FC<FooterProps> = React.memo(({ mode, executionStarted, composing }) => {
  const { colors } = useTheme();
  const { label, colorKey } = getModeInfo(mode, composing);
  const hints = getHints(mode, executionStarted, composing);

  return (
    <Box flexDirection="row" gap={1} alignItems="center">
      <Text bold color={colors.crust ?? colors.bg} backgroundColor={colors[colorKey]}>{` ${label} `}</Text>
      {hints.map(([key, desc]) => (
        <Text key={key}>
          <Text bold>{key}</Text>
          <Text color={colors.subtext}>{` ${desc}`}</Text>
        </Text>
      ))}
    </Box>
  );
});

Footer.displayName = 'Footer';
```

Note: Ink may not support `backgroundColor`. If not, fall back to the current bold-text approach. Check `ink` docs. The key change is the content, not the styling.

**Step 4: Run tests**

Run: `npx vitest run tests/ui/Footer.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/Footer.tsx tests/ui/Footer.test.tsx
git commit -m "feat(ui): redesign Footer as contextual mode badge + hints"
```

---

### Task 7: Update StatusBar to show tokens

**Files:**
- Modify: `src/ui/StatusBar.tsx`
- Test: `tests/ui/StatusBar.test.tsx`

**Step 1: Write test for tokens display**

Add to `tests/ui/StatusBar.test.tsx`:

```typescript
it('shows token count instead of cost', () => {
  const { lastFrame } = render(wrap(
    <StatusBar
      phase={{ current: 1, total: 3 }}
      activeCount={2}
      pendingCount={3}
      totalCount={5}
      totalTokens={14200}
      elapsed={47}
    />
  ));
  const output = lastFrame()!;
  expect(output).toContain('14.2k');
  expect(output).toContain('tokens');
  expect(output).not.toContain('$');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/StatusBar.test.tsx -t "shows token count"`
Expected: FAIL — `totalTokens` prop does not exist

**Step 3: Update StatusBar**

In `src/ui/StatusBar.tsx`:

1. Replace `cost: number` prop with `totalTokens: number` in `StatusBarProps`
2. Replace the cost display block with:

```typescript
{totalTokens > 0 && (
  <Text>
    <Text color={colors.muted}>{'│ '}</Text>
    <Text color={colors.peach}>{`${totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : String(totalTokens)} tokens`}</Text>
  </Text>
)}
```

**Step 4: Update existing tests that pass `cost` prop**

Change all `cost={...}` to `totalTokens={...}` in `tests/ui/StatusBar.test.tsx`.

**Step 5: Run tests**

Run: `npx vitest run tests/ui/StatusBar.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add src/ui/StatusBar.tsx tests/ui/StatusBar.test.tsx
git commit -m "feat(ui): StatusBar shows tokens instead of cost"
```

---

### Task 8: Rewire App.tsx — single-column layout

**Files:**
- Modify: `src/ui/App.tsx`
- Test: `tests/ui/App.test.tsx`

This is the big integration task. It removes Sidebar/MainPanel imports, adds MeterBar/AgentCard, and rewires the layout.

**Step 1: Update App.tsx**

Key changes to `src/ui/App.tsx`:

1. **Replace imports** (remove Sidebar, MainPanel; add MeterBar, AgentCard):
```typescript
// Remove:
import { Sidebar } from './Sidebar.js';
import { MainPanel } from './MainPanel.js';
// Add:
import { MeterBar } from './MeterBar.js';
import { AgentCard } from './AgentCard.js';
```

2. **Update computed values** (remove sidebarFocused, scrollOffset references):
```typescript
const completedCount = state.agents.filter((a) => a.status === 'completed').length;
```

3. **Update StatusBar** to pass `totalTokens` instead of `cost`:
```typescript
<StatusBar
  phase={state.phase}
  activeCount={activeCount}
  pendingCount={pendingCount}
  totalCount={state.agents.length}
  totalTokens={state.totalTokens}
  elapsed={state.elapsed}
/>
```

4. **Replace the two-column `<Box flexDirection="row">` block** (lines 213-238) with single-column:
```typescript
{state.showHelp ? (
  <HelpOverlay mode={state.mode} executionStarted={state.executionRequested} />
) : (
  <Box flexDirection="column" flexGrow={1}>
    <MeterBar
      phase={state.phase}
      completedCount={completedCount}
      totalAgentCount={state.agents.length}
      totalTokens={state.totalTokens}
      elapsed={state.elapsed}
    />
    {state.addInputText !== null ? (
      <Box borderStyle="round" borderColor={catppuccinMocha.colors.green} paddingX={1} marginX={1}>
        <Text color={catppuccinMocha.colors.green}>{'> '}</Text>
        <Text>{state.addInputText.slice(0, state.addInputCursorOffset)}</Text>
        <Text color={catppuccinMocha.colors.muted}>{'█'}</Text>
        <Text>{state.addInputText.slice(state.addInputCursorOffset)}</Text>
      </Box>
    ) : null}
    <Box flexDirection="column" flexGrow={1} overflowY="hidden">
      {filteredAgents.map((agent) => (
        <AgentCard
          key={agent.id}
          name={agent.name}
          feature={agent.feature}
          status={agent.status}
          focused={agent.id === state.focusedAgentId}
          files={agent.files}
          tokens={agent.tokens}
          cost={agent.cost}
          elapsed={agent.elapsed}
          currentTool={agent.currentTool}
          approvalRequest={agent.approvalRequest}
          spinnerFrame={state.spinnerFrame}
          readyStateDetail={
            !state.executionRequested && agent.status === 'queued'
              ? (agent.removable ? 'Press d to remove' : 'Resumable checkpoint')
              : null
          }
        />
      ))}
    </Box>
  </Box>
)}
```

5. **Update completion screen** StatusBar similarly (pass `totalTokens` instead of `cost`).

**Step 2: Update App tests**

In `tests/ui/App.test.tsx`:
- Remove tests that reference Sidebar, MainPanel, panel toggling
- Update tests that check for `$` cost display to check for tokens
- Add test verifying AgentCard renders in the layout
- Add test verifying MeterBar renders during execution

**Step 3: Run all App tests**

Run: `npx vitest run tests/ui/App.test.tsx`
Expected: PASS after updates

**Step 4: Commit**

```bash
git add src/ui/App.tsx tests/ui/App.test.tsx
git commit -m "feat(ui): single-column card layout with meters, remove two-column split"
```

---

### Task 9: Remove dead files + update store (remove sidebarFocused, scrollOffset, togglePanel)

**Files:**
- Delete: `src/ui/MainPanel.tsx`, `src/ui/Sidebar.tsx`, `src/ui/AgentRow.tsx`, `src/ui/AgentExpanded.tsx`, `src/ui/OutputLine.tsx`
- Delete: `tests/ui/MainPanel.test.tsx`, `tests/ui/Sidebar.test.tsx`, `tests/ui/AgentRow.test.tsx`
- Modify: `src/ui/store.ts` — remove `sidebarFocused`, `scrollOffset`, `togglePanel`
- Modify: `tests/ui/store.test.ts` — remove tests for deleted fields

**Step 1: Delete dead source files**

```bash
rm src/ui/MainPanel.tsx src/ui/Sidebar.tsx src/ui/AgentRow.tsx src/ui/AgentExpanded.tsx src/ui/OutputLine.tsx
```

**Step 2: Delete dead test files**

```bash
rm tests/ui/MainPanel.test.tsx tests/ui/Sidebar.test.tsx tests/ui/AgentRow.test.tsx
```

**Step 3: Clean store**

In `src/ui/store.ts`:
- Remove `sidebarFocused` from `UIStore` interface and initial state
- Remove `scrollOffset` from `UIStore` interface and initial state
- Remove `togglePanel` from `UIStore` interface and implementation
- Remove `setScrollOffset` from `UIStore` interface and implementation
- In `setFocusedAgent`, remove `scrollOffset: 0` from the set call
- In `removeAgent`, remove `scrollOffset: 0` from the return

**Step 4: Remove store tests referencing deleted fields**

In `tests/ui/store.test.ts`, remove tests for `togglePanel`, `sidebarFocused`, `scrollOffset`.

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: PASS (some tests may still reference deleted components — grep and fix)

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove dead two-column components (Sidebar, MainPanel, AgentRow, AgentExpanded, OutputLine)"
```

---

### Task 10: Update HelpOverlay for new keybindings

**Files:**
- Modify: `src/ui/HelpOverlay.tsx`
- Test: `tests/ui/HelpOverlay.test.tsx`

**Step 1: Update HelpOverlay content**

Remove `Tab — switch panel` from the help shortcuts. Add `d — remove from queue` to the executing state shortcuts. Verify no references to `sidebarFocused`.

**Step 2: Update tests**

In `tests/ui/HelpOverlay.test.tsx`:
- Remove tests that check for "switch panel" in help text
- Add test that `d remove` appears in executing help

**Step 3: Run tests**

Run: `npx vitest run tests/ui/HelpOverlay.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add src/ui/HelpOverlay.tsx tests/ui/HelpOverlay.test.tsx
git commit -m "fix(ui): update HelpOverlay keybindings for single-column layout"
```

---

### Task 11: Full test suite pass + typecheck

**Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. Fix any type errors from removed `sidebarFocused`, `scrollOffset`, `togglePanel`, `cost` prop changes.

**Step 2: Run full test suite**

Run: `npm test`
Expected: PASS. Grep for any remaining references to deleted components:

```bash
grep -r "MainPanel\|Sidebar\|AgentRow\|AgentExpanded\|OutputLine\|sidebarFocused\|scrollOffset\|togglePanel" src/ tests/ --include='*.ts' --include='*.tsx'
```

Fix any found references.

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: resolve remaining references to deleted components"
```
