import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Footer } from '../../src/ui/Footer.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

describe('Footer', () => {
  it('renders NORMAL mode keybindings', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Footer mode="normal" executionStarted={false} composing={false} />
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
        <Footer mode="approval" executionStarted={false} composing={false} />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('APPROVAL');
    expect(frame).toContain('approve');
    expect(frame).toContain('deny');
  });

  it('shows s start hint in normal mode when execution not started', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Footer mode="normal" executionStarted={false} composing={false} />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('s');
    expect(frame).toContain('start');
  });

  it('hides s start hint in normal mode when execution started', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Footer mode="normal" executionStarted={true} composing={false} />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('start');
  });

  it('renders INPUT mode keybindings', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <Footer mode="input" executionStarted={false} composing={false} />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('INPUT');
    expect(frame).toContain('submit');
  });
});
