# Dashboard Ready State Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bare `openweft` opens the TUI dashboard in a ready state — user presses `s` to start execution instead of auto-launching.

**Architecture:** Add `executionRequested` boolean to UIStore, gate the elapsed timer on it, add `s` keybinding in NORMAL mode, make Footer keys conditional, extract shared TUI setup helper from handlers.ts, refactor `launch` to open TUI in ready state with a Promise.race gate.

**Tech Stack:** Zustand, Ink, React, TypeScript/ESM

**Spec:** `docs/superpowers/specs/2026-03-15-dashboard-ready-state-design.md`

---

## Chunk 1: Store + Keyboard Foundation

### Task 1: Add `executionRequested` to store

**Files:**
- Modify: `src/ui/store.ts:28-54` (UIStore interface), `src/ui/store.ts:56-121` (createUIStore)
- Modify: `tests/ui/store.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/ui/store.test.ts`:

```typescript
it('initializes executionRequested as false', () => {
  const state = store.getState();
  expect(state.executionRequested).toBe(false);
});

it('sets executionRequested via requestExecution', () => {
  store.getState().requestExecution();
  expect(store.getState().executionRequested).toBe(true);
});

it('requestExecution is idempotent', () => {
  store.getState().requestExecution();
  store.getState().requestExecution();
  expect(store.getState().executionRequested).toBe(true);
});

it('adds agent with custom status when provided', () => {
  store.getState().addAgent({ id: 'beta', name: 'Beta', feature: 'api', status: 'queued' });
  expect(store.getState().agents[0]?.status).toBe('queued');
});

it('adds agent with running status by default', () => {
  store.getState().addAgent({ id: 'gamma', name: 'Gamma', feature: 'auth' });
  expect(store.getState().agents[0]?.status).toBe('running');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/store.test.ts -v`
Expected: FAIL — `executionRequested` and `requestExecution` don't exist, `addAgent` doesn't accept `status`

- [ ] **Step 3: Implement store changes**

In `src/ui/store.ts`, add to `UIStore` interface:

```typescript
executionRequested: boolean;
requestExecution: () => void;
```

Change `addAgent` signature:

```typescript
addAgent: (init: { id: string; name: string; feature: string; status?: AgentStatus }) => void;
```

In `createUIStore`, add initial state:

```typescript
executionRequested: false,
```

Add action:

```typescript
requestExecution: () => set({ executionRequested: true }),
```

Change `addAgent` implementation to use `init.status ?? 'running'`:

```typescript
addAgent: (init) =>
  set((state) => ({
    agents: [
      ...state.agents,
      {
        ...init,
        status: init.status ?? 'running' as const,
        currentTool: null,
        cost: 0,
        elapsed: 0,
        outputLines: [],
        approvalRequest: null,
      },
    ],
  })),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ui/store.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/store.ts tests/ui/store.test.ts
git commit -m "feat(ui): add executionRequested to store, optional status on addAgent"
```

---

### Task 2: Add `s` keybinding for start

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts:7-10` (KeypressHandlers), `src/ui/hooks/useKeyboard.ts:30-75` (normal mode)
- Modify: `tests/ui/hooks/useKeyboard.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/ui/hooks/useKeyboard.test.ts`:

```typescript
it('fires onStartRequest on s in normal mode when execution not yet requested', () => {
  const store = createUIStore();
  const starts: boolean[] = [];
  const result = handleKeypress(store, 's', {
    onStartRequest: () => { starts.push(true); }
  });
  expect(result).toBe('handled');
  expect(starts).toEqual([true]);
});

it('ignores s in normal mode when execution already requested', () => {
  const store = createUIStore();
  store.getState().requestExecution();
  const starts: boolean[] = [];
  const result = handleKeypress(store, 's', {
    onStartRequest: () => { starts.push(true); }
  });
  expect(result).toBe('unhandled');
  expect(starts).toEqual([]);
});

