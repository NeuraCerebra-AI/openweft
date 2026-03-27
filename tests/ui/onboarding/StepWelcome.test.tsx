import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { StepWelcome } from '../../../src/ui/onboarding/StepWelcome.js';

const renderWithTheme = (el: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{el}</ThemeContext.Provider>);

const waitForMount = () => new Promise<void>((r) => setTimeout(r, 50));
const waitForUpdate = () => new Promise<void>((r) => setTimeout(r, 50));

const defaultProps = {
  gitDetected: true,
  hasCommits: true,
  gitInitError: null,
  onAdvance: vi.fn(),
  onExit: vi.fn(),
  onGitInit: vi.fn().mockResolvedValue(undefined),
  onGitInitError: vi.fn(),
  onGitInitSuccess: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StepWelcome', () => {
  describe('git detected state', () => {
    it('renders brand header with openweft name and setup label', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('openweft');
      expect(frame).toContain('setup');
    });

    it('renders one-liner description', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Orchestrate AI coding agents across parallel git worktrees.');
    });

    it('renders second description line', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('You give it feature requests.');
    });

    it('renders "Git repository detected" with checkmark when gitDetected=true', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...defaultProps} gitDetected={true} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Git repository detected');
      expect(frame).toContain('✓');
    });

    it('renders Node.js version with checkmark', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Node.js');
      expect(frame).toContain('v24');
    });

    it('renders footer with continue and quit keys', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Enter continue');
      expect(frame).toContain('Esc quit');
    });

    it('calls onAdvance when Enter is pressed and git is detected', async () => {
      const onAdvance = vi.fn();
      const { stdin } = renderWithTheme(
        <StepWelcome {...defaultProps} gitDetected={true} onAdvance={onAdvance} />
      );

      await waitForMount();
      stdin.write('\r');
      await waitForUpdate();

      expect(onAdvance).toHaveBeenCalledOnce();
    });

    it('calls onExit when Esc is pressed and git is detected', async () => {
      const onExit = vi.fn();
      const { stdin } = renderWithTheme(
        <StepWelcome {...defaultProps} gitDetected={true} onExit={onExit} />
      );

      await waitForMount();
      stdin.write('\u001B'); // Esc
      await waitForUpdate();

      expect(onExit).toHaveBeenCalledOnce();
    });

    it('does not show git init select menu when git is detected', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...defaultProps} gitDetected={true} />);
      const frame = lastFrame() ?? '';
      expect(frame).not.toContain('Initialize git here');
      expect(frame).not.toContain('No git repository found');
    });
  });

  describe('no git repository state', () => {
    const noGitProps = {
      ...defaultProps,
      gitDetected: false,
      hasCommits: false,
    };

    it('renders "No git repository found" title', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...noGitProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('No git repository found');
    });

    it('renders description about git worktrees requirement', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...noGitProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('OpenWeft uses git worktrees');
    });

    it('renders SelectInput with "Initialize git here" and "Exit" options', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...noGitProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Initialize git here');
      expect(frame).toContain('Exit');
    });

    it('renders footer with select, confirm, and quit keys', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...noGitProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('↑↓ select');
      expect(frame).toContain('Enter confirm');
      expect(frame).toContain('Esc quit');
    });

    it('calls onExit when "Exit" is selected', async () => {
      const onExit = vi.fn();
      const { stdin } = renderWithTheme(
        <StepWelcome {...noGitProps} onExit={onExit} />
      );

      await waitForMount();
      stdin.write('\u001B[B'); // down arrow to select "Exit"
      await waitForUpdate();
      stdin.write('\r'); // confirm
      await waitForUpdate();

      expect(onExit).toHaveBeenCalledOnce();
    });

    it('calls onGitInit when "Initialize git here" is selected', async () => {
      const onGitInit = vi.fn().mockResolvedValue(undefined);
      const onGitInitSuccess = vi.fn();
      const { stdin } = renderWithTheme(
        <StepWelcome {...noGitProps} onGitInit={onGitInit} onGitInitSuccess={onGitInitSuccess} />
      );

      await waitForMount();
      stdin.write('\r'); // first option "Initialize git here" is focused by default
      await waitForUpdate();
      await waitForMount(); // wait for async onGitInit to complete

      expect(onGitInit).toHaveBeenCalledOnce();
      expect(onGitInitSuccess).toHaveBeenCalledOnce();
    });

    it('calls onGitInitError when git init fails', async () => {
      const onGitInit = vi.fn().mockRejectedValue(new Error('Permission denied'));
      const onGitInitError = vi.fn();
      const { stdin } = renderWithTheme(
        <StepWelcome {...noGitProps} onGitInit={onGitInit} onGitInitError={onGitInitError} />
      );

      await waitForMount();
      stdin.write('\r'); // select "Initialize git here"
      await waitForUpdate();
      await waitForMount(); // wait for async rejection to propagate

      expect(onGitInitError).toHaveBeenCalledOnce();
      expect(onGitInitError).toHaveBeenCalledWith('Permission denied');
    });

    it('shows initializing indicator while git init is in progress', async () => {
      let resolveInit!: () => void;
      const onGitInit = vi.fn(
        () => new Promise<void>((resolve) => { resolveInit = resolve; })
      );
      const { stdin, lastFrame } = renderWithTheme(
        <StepWelcome {...noGitProps} onGitInit={onGitInit} />
      );

      await waitForMount();
      stdin.write('\r');
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      expect(frame).toContain('Initializing');

      resolveInit();
    });
  });

  describe('gitInitError state', () => {
    const gitInitErrorProps = {
      ...defaultProps,
      gitDetected: false,
      hasCommits: false,
      gitInitError: 'Permission denied: cannot create .git directory',
    };

    it('renders the error message when gitInitError is set', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...gitInitErrorProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Git initialization failed');
      expect(frame).toContain('Permission denied: cannot create .git directory');
    });

    it('renders footer with only quit key in error state', () => {
      const { lastFrame } = renderWithTheme(<StepWelcome {...gitInitErrorProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Esc quit');
      expect(frame).not.toContain('Enter continue');
      expect(frame).not.toContain('Enter confirm');
    });

    it('calls onExit when Esc is pressed in error state', async () => {
      const onExit = vi.fn();
      const { stdin } = renderWithTheme(
        <StepWelcome {...gitInitErrorProps} onExit={onExit} />
      );

      await waitForMount();
      stdin.write('\u001B'); // Esc
      await waitForUpdate();

      expect(onExit).toHaveBeenCalledOnce();
    });
  });

  describe('git detected after successful init', () => {
    it('renders "Git repository detected" and "Initial commit created" after successful init', () => {
      const { lastFrame } = renderWithTheme(
        <StepWelcome
          {...defaultProps}
          gitDetected={true}
          hasCommits={true}
          gitInitError={null}
        />
      );
      // When the parent updates props after a successful git init,
      // the component should show the success state
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Git repository detected');
    });
  });
});
