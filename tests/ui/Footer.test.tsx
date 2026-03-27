import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Footer } from '../../src/ui/Footer.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

const renderFooter = (props: {
  mode: 'normal' | 'approval' | 'input';
  executionStarted: boolean;
  composing: boolean;
  canEditModelSelection?: boolean;
}) => {
  const { lastFrame } = render(
    <ThemeContext.Provider value={catppuccinMocha}>
      <Footer {...props} />
    </ThemeContext.Provider>
  );
  return lastFrame() ?? '';
};

describe('Footer', () => {
  it('shows NORMAL mode and start/add/remove/help in idle', () => {
    const frame = renderFooter({ mode: 'normal', executionStarted: false, composing: false });
    expect(frame).toContain('NORMAL');
    expect(frame).toContain('start');
    expect(frame).toContain('add');
    expect(frame).toContain('remove');
    expect(frame).toContain('help');
  });

  it('shows model switching in idle when pre-start editing is supported', () => {
    const frame = renderFooter({
      mode: 'normal',
      executionStarted: false,
      composing: false,
      canEditModelSelection: true
    });

    expect(frame).toContain('model');
  });

  it('hides model switching when pre-start editing is unsupported', () => {
    const frame = renderFooter({
      mode: 'normal',
      executionStarted: false,
      composing: false,
      canEditModelSelection: false
    });

    expect(frame).not.toContain('model');
  });

  it('shows d remove during execution', () => {
    const frame = renderFooter({ mode: 'normal', executionStarted: true, composing: false });
    expect(frame).toContain('NORMAL');
    expect(frame).toContain('remove');
    expect(frame).toContain('add');
    expect(frame).toContain('stop run');
    expect(frame).not.toContain('start');
  });

  it('shows APPROVAL mode with y/n/a/s', () => {
    const frame = renderFooter({ mode: 'approval', executionStarted: true, composing: false });
    expect(frame).toContain('APPROVAL');
    expect(frame).toContain('approve');
    expect(frame).toContain('deny');
    expect(frame).toContain('always');
    expect(frame).toContain('skip');
  });

  it('shows INPUT mode when composing', () => {
    const frame = renderFooter({ mode: 'normal', executionStarted: false, composing: true });
    expect(frame).toContain('INPUT');
    expect(frame).toContain('submit');
    expect(frame).toContain('cancel');
  });

  it('shows compose hints (Enter/Esc) when composing overrides normal mode', () => {
    const frame = renderFooter({ mode: 'normal', executionStarted: true, composing: true });
    expect(frame).toContain('INPUT');
    expect(frame).toContain('Enter');
    expect(frame).toContain('Esc');
    // Normal mode hints should not appear
    expect(frame).not.toContain('stop run');
    expect(frame).not.toContain('help');
  });
});
