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
});
