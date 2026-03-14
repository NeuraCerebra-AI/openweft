import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { AgentRow } from '../../src/ui/AgentRow.js';
import { AgentExpanded } from '../../src/ui/AgentExpanded.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

describe('AgentRow', () => {
  it('renders agent name and status icon for running', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <AgentRow name="Alpha" status="running" elapsed={83} focused={false} />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Alpha');
  });

  it('renders checkmark for completed', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <AgentRow name="Alpha" status="completed" elapsed={120} focused={false} />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓');
  });
});

describe('AgentExpanded', () => {
  it('renders feature name and cost', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <AgentExpanded name="Alpha" feature="auth-system" currentTool="write_file" cost={0.04} elapsed={83} />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Alpha');
    expect(frame).toContain('auth-system');
    expect(frame).toContain('$0.04');
  });
});
