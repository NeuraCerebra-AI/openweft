import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Sidebar } from '../../src/ui/Sidebar.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';
import type { AgentState } from '../../src/ui/store.js';

const makeAgent = (overrides: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', name: 'Alpha', feature: 'auth', status: 'running',
  currentTool: null, cost: 0, elapsed: 83, outputLines: [], approvalRequest: null,
  ...overrides,
});

describe('Sidebar', () => {
  it('renders agent names', () => {
    const agents = [makeAgent(), makeAgent({ id: 'a2', name: 'Beta' })];
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Sidebar agents={agents} focusedAgentId="a1" phase={null} totalCost={0} isFocused={true} />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Alpha');
    expect(frame).toContain('Beta');
  });
});
