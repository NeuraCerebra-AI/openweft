import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../../src/ui/App.js';
import { createUIStore } from '../../src/ui/store.js';

describe('App', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders without crashing', () => {
    const store = createUIStore();
    const { lastFrame } = render(<App store={store} />);
    expect(lastFrame()).toBeDefined();
    expect(lastFrame()).toContain('openweft');
  });

  it('renders NORMAL footer by default', () => {
    const store = createUIStore();
    const { lastFrame } = render(<App store={store} />);
    expect(lastFrame()).toContain('NORMAL');
  });

  it('accepts runtime control callbacks without affecting render', () => {
    const store = createUIStore();
    const { lastFrame } = render(
      <App
        store={store}
        onQuitRequest={() => {}}
        onApprovalDecision={() => {}}
      />
    );
    expect(lastFrame()).toContain('openweft');
  });

  it('renders an AgentCard for each agent in the store', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth' });
    store.getState().addAgent({ id: 'a2', name: 'Beta', feature: 'payments' });

    const { lastFrame } = render(<App store={store} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Alpha');
    expect(frame).toContain('auth');
    expect(frame).toContain('Beta');
    expect(frame).toContain('payments');
  });

  it('renders MeterBar when phase is set', () => {
    const store = createUIStore();
    store.getState().setPhase({ current: 1, total: 3 });
    store.getState().addAgent({ id: 'a1', name: 'Alpha', feature: 'auth' });

    const { lastFrame } = render(<App store={store} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Phase 1/3');
  });

  it('clamps hidden focus to the first visible filtered agent', async () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Alpha Hidden', feature: 'auth' });
    store.getState().addAgent({ id: 'a2', name: 'Billing Visible', feature: 'payments' });
    store.getState().setFocusedAgent('a1');
    store.getState().setFilterText('bill');

    const { lastFrame } = render(<App store={store} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = lastFrame() ?? '';

    expect(store.getState().focusedAgentId).toBe('a2');
    expect(frame).toContain('Billing Visible');
    expect(frame).not.toContain('Alpha Hidden');
  });

  it('renders a completion summary when the run finishes', () => {
    const store = createUIStore();
    store.getState().setCompletion({ status: 'completed', plannedCount: 2, mergedCount: 2 });

    const { lastFrame } = render(<App store={store} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Run complete');
    expect(frame).toContain('Planned 2');
    expect(frame).toContain('Merged 2');
    expect(frame).toContain('Press q to exit');
  });

  it('shows the active backend, model, and effort in the dashboard status bar', () => {
    const store = createUIStore();
    store.getState().setModelSelection({
      backend: 'claude',
      model: 'claude-sonnet-4-6',
      effort: 'max',
      editable: true
    });

    const { lastFrame } = render(<App store={store} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('claude');
    expect(frame).toContain('claude-sonnet-4-6');
    expect(frame).toContain('max');
  });

  it('auto-clears notices after a timeout', async () => {
    vi.useFakeTimers();

    const store = createUIStore();
    render(<App store={store} />);
    store.getState().setNotice({ level: 'error', message: 'Queue write failed' });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);

    expect(store.getState().notice).toBeNull();
  });

  it('auto-clearing the quit confirmation notice also resets the pending flag', async () => {
    vi.useFakeTimers();

    const store = createUIStore();
    render(<App store={store} />);
    store.getState().setQuitConfirmPending(true);
    store.getState().setNotice({ level: 'info', message: 'Press q again to stop after current phase, Esc to cancel' });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);

    expect(store.getState().notice).toBeNull();
    expect(store.getState().quitConfirmPending).toBe(false);
  });

  it('renders the compose cursor at the insertion point', () => {
    const store = createUIStore();
    store.getState().setAddInputText('hello');
    store.getState().setAddInputCursorOffset(3);

    const { lastFrame } = render(<App store={store} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('hel');
    expect(frame).toContain('█lo');
  });

  it('deletes the previous word in compose mode for alt-delete sequences terminals send', async () => {
    const store = createUIStore();
    store.getState().setAddInputText('hello world');

    const { stdin } = render(<App store={store} />);
    await new Promise((resolve) => setTimeout(resolve, 50));

    stdin.write('\u001B\u007F');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(store.getState().addInputText).toBe('hello ');
    expect(store.getState().addInputCursorOffset).toBe(6);
  });

  it('deletes the previous word in compose mode for CSI alt-delete sequences', async () => {
    const store = createUIStore();
    store.getState().setAddInputText('hello world');

    const { stdin } = render(<App store={store} />);
    await new Promise((resolve) => setTimeout(resolve, 50));

    stdin.write('\u001B[3;3~');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(store.getState().addInputText).toBe('hello ');
    expect(store.getState().addInputCursorOffset).toBe(6);
  });

  it('renders the filter cursor at the insertion point in INPUT mode', () => {
    const store = createUIStore();
    store.getState().setMode('input');
    store.getState().setFilterText('auth');
    store.getState().setFilterCursorOffset(2);

    const { lastFrame } = render(<App store={store} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('filter');
    expect(frame).toContain('au');
    expect(frame).toContain('█th');
  });

  it('shows readyStateDetail for removable queued agents before execution', () => {
    const store = createUIStore();
    store.getState().addAgent({ id: 'a1', name: 'Queued Feature', feature: 'stuff', status: 'queued', removable: true });
    store.getState().setFocusedAgent('a1');

    const { lastFrame } = render(<App store={store} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Press d to remove');
  });
});
