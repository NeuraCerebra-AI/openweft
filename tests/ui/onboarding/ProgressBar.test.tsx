import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { ProgressBar } from '../../../src/ui/onboarding/ProgressBar.js';

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{ui}</ThemeContext.Provider>);

describe('ProgressBar', () => {
  it('renders the counter text "3 / 6"', () => {
    const { lastFrame } = renderWithTheme(<ProgressBar steps={6} current={3} />);
    expect(lastFrame()).toContain('3 / 6');
  });

  it('renders 6 dots total (filled for done/active, hollow for pending)', () => {
    const { lastFrame } = renderWithTheme(<ProgressBar steps={6} current={3} />);
    const frame = lastFrame() ?? '';
    // 2 completed + 1 active = 3 filled dots
    const filledCount = (frame.match(/●/g) ?? []).length;
    // 3 pending = 3 hollow dots
    const hollowCount = (frame.match(/○/g) ?? []).length;
    expect(filledCount).toBe(3);
    expect(hollowCount).toBe(3);
  });

  it('renders 2 completed dots, 1 active dot, and 3 pending dots for current=3', () => {
    const { lastFrame } = renderWithTheme(<ProgressBar steps={6} current={3} />);
    const frame = lastFrame() ?? '';
    // positions 1,2 = completed (filled), position 3 = active (filled), positions 4,5,6 = pending (hollow)
    const filledCount = (frame.match(/●/g) ?? []).length;
    const hollowCount = (frame.match(/○/g) ?? []).length;
    expect(filledCount).toBe(3); // 2 completed + 1 active
    expect(hollowCount).toBe(3); // 3 pending
  });

  it('renders only 1 active dot for current=1 (no completed)', () => {
    const { lastFrame } = renderWithTheme(<ProgressBar steps={6} current={1} />);
    const frame = lastFrame() ?? '';
    const filledCount = (frame.match(/●/g) ?? []).length;
    const hollowCount = (frame.match(/○/g) ?? []).length;
    expect(filledCount).toBe(1); // 0 completed + 1 active
    expect(hollowCount).toBe(5); // 5 pending
    expect(frame).toContain('1 / 6');
  });

  it('renders all filled dots for current=6 (last step)', () => {
    const { lastFrame } = renderWithTheme(<ProgressBar steps={6} current={6} />);
    const frame = lastFrame() ?? '';
    const filledCount = (frame.match(/●/g) ?? []).length;
    const hollowCount = (frame.match(/○/g) ?? []).length;
    expect(filledCount).toBe(6); // 5 completed + 1 active
    expect(hollowCount).toBe(0);
    expect(frame).toContain('6 / 6');
  });
});
