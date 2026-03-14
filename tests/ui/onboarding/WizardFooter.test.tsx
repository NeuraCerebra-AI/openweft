import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { WizardFooter } from '../../../src/ui/onboarding/WizardFooter.js';

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{ui}</ThemeContext.Provider>);

describe('WizardFooter', () => {
  it('renders all four keys: select, confirm, back, quit', () => {
    const { lastFrame } = renderWithTheme(
      <WizardFooter keys={['select', 'confirm', 'back', 'quit']} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('↑↓ select');
    expect(frame).toContain('Enter confirm');
    expect(frame).toContain('← back');
    expect(frame).toContain('Esc quit');
  });

  it('renders continue and quit for Step 1 success state', () => {
    const { lastFrame } = renderWithTheme(
      <WizardFooter keys={['continue', 'quit']} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter continue');
    expect(frame).toContain('Esc quit');
    expect(frame).not.toContain('↑↓ select');
    expect(frame).not.toContain('← back');
  });

  it('renders select, confirm, quit for Step 1 error/select state', () => {
    const { lastFrame } = renderWithTheme(
      <WizardFooter keys={['select', 'confirm', 'quit']} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('↑↓ select');
    expect(frame).toContain('Enter confirm');
    expect(frame).toContain('Esc quit');
    expect(frame).not.toContain('← back');
  });

  it('renders submit, back, quit for Step 4', () => {
    const { lastFrame } = renderWithTheme(
      <WizardFooter keys={['submit', 'back', 'quit']} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter submit');
    expect(frame).toContain('← back');
    expect(frame).toContain('Esc quit');
    expect(frame).not.toContain('Enter confirm');
    expect(frame).not.toContain('Enter continue');
  });

  it('renders submit and quit for Step 5 input mode', () => {
    const { lastFrame } = renderWithTheme(
      <WizardFooter keys={['submit', 'quit']} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter submit');
    expect(frame).toContain('Esc quit');
    expect(frame).not.toContain('← back');
    expect(frame).not.toContain('↑↓ select');
  });

  it('separates hints with ·', () => {
    const { lastFrame } = renderWithTheme(
      <WizardFooter keys={['select', 'confirm', 'back', 'quit']} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('·');
  });

  it('renders only a single key with no separator', () => {
    const { lastFrame } = renderWithTheme(
      <WizardFooter keys={['quit']} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Esc quit');
    expect(frame).not.toContain('·');
  });

  it('renders continue, back, quit for Step 3', () => {
    const { lastFrame } = renderWithTheme(
      <WizardFooter keys={['continue', 'back', 'quit']} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter continue');
    expect(frame).toContain('← back');
    expect(frame).toContain('Esc quit');
  });
});