it('s still means skip in approval mode', () => {
  const store = createUIStore();
  store.getState().setMode('approval');
  const decisions: string[] = [];
  const result = handleKeypress(store, 's', {
    onApprovalDecision: (d) => { decisions.push(d); }
  });
  expect(result).toBe('handled');
  expect(decisions).toEqual(['skip']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/hooks/useKeyboard.test.ts -v`
Expected: FAIL — `onStartRequest` not in handlers type

- [ ] **Step 3: Implement keybinding changes**

In `src/ui/hooks/useKeyboard.ts`, add to `KeypressHandlers`:

```typescript
onStartRequest?: () => void;
```

In the `case 'normal'` switch, add before the `default`:

```typescript
case 's':
  if (!state.executionRequested && handlers.onStartRequest) {
    handlers.onStartRequest();
    return 'handled';
  }
  return 'unhandled';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ui/hooks/useKeyboard.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useKeyboard.ts tests/ui/hooks/useKeyboard.test.ts
git commit -m "feat(ui): add s keybinding for start execution in normal mode"
```

---

## Chunk 2: UI Components (Footer, HelpOverlay, App)

### Task 3: Conditional `s start` in Footer

**Files:**
- Modify: `src/ui/Footer.tsx`

- [ ] **Step 1: Add `executionStarted` prop and compute keys dynamically**

Change `FooterProps`:

```typescript
interface FooterProps {
  readonly mode: 'normal' | 'approval' | 'input';
  readonly executionStarted: boolean;
}
```

Keep static `modeConfig` but compute NORMAL keys inside the component. Replace the component:

```tsx
export const Footer: React.FC<FooterProps> = React.memo(({ mode, executionStarted }) => {
  const { colors } = useTheme();
  const config = modeConfig[mode];
  const modeColor = colors[config.colorKey];
  const keys = mode === 'normal' && !executionStarted
    ? [['s', 'start'] as const, ...config.keys]
    : config.keys;

  return (
    <Box flexDirection="row" gap={1}>
      <Text bold color={modeColor}>{` ${config.label} `}</Text>
      {keys.map((binding) => (
        <Text key={binding[0]}>
          <Text bold>{binding[0]}</Text>
          <Text color={colors.subtext}>{` ${binding[1]}`}</Text>
        </Text>
      ))}
    </Box>
  );
});
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Errors in App.tsx because Footer now requires `executionStarted` prop — this is expected and fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/ui/Footer.tsx
git commit -m "feat(ui): show conditional s start hint in footer"
```

---

### Task 4: Add `s` to HelpOverlay

**Files:**
- Modify: `src/ui/HelpOverlay.tsx`

- [ ] **Step 1: Add s shortcut line**

After the `?` line (line 18) and before the blank line (line 19), add:

```tsx
<Text><Text bold>{'s'}</Text><Text color={colors.subtext}>{'       Start execution'}</Text></Text>
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/HelpOverlay.tsx
git commit -m "feat(ui): add s start to help overlay"
```

---

### Task 5: Thread props through App

**Files:**
- Modify: `src/ui/App.tsx:16-20` (AppProps), `src/ui/App.tsx:37-44` (timer), `src/ui/App.tsx:46-61` (useInput), `src/ui/App.tsx:99` (Footer)

- [ ] **Step 1: Add `onStartRequest` to AppProps**

```typescript
interface AppProps {
  readonly store: StoreApi<UIStore>;
  readonly onQuitRequest?: (reason: 'keyboard') => void;
  readonly onApprovalDecision?: (decision: 'approve' | 'deny' | 'skip' | 'always') => void;
  readonly onStartRequest?: () => void;
}
```

- [ ] **Step 2: Destructure and thread through**

Add `onStartRequest` to the component destructuring:

```typescript
export const App: React.FC<AppProps> = ({ store, onQuitRequest, onApprovalDecision, onStartRequest }) => {
```

Pass it to `handleKeypress`:

```typescript
const result = handleKeypress(store, keyName, {
  ...(onQuitRequest ? { onQuit: onQuitRequest } : {}),
  ...(onApprovalDecision ? { onApprovalDecision } : {}),
  ...(onStartRequest ? { onStartRequest } : {}),
});
```

- [ ] **Step 3: Gate the elapsed timer on executionRequested**

Replace the existing `useEffect` timer (lines 37-44) with:

```typescript
const startTimeRef = useRef<number | null>(null);

useEffect(() => {
  if (!state.executionRequested) return;
  if (startTimeRef.current === null) startTimeRef.current = Date.now();
  const origin = startTimeRef.current;
  const timer = setInterval(() => {
    const currentState = store.getState();
    currentState.setElapsed(Math.floor((Date.now() - origin) / 1000));
    currentState.tickAgentElapsed();
  }, 1000);
  return () => clearInterval(timer);
}, [store, state.executionRequested]);
```

- [ ] **Step 4: Pass `executionStarted` to Footer**

Change line 99:

```tsx
<Footer mode={state.mode} executionStarted={state.executionRequested} />
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Run all UI tests**

Run: `npx vitest run tests/ui/ -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat(ui): thread onStartRequest and gate timer on executionRequested"
```

---

## Chunk 3: Handlers Refactor (Launch Ready State)

### Task 6: Extract shared TUI setup helper

**Files:**
- Modify: `src/cli/handlers.ts:554-609` (start handler TUI path)

- [ ] **Step 1: Extract `startTuiSession` helper**

Add this helper function inside `createCommandHandlers`, before the `handlers` object. It extracts the TUI setup from the `start` handler's TTY path:

```typescript
const startTuiSession = async (input: {
  config: ResolvedOpenWeftConfig;
  configHash: string;
  onStartRequest?: () => void;
}): Promise<void> => {
  const { withFullScreen } = await import('fullscreen-ink');
  const { App } = await import('../ui/App.js');
  const { createUIStore } = await import('../ui/store.js');
  const { createEventHandler } = await import('../ui/hooks/useOrchestratorBridge.js');
  const React = await import('react');

  const uiStore = createUIStore();
  const onEvent = createEventHandler(uiStore);
  const stopController = new StopController();
  const approvalController = new ApprovalController(onEvent);
  const notificationDependencies = createDefaultNotificationDependencies();

  const app = withFullScreen(
    React.createElement(App, {
      store: uiStore,
      onQuitRequest: () => { stopController.request('signal'); },
      onApprovalDecision: (decision) => { approvalController.resolveCurrent(decision); },
      onStartRequest: input.onStartRequest,
    }),
    { exitOnCtrlC: false }
  );
  await app.start();

  const signalHandler = () => {
    if (!stopController.isRequested) stopController.request('signal');
  };
  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  try {
    // If onStartRequest provided, wait for executionRequested or quit
    if (input.onStartRequest) {
      const action = await Promise.race([
        new Promise<'start'>((resolve) => {
          const unsub = uiStore.subscribe((s) => {
            if (s.executionRequested) { unsub(); resolve('start'); }
          });
        }),
        new Promise<'quit'>((resolve) => {
          const origRequest = stopController.request.bind(stopController);
          stopController.request = (reason: string) => {
            origRequest(reason);
            resolve('quit');
          };
        }),
      ]);
      if (action === 'quit') return;
    }

    await runRealOrchestration({
      config: input.config,
      configHash: input.configHash,
      adapter: selectAdapter({ backend: input.config.backend, streamOutput: false }),
      stopController,
      approvalController,
      notificationDependencies,
      streamOutput: false,
      tmuxRequested: false,
      sleep: resolvedDependencies.sleep,
      onEvent,
    });
  } finally {
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
    app.instance.unmount();
    await app.waitUntilExit();
  }
};
```

- [ ] **Step 2: Replace `start` handler's TUI path with the helper**

Replace lines 554–609 (the `if (process.stdout.isTTY && ...)` block) with:

```typescript
if (process.stdout.isTTY && !options.bg && !options.tmux && !tmuxMonitor && !options.dryRun) {
  await startTuiSession({ config, configHash });
  return;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run -v`
Expected: PASS — no behavior change, just extraction

- [ ] **Step 5: Commit**

```bash
git add src/cli/handlers.ts
git commit -m "refactor(cli): extract startTuiSession helper from start handler"
```

---

### Task 7: Refactor `launch` to use ready state

**Files:**
- Modify: `src/cli/handlers.ts` (launch handler, lines 328-373)

- [ ] **Step 1: Replace auto-start with ready-state TUI**

In the `launch` handler, replace the block:

```typescript
const queueContent = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
const { pending } = parseQueueFile(queueContent);
if (pending.length > 0) {
  await handlers.start({});
  return;
}
```

With ready-state logic that pre-populates the sidebar and waits for `s`:

```typescript
const queueContent = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
const { pending } = parseQueueFile(queueContent);

const checkpointResult = await loadCheckpoint({
  checkpointFile: config.paths.checkpointFile,
  checkpointBackupFile: config.paths.checkpointBackupFile,
});

if (pending.length > 0 || checkpointResult.checkpoint) {
  if (process.stdout.isTTY) {
    const { createUIStore } = await import('../ui/store.js');
    const preStore = createUIStore();

    // Pre-populate sidebar from checkpoint or queue
    if (checkpointResult.checkpoint) {
      for (const feature of Object.values(checkpointResult.checkpoint.features)) {
        preStore.getState().addAgent({
          id: feature.id,
          name: feature.title ?? feature.request,
          feature: feature.request,
          status: 'queued',
        });
      }
      if (!preStore.getState().focusedAgentId && preStore.getState().agents.length > 0) {
        preStore.getState().setFocusedAgent(preStore.getState().agents[0]!.id);
      }
    } else {
      pending.forEach((line, index) => {
        const id = `pending-${index}`;
        preStore.getState().addAgent({ id, name: line.request, feature: line.request, status: 'queued' });
      });
      if (preStore.getState().agents.length > 0) {
        preStore.getState().setFocusedAgent(preStore.getState().agents[0]!.id);
      }
    }

    await startTuiSession({
      config,
      configHash,
      onStartRequest: () => { preStore.getState().requestExecution(); },
    });
    return;
  }
  // Non-TTY: just start
  await handlers.start({});
  return;
}

if (checkpointResult.checkpoint) {
  await handlers.status();
  return;
}

await handlers.status();
```

Wait — there's a problem. The `startTuiSession` helper creates its own store. But we need pre-populated agents to show in the ready state. The helper needs to accept an existing store OR accept pre-population data.

Let me reconsider. The cleanest approach: have `startTuiSession` accept an optional `prePopulate` callback that receives the store before the app starts. This keeps the helper self-contained.

- [ ] **Step 1 (revised): Update `startTuiSession` to accept pre-populate hook**

Add `prePopulate` to the helper's input:

```typescript
const startTuiSession = async (input: {
  config: ResolvedOpenWeftConfig;
  configHash: string;
  onStartRequest?: () => void;
  prePopulate?: (store: StoreApi<UIStore>) => void;
}): Promise<void> => {
```

After `const uiStore = createUIStore();` and before `const app = withFullScreen(...)`, add:

```typescript
input.prePopulate?.(uiStore);
```

And in the gate section, wire `onStartRequest` to the store:

```typescript
if (input.onStartRequest) {
```

Replace with:

```typescript
const gated = Boolean(input.onStartRequest);
if (gated) {
```

And the `onStartRequest` prop passed to App should call the store's `requestExecution` directly:

```typescript
onStartRequest: gated ? () => { uiStore.getState().requestExecution(); } : undefined,
```

Remove `input.onStartRequest` from the App props — the helper owns the wiring.

- [ ] **Step 2: Rewrite the launch handler's pending-queue path**

Replace the existing pending check block in `launch` with:

```typescript
const queueContent = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
const { pending } = parseQueueFile(queueContent);
const checkpointResult = await loadCheckpoint({
  checkpointFile: config.paths.checkpointFile,
  checkpointBackupFile: config.paths.checkpointBackupFile,
});

const hasWork = pending.length > 0 || (checkpointResult.checkpoint &&
  Object.values(checkpointResult.checkpoint.features).some((f) =>
    f.status === 'planned' || f.status === 'executing' || f.status === 'pending'
  ));

if (hasWork) {
  if (!process.stdout.isTTY) {
    await handlers.start({});
    return;
  }
  await startTuiSession({
    config,
    configHash,
    onStartRequest: () => {},
    prePopulate: (store) => {
      if (checkpointResult.checkpoint) {
        for (const feature of Object.values(checkpointResult.checkpoint.features)) {
          store.getState().addAgent({
            id: feature.id,
            name: feature.title ?? feature.request,
            feature: feature.request,
            status: 'queued',
          });
        }
      } else {
        pending.forEach((line, index) => {
          store.getState().addAgent({
            id: `pending-${index}`,
            name: line.request,
            feature: line.request,
            status: 'queued',
          });
        });
      }
      const first = store.getState().agents[0];
      if (first) store.getState().setFocusedAgent(first.id);
    },
  });
  return;
}

if (checkpointResult.checkpoint) {
  await handlers.status();
  return;
}

await handlers.status();
```

- [ ] **Step 3: Remove duplicate checkpoint load**

The old `launch` handler loaded the checkpoint after the pending check. Now we load it earlier (before the `hasWork` check). Remove the second `loadCheckpoint` call that was on lines 363-366.

- [ ] **Step 4: Add `configHash` to launch**

The launch handler currently calls `loadOpenWeftConfig` but only destructures `config`. We also need `configHash` for `startTuiSession`. Change:

```typescript
const { config } = await loadOpenWeftConfig(cwd);
```

To:

```typescript
const { config, configHash } = await loadOpenWeftConfig(cwd);
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/handlers.ts
git commit -m "feat(cli): launch opens TUI in ready state, press s to start"
```

---

### Task 8: Verify end-to-end

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run -v`
Expected: PASS

- [ ] **Step 3: Manual smoke test**

If possible, run `openweft` in a project with pending queue items. Verify:
- Dashboard opens with features shown as `queued` (○ icon)
- Footer shows `s start` as first keybinding
- Timer shows `0:00` and doesn't tick
- Pressing `s` starts execution, `s start` disappears from footer, timer starts
- Pressing `q` before `s` exits cleanly

- [ ] **Step 4: Run release check**

Run: `npm run release:check`
Expected: PASS
