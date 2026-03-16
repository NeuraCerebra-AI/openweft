# Dashboard Ready State Design

## Problem

When a returning user types `openweft` with pending queue items, the TUI dashboard opens and execution begins immediately — spending money and modifying the codebase with zero confirmation. This violates the principle of least surprise and erodes trust.

## Solution

Open the TUI dashboard in a **ready state** where features are visible but execution hasn't started. The user presses `s` to start. Everything else about the dashboard remains unchanged.

## Behavior Change

### Before

```
openweft (returning user, pending queue)
  → handlers.start({})
    → opens TUI + immediately runs orchestration
```

### After

```
openweft (returning user, pending queue)
  → opens TUI in ready state (pending features in sidebar, "Idle" in sidebar footer)
  → user presses 's'
  → orchestration begins
```

### Explicit `openweft start` — unchanged

`openweft start` is a deliberate command. It continues to auto-execute. The ready state only applies to the bare `openweft` smart-dispatch path.

## What Changes

### 1. Store: add `executionRequested` signal

Add to `UIStore`:

```typescript
executionRequested: boolean;
requestExecution: () => void;
```

`requestExecution()` sets `executionRequested = true`. One-shot — once requested, stays true.

Also extend `addAgent`'s init parameter to accept an optional `status`:

```typescript
addAgent: (init: { id: string; name: string; feature: string; status?: AgentStatus }) => void;
```

Default remains `'running'` when omitted (preserves all existing call sites). The ready state passes `status: 'queued'` when pre-populating.

### 2. Keybinding: `s` in NORMAL mode starts execution

In `handleKeypress`, NORMAL mode gains one case:

```typescript
case 's':
  if (!state.executionRequested) {
    handlers.onStartRequest?.();
    return 'handled';
  }
  return 'unhandled';
```

Add `onStartRequest` to `KeypressHandlers`:

```typescript
onStartRequest?: () => void;
```

The callback calls `store.getState().requestExecution()`.

Note: `s` means "skip" in APPROVAL mode. No conflict — mode routing keeps them separate, and the footer always shows which mode you're in.

### 3. Footer: show `s start` conditionally

The Footer's key list is currently static at module scope. Make it dynamic:

- Add `executionStarted` prop to `FooterProps`
- Compute NORMAL mode keys inside the component: prepend `['s', 'start']` when `executionStarted` is false

```typescript
interface FooterProps {
  readonly mode: 'normal' | 'approval' | 'input';
  readonly executionStarted: boolean;
}
```

The static `modeConfig` stays for approval/input modes. Only NORMAL mode's keys become conditional.

### 4. HelpOverlay: add `s` keybinding

Add one line to the help overlay shortcuts:

```tsx
<Text><Text bold>{'s'}</Text><Text color={colors.subtext}>{'       Start execution'}</Text></Text>
```

### 5. App: thread new props

- Pass `executionStarted={state.executionRequested}` to `<Footer>`
- Pass `onStartRequest` through to `handleKeypress` handlers

```tsx
<Footer mode={state.mode} executionStarted={state.executionRequested} />
```

### 6. `launch` handler: open TUI without auto-executing

Replace the current `await handlers.start({})` path with:

1. Set up the TUI (same as `start`'s TUI path — extract a shared helper to avoid duplication)
2. Pre-populate the store with features from checkpoint/queue
3. Race two signals: `executionRequested` becomes true OR quit is requested
4. If execution requested → call `runRealOrchestration()`
5. If quit → clean exit, no orchestration

**Shared TUI setup helper** — extract from `start`'s TUI path (lines 554–609 of handlers.ts):

```typescript
interface TuiSession {
  store: StoreApi<UIStore>;
  stopController: StopController;
  approvalController: ApprovalController;
  onEvent: OrchestratorEventHandler;
  app: FullScreenApp;
  cleanup: () => Promise<void>;
}

const setupTuiSession = async (deps, onQuit): Promise<TuiSession>
```

Both `launch` (ready state) and `start` (immediate execution) call `setupTuiSession`, then diverge: `launch` waits for `s`, `start` runs orchestration immediately.

**Pre-populating the sidebar:**

- From checkpoint: features have `id`, `title`/`request`, and `status` — map directly to `addAgent({ id, name: title ?? request, feature: request, status: 'queued' })`
- From queue (no checkpoint): pending lines only have `request` text. Synthesize IDs as `pending-${index}` and use request as both name and feature. These placeholder agents get replaced by real ones once orchestration creates them.

**The gate:**

```typescript
await Promise.race([
  new Promise<'start'>((resolve) => {
    const unsub = store.subscribe((s) => {
      if (s.executionRequested) { unsub(); resolve('start'); }
    });
  }),
  new Promise<'quit'>((resolve) => {
    // resolve on quit signal from stopController
  }),
]);
```

Subscribe **before** `app.start()` to avoid race on fast `s` press.

### 7. Timer: start on execution, not on mount

The App component's elapsed timer starts immediately on mount. In ready state this would tick up before any work happens. Gate the timer:

```typescript
useEffect(() => {
  if (!state.executionRequested) return;
  const start = Date.now();
  const timer = setInterval(() => { /* ... */ }, 1000);
  return () => clearInterval(timer);
}, [store, state.executionRequested]);
```

## What Doesn't Change

- `openweft start` behavior (explicit command, auto-executes)
- `openweft start --bg`, `--tmux`, `--dry-run`, `--stream`
- Approval flow, all other keybindings
- Non-TTY behavior

## Edge Cases

- **No pending items**: `launch` already falls through to `status` display. Unchanged.
- **Background already running**: `launch` already shows status. Unchanged.
- **User presses `s` multiple times**: No-op after first press (one-shot flag).
- **User quits before pressing `s`**: Promise.race resolves with `'quit'`, clean exit, nothing executed.
- **Checkpoint with `executing` features**: Displayed as `queued` in sidebar — they'll be reset to `planned` on resume per existing behavior.
- **Fast `s` press**: Subscribe before `app.start()` ensures no missed signal.

## Files Touched

| File | Change |
|------|--------|
| `src/ui/store.ts` | Add `executionRequested`, `requestExecution()`, optional `status` on `addAgent` init |
| `src/ui/hooks/useKeyboard.ts` | Add `s` handler + `onStartRequest` to `KeypressHandlers` |
| `src/ui/Footer.tsx` | Add `executionStarted` prop, conditional `s start` in NORMAL keys |
| `src/ui/HelpOverlay.tsx` | Add `s` to shortcuts list |
| `src/ui/App.tsx` | Thread `onStartRequest` + `executionStarted` props, gate elapsed timer |
| `src/cli/handlers.ts` | Extract `setupTuiSession` helper, refactor `launch` to open TUI in ready state |
