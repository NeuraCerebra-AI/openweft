import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../../src/ui/App.js';
import { createUIStore } from '../../src/ui/store.js';

describe('App', () => {
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
    expect(frame).toContain('◆ Billing Visible');
  });
});
