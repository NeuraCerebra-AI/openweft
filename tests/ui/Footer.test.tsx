import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Footer } from '../../src/ui/Footer.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

describe('Footer', () => {
  it('renders NORMAL mode keybindings', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Footer mode="normal" />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('NORMAL');
    expect(frame).toContain('Tab');
    expect(frame).toContain('quit');
  });

  it('renders APPROVAL mode keybindings', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Footer mode="approval" />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('APPROVAL');
    expect(frame).toContain('approve');
    expect(frame).toContain('deny');
  });

  it('renders INPUT mode keybindings', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Footer mode="input" />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('INPUT');
    expect(frame).toContain('submit');
  });
});
