import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { MeterBar } from '../../src/ui/MeterBar.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

describe('MeterBar', () => {
  it('renders three meters with labels and values when phase is provided', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <MeterBar
          phase={{ current: 2, total: 4 }}
          completedCount={3}
          totalAgentCount={5}
          totalTokens={45200}
          elapsed={125}
        />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';

    // Phase meter
    expect(frame).toContain('Phase 2/4');
    expect(frame).toContain('3/5');

    // Tokens meter
    expect(frame).toContain('Tokens');
    expect(frame).toContain('45k');

    // Time meter
    expect(frame).toContain('Time');
    expect(frame).toContain('2:05');
  });

  it('returns empty output when phase is null', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <MeterBar
          phase={null}
          completedCount={0}
          totalAgentCount={0}
          totalTokens={0}
          elapsed={0}
        />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toBe('');
  });

  it('renders raw token count when below 1000', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <MeterBar
          phase={{ current: 1, total: 1 }}
          completedCount={0}
          totalAgentCount={1}
          totalTokens={750}
          elapsed={30}
        />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('750');
    expect(frame).not.toMatch(/750k/);
  });

  it('renders bar characters', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <MeterBar
          phase={{ current: 1, total: 2 }}
          completedCount={1}
          totalAgentCount={2}
          totalTokens={100000}
          elapsed={300}
        />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    // Should contain the bar character ━
    expect(frame).toContain('━');
  });

  it('formats time correctly', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <MeterBar
          phase={{ current: 1, total: 1 }}
          completedCount={0}
          totalAgentCount={1}
          totalTokens={0}
          elapsed={83}
        />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1:23');
  });
});
