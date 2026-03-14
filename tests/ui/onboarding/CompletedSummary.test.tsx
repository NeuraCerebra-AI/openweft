import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { CompletedSummary } from '../../../src/ui/onboarding/CompletedSummary.js';

const renderWithTheme = (element: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{element}</ThemeContext.Provider>);

describe('CompletedSummary', () => {
  it('renders checkmark and label for each item', () => {
    const { lastFrame } = renderWithTheme(
      <CompletedSummary items={['Environment', 'Backend: codex']} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓ Environment');
    expect(frame).toContain('✓ Backend: codex');
  });

  it('renders a checkmark prefix for every item', () => {
    const { lastFrame } = renderWithTheme(
      <CompletedSummary items={['Environment', 'Backend: codex']} />
    );
    const frame = lastFrame() ?? '';
    const checkmarks = (frame.match(/✓/g) ?? []).length;
    expect(checkmarks).toBe(2);
  });

  it('renders nothing when items is empty', () => {
    const { lastFrame } = renderWithTheme(<CompletedSummary items={[]} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('✓');
  });

  it('renders a single item correctly', () => {
    const { lastFrame } = renderWithTheme(
      <CompletedSummary items={['Environment']} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓ Environment');
    const checkmarks = (frame.match(/✓/g) ?? []).length;
    expect(checkmarks).toBe(1);
  });
});
