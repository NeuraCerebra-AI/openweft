import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { StepLaunch } from '../../../src/ui/onboarding/StepLaunch.js';

const renderWithTheme = (el: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{el}</ThemeContext.Provider>);

const waitForMount = () => new Promise<void>((r) => setTimeout(r, 50));
const waitForUpdate = () => new Promise<void>((r) => setTimeout(r, 50));

const defaultProps = {
  selectedBackend: 'codex' as const,
  queuedCount: 3,
  onLaunch: vi.fn(),
  onExit: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StepLaunch', () => {
  describe('(a) shows pipeline steps 1-4', () => {
    it('renders the title "Ready to start"', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Ready to start');
    });

    it('renders pipeline step 1: Create an implementation plan', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Create an implementation plan');
    });

    it('renders pipeline step 2: Score and group by file overlap', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Score and group by file overlap');
    });

    it('renders pipeline step 3: Execute each in an isolated git worktree', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Execute each in an isolated git worktree');
    });

    it('renders the selected backend name in step 3', () => {
      const { lastFrame } = renderWithTheme(
        <StepLaunch {...defaultProps} selectedBackend="claude" />,
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('claude');
    });

    it('renders codex backend name in step 3 when codex is selected', () => {
      const { lastFrame } = renderWithTheme(
        <StepLaunch {...defaultProps} selectedBackend="codex" />,
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('codex');
    });

    it('renders pipeline step 4: Merge results, re-plan, repeat', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Merge results');
    });

    it('renders all four step numbers', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('1');
      expect(frame).toContain('2');
      expect(frame).toContain('3');
      expect(frame).toContain('4');
    });
  });

  describe('(b) shows useful commands', () => {
    it('renders openweft status command', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('openweft status');
    });

    it('renders openweft add command', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('openweft add');
    });

    it('renders openweft stop command', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('openweft stop');
    });
  });

  describe('(c) "Start now" fires launch decision', () => {
    it('renders "Start now" option with queued count', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} queuedCount={3} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Start now');
      expect(frame).toContain('3 requests queued');
    });

    it('renders singular "1 request queued" when queuedCount is 1', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} queuedCount={1} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('1 request queued');
    });

    it('calls onLaunch("start") when "Start now" is selected (first item, Enter)', async () => {
      const onLaunch = vi.fn();
      const { stdin } = renderWithTheme(<StepLaunch {...defaultProps} onLaunch={onLaunch} />);

      await waitForMount();
      stdin.write('\r'); // Enter on the first option ("Start now")
      await waitForUpdate();

      expect(onLaunch).toHaveBeenCalledOnce();
      expect(onLaunch).toHaveBeenCalledWith('start');
    });

    it('renders footer with select, confirm, back, and quit keys', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('↑↓ select');
      expect(frame).toContain('Enter confirm');
      expect(frame).toContain('← back');
      expect(frame).toContain('Esc quit');
    });
  });

  describe('(d) "Exit" fires exit decision', () => {
    it('renders "Exit" option with run later message', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Exit');
    });

    it('calls onLaunch("exit") when "Exit" is selected', async () => {
      const onLaunch = vi.fn();
      const { stdin } = renderWithTheme(<StepLaunch {...defaultProps} onLaunch={onLaunch} />);

      await waitForMount();
      stdin.write('\u001B[B'); // down arrow to select "Exit"
      await waitForUpdate();
      stdin.write('\r'); // confirm
      await waitForUpdate();

      expect(onLaunch).toHaveBeenCalledOnce();
      expect(onLaunch).toHaveBeenCalledWith('exit');
    });

    it('calls onExit when Esc is pressed', async () => {
      const onExit = vi.fn();
      const { stdin } = renderWithTheme(<StepLaunch {...defaultProps} onExit={onExit} />);

      await waitForMount();
      stdin.write('\u001B'); // Esc
      await waitForUpdate();

      expect(onExit).toHaveBeenCalledOnce();
    });

    it('does not call onLaunch when Esc is pressed', async () => {
      const onLaunch = vi.fn();
      const { stdin } = renderWithTheme(<StepLaunch {...defaultProps} onLaunch={onLaunch} />);

      await waitForMount();
      stdin.write('\u001B'); // Esc
      await waitForUpdate();

      expect(onLaunch).not.toHaveBeenCalled();
    });
  });

  describe('brand header', () => {
    it('renders the openweft brand name', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('openweft');
    });

    it('renders the "launch" context label', () => {
      const { lastFrame } = renderWithTheme(<StepLaunch {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('launch');
    });
  });
});
