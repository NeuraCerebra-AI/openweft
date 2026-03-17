import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Sidebar } from '../../src/ui/Sidebar.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';
import type { AgentState } from '../../src/ui/store.js';

const makeAgent = (overrides: Partial<AgentState> = {}): AgentState => ({
  id: 'a1', name: 'Alpha', feature: 'auth', status: 'running', removable: false,
  currentTool: null, cost: 0, elapsed: 83, outputLines: [], files: [], tokens: 0,
  approvalRequest: null,
  ...overrides,
});

const baseSidebarProps = {
  phase: null,
  totalCost: 0,
  isFocused: true,
  mode: 'normal' as const,
  filterText: '',
  filterCursorOffset: 0,
  addInputText: null,
  addInputCursorOffset: 0,
  spinnerFrame: 0,
  executionRequested: false,
  viewportHeight: 24,
};

describe('Sidebar', () => {
  it('renders agent names', () => {
    const agents = [makeAgent(), makeAgent({ id: 'a2', name: 'Beta' })];
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Sidebar
          agents={agents}
          focusedAgentId="a1"
          {...baseSidebarProps}
        />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Alpha');
    expect(frame).toContain('Beta');
  });

  it('windows the sidebar around the focused agent when agents overflow', () => {
    const agents = [
      makeAgent({ id: 'a1', name: 'Alpha' }),
      makeAgent({ id: 'a2', name: 'Beta' }),
      makeAgent({ id: 'a3', name: 'Gamma' }),
      makeAgent({ id: 'a4', name: 'Delta' }),
      makeAgent({ id: 'a5', name: 'Epsilon' }),
      makeAgent({ id: 'a6', name: 'Zeta' }),
      makeAgent({ id: 'a7', name: 'Eta' }),
      makeAgent({ id: 'a8', name: 'Theta' }),
    ];

    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Sidebar
          agents={agents}
          focusedAgentId="a6"
          {...baseSidebarProps}
          viewportHeight={12}
        />
      </ThemeContext.Provider>
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Zeta');
    expect(frame).toContain('↑ more');
    expect(frame).toContain('↓ more');
    expect(frame).not.toContain('Alpha');
  });

  it('shows ready-state source details for queued vs resumable work', () => {
    const agents = [
      makeAgent({ id: 'resume-1', name: 'Resume work', status: 'queued', removable: false }),
      makeAgent({ id: 'queue-1', name: 'Queued work', status: 'queued', removable: true })
    ];

    const { lastFrame, rerender } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Sidebar
          agents={agents}
          focusedAgentId="resume-1"
          {...baseSidebarProps}
        />
      </ThemeContext.Provider>
    );

    const resumeFrame = lastFrame() ?? '';
    expect(resumeFrame).toContain('Resumable');
    expect(resumeFrame).toContain('checkpoint');

    rerender(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Sidebar
          agents={agents}
          focusedAgentId="queue-1"
          {...baseSidebarProps}
        />
      </ThemeContext.Provider>
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Queued request');
    expect(frame).toContain('Press d');
    expect(frame).toContain('remove');
  });
});
