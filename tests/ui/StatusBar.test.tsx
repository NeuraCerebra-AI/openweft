import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StatusBar } from '../../src/ui/StatusBar.js';
import { ThemeContext, catppuccinMocha } from '../../src/ui/theme.js';

describe('StatusBar', () => {
  it('renders app name', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar
          phase={{ current: 2, total: 4 }}
          activeCount={3}
          pendingCount={5}
          totalCount={5}
          totalTokens={8400}
          elapsed={272}
        />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('openweft');
  });

  it('renders phase info', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar
          phase={{ current: 2, total: 4 }}
          activeCount={3}
          pendingCount={5}
          totalCount={5}
          totalTokens={8400}
          elapsed={272}
        />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('2/4');
  });

  it('renders the intermediate re-analysis label when provided', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar
          phase={{ current: 2, total: 4, label: 'Re-analyzing after phase 2/4' }}
          activeCount={0}
          pendingCount={5}
          totalCount={5}
          totalTokens={8400}
          elapsed={272}
        />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('Re-analyzing after phase 2/4');
  });

  it('shows token count formatted as Nk', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar
          phase={{ current: 1, total: 1 }}
          activeCount={1}
          pendingCount={0}
          totalCount={1}
          totalTokens={14200}
          elapsed={60}
        />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('14.2k');
    expect(frame).toContain('tokens');
  });

  it('does not show tokens when totalTokens is 0', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar
          phase={{ current: 1, total: 1 }}
          activeCount={1}
          pendingCount={0}
          totalCount={1}
          totalTokens={0}
          elapsed={60}
        />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).not.toContain('tokens');
  });

  it('omits phase chip when phase is null', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar phase={null} activeCount={0} pendingCount={0} totalCount={0} totalTokens={0} elapsed={0} />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('openweft');
    expect(lastFrame()).not.toContain('/');
  });

  it('renders formatted elapsed time', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar phase={null} activeCount={1} pendingCount={0} totalCount={1} totalTokens={0} elapsed={83} />
      </ThemeContext.Provider>
    );
    expect(lastFrame()).toContain('1:23');
  });

  it('renders explicit active and pending counts instead of only active over total', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar phase={null} activeCount={2} pendingCount={4} totalCount={6} totalTokens={0} elapsed={83} />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('active 2');
    expect(frame).toContain('pending 4');
    expect(frame).not.toContain('2/6');
  });

  it('shows raw count for tokens below 1000', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar phase={null} activeCount={0} pendingCount={0} totalCount={0} totalTokens={750} elapsed={0} />
      </ThemeContext.Provider>
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('750 tokens');
    expect(frame).not.toMatch(/\dk/);
  });

  it('renders the active backend, model, and effort when provided', () => {
    const { lastFrame } = render(
      <ThemeContext.Provider value={catppuccinMocha}>
        <StatusBar
          phase={null}
          activeCount={0}
          pendingCount={0}
          totalCount={0}
          totalTokens={0}
          elapsed={0}
          modelSelection={{
            backend: 'codex',
            model: 'gpt-5.4',
            effort: 'high'
          }}
        />
      </ThemeContext.Provider>
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('codex');
    expect(frame).toContain('gpt-5.4');
    expect(frame).toContain('high');
  });
});
