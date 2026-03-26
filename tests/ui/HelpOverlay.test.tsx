import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { HelpOverlay } from '../../src/ui/HelpOverlay.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

describe('HelpOverlay', () => {
  it('renders ready-state shortcuts in normal mode before execution starts', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <HelpOverlay mode="normal" executionStarted={false} />
      </ThemeContext.Provider>
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Start execution');
    expect(frame).toContain('Add to queue');
    expect(frame).toContain('Remove queued item');
    expect(frame).toContain('j/k');
  });

  it('shows model switching in ready-state help when supported', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <HelpOverlay mode="normal" executionStarted={false} canEditModelSelection={true} />
      </ThemeContext.Provider>
    );

    expect(lastFrame()).toContain('Change model + effort');
  });

  it('does not show model switching in help when unsupported', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <HelpOverlay mode="normal" executionStarted={false} canEditModelSelection={false} />
      </ThemeContext.Provider>
    );

    expect(lastFrame()).not.toContain('Change model + effort');
  });

  it('renders approval-specific shortcuts in approval mode', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <HelpOverlay mode="approval" executionStarted={true} />
      </ThemeContext.Provider>
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Always approve');
    expect(frame).toContain('Skip');
    expect(frame).toContain('Stop after phase');
    expect(frame).not.toContain('Start execution');
  });

  it('renders input-specific shortcuts in input mode', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <HelpOverlay mode="input" executionStarted={false} />
      </ThemeContext.Provider>
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Filter agents');
    expect(frame).toContain('Delete character');
    expect(frame).not.toContain('Add to queue');
  });

  it('keeps add-to-queue available in normal mode during execution', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <HelpOverlay mode="normal" executionStarted={true} />
      </ThemeContext.Provider>
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Add to queue');
    expect(frame).not.toContain('Start execution');
  });

  it('shows remove-from-queue shortcut during execution', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <HelpOverlay mode="normal" executionStarted={true} />
      </ThemeContext.Provider>
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Remove queued item');
  });

  it('does not show Tab/switch-panel shortcut', () => {
    const idleFrame = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <HelpOverlay mode="normal" executionStarted={false} />
      </ThemeContext.Provider>
    ).lastFrame() ?? '';

    const execFrame = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <HelpOverlay mode="normal" executionStarted={true} />
      </ThemeContext.Provider>
    ).lastFrame() ?? '';

    expect(idleFrame).not.toContain('Switch panel');
    expect(execFrame).not.toContain('Switch panel');
  });
});
