import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { MainPanel } from '../../src/ui/MainPanel.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';
import type { OutputLine } from '../../src/ui/store.js';

describe('MainPanel', () => {
  it('renders output lines', () => {
    const lines: OutputLine[] = [
      { type: 'text', content: 'Hello from agent', timestamp: Date.now() },
    ];
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <MainPanel agentName="Alpha" lines={lines} scrollOffset={0} viewportHeight={20} />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('Hello from agent');
  });

  it('renders empty state when no lines', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <MainPanel agentName="Alpha" lines={[]} scrollOffset={0} viewportHeight={20} />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('Alpha');
  });
});
