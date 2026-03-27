import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { StepSuperpowers } from '../../../src/ui/onboarding/StepSuperpowers.js';

const renderWithTheme = (el: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{el}</ThemeContext.Provider>);

const waitForMount = () => new Promise<void>((r) => setTimeout(r, 50));
const waitForUpdate = () => new Promise<void>((r) => setTimeout(r, 50));

const defaultProps = {
  selectedBackend: 'codex' as const,
  onAdvance: vi.fn(),
  onBack: vi.fn(),
  onExit: vi.fn(),
  onOpenRepo: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StepSuperpowers', () => {
  it('renders an optional Superpowers slide with creator credit', () => {
    const { lastFrame } = renderWithTheme(<StepSuperpowers {...defaultProps} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Optional: Superpowers');
    expect(frame).toContain('Jesse Vincent');
    expect(frame).toContain('not this repo');
    expect(frame).toContain('OpenWeft works without it');
  });

  it('renders skip as the default action and browser-open as the secondary action', () => {
    const { lastFrame } = renderWithTheme(<StepSuperpowers {...defaultProps} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('› Skip');
    expect(frame).toContain('Open GitHub repo in browser');
    expect(frame).toContain('↑↓ select');
    expect(frame).toContain('Enter confirm');
  });

  it('uses backend-aware copy for Claude sessions', () => {
    const { lastFrame } = renderWithTheme(
      <StepSuperpowers {...defaultProps} selectedBackend="claude" />,
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Claude');
    expect(frame).toContain('new OpenWeft/Claude session');
  });

  it('advances when Skip is confirmed', async () => {
    const onAdvance = vi.fn();
    const { stdin } = renderWithTheme(
      <StepSuperpowers {...defaultProps} onAdvance={onAdvance} />,
    );

    await waitForMount();
    stdin.write('\r');
    await waitForUpdate();

    expect(onAdvance).toHaveBeenCalledOnce();
  });

  it('opens the GitHub repo in the browser and stays on the slide', async () => {
    const onOpenRepo = vi.fn().mockResolvedValue(undefined);
    const onAdvance = vi.fn();
    const { stdin, lastFrame } = renderWithTheme(
      <StepSuperpowers
        {...defaultProps}
        onAdvance={onAdvance}
        onOpenRepo={onOpenRepo}
      />,
    );

    await waitForMount();
    stdin.write('\u001B[B');
    await waitForUpdate();
    stdin.write('\r');
    await waitForUpdate();
    await waitForUpdate();

    expect(onOpenRepo).toHaveBeenCalledOnce();
    expect(onAdvance).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').toContain('Opened the GitHub repo in your browser');
    expect(lastFrame() ?? '').toContain('› Skip');
  });

  it('calls onBack on left arrow and onExit on Esc', async () => {
    const onBack = vi.fn();
    const onExit = vi.fn();
    const { stdin } = renderWithTheme(
      <StepSuperpowers {...defaultProps} onBack={onBack} onExit={onExit} />,
    );

    await waitForMount();
    stdin.write('\u001B[D');
    await waitForUpdate();
    stdin.write('\u001B');
    await waitForUpdate();

    expect(onBack).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledOnce();
  });
});
