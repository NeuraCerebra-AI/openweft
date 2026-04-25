import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { StepInit } from '../../../src/ui/onboarding/StepInit.js';

const renderWithTheme = (el: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{el}</ThemeContext.Provider>);

const waitForMount = () => new Promise<void>((r) => setTimeout(r, 50));
const waitForUpdate = () => new Promise<void>((r) => setTimeout(r, 50));

const makeOnRunInit = (shouldReject?: string) =>
  shouldReject !== undefined
    ? vi.fn().mockRejectedValue(new Error(shouldReject))
    : vi.fn().mockResolvedValue(undefined);

const successProps = {
  selectedBackend: 'codex' as const,
  selectedModel: 'gpt-5.5',
  selectedEffort: 'medium' as const,
  initialized: true,
  initError: null,
  onAdvance: vi.fn(),
  onExit: vi.fn(),
  onRunInit: makeOnRunInit(),
  onInitSuccess: vi.fn(),
  onInitError: vi.fn(),
};

const errorProps = {
  selectedBackend: 'codex' as const,
  selectedModel: 'gpt-5.5',
  selectedEffort: 'medium' as const,
  initialized: false,
  initError: 'Permission denied: cannot write to directory',
  onAdvance: vi.fn(),
  onExit: vi.fn(),
  onRunInit: makeOnRunInit('Permission denied: cannot write to directory'),
  onInitSuccess: vi.fn(),
  onInitError: vi.fn(),
};

const loadingProps = {
  selectedBackend: 'claude' as const,
  selectedModel: 'claude-sonnet-4-6',
  selectedEffort: 'medium' as const,
  initialized: false,
  initError: null,
  onAdvance: vi.fn(),
  onExit: vi.fn(),
  onRunInit: vi.fn(() => new Promise<void>(() => { /* never resolves */ })),
  onInitSuccess: vi.fn(),
  onInitError: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StepInit', () => {
  describe('success state (initialized=true)', () => {
    it('renders "Project initialized" title', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...successProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Project initialized');
    });

    it('renders .openweftrc.json config item with checkmark', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...successProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('✓');
      expect(frame).toContain('.openweftrc.json');
    });

    it('renders .openweft/ runtime directory item with checkmark', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...successProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('.openweft/');
    });

    it('renders feature_requests/queue.txt item with checkmark', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...successProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('feature_requests/queue.txt');
    });

    it('renders prompts/prompt-a.md item with checkmark', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...successProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('prompts/prompt-a.md');
    });

    it('renders prompts/plan-adjustment.md item with checkmark', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...successProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('prompts/plan-adjustment.md');
    });

    it('renders .gitignore item with checkmark', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...successProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('.gitignore');
    });

    it('does not render the old prompt customization tip text', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...successProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).not.toContain('The prompt files are the biggest lever for quality');
      expect(frame).not.toContain('Customize them after your first run');
    });

    it('renders footer with continue, back, and quit keys', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...successProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Enter continue');
      expect(frame).toContain('← back');
      expect(frame).toContain('Esc quit');
    });

    it('calls onAdvance when Enter is pressed in success state', async () => {
      const onAdvance = vi.fn();
      const { stdin } = renderWithTheme(<StepInit {...successProps} onAdvance={onAdvance} />);
      await waitForMount();
      stdin.write('\r');
      await waitForUpdate();
      expect(onAdvance).toHaveBeenCalledOnce();
    });

    it('calls onExit when Esc is pressed in success state', async () => {
      const onExit = vi.fn();
      const { stdin } = renderWithTheme(<StepInit {...successProps} onExit={onExit} />);
      await waitForMount();
      stdin.write('\u001B');
      await waitForUpdate();
      expect(onExit).toHaveBeenCalledOnce();
    });

    it('shows selected backend name in config item description', () => {
      const { lastFrame } = renderWithTheme(
        <StepInit {...successProps} selectedBackend="claude" />
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('claude');
    });
  });

  describe('error state (initError set)', () => {
    it('renders "Initialization failed" title', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...errorProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Initialization failed');
    });

    it('renders the specific error message', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...errorProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Permission denied: cannot write to directory');
    });

    it('renders suggestion about file permissions and disk space', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...errorProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('file permissions');
      expect(frame).toContain('disk space');
    });

    it('renders footer with back and quit keys only', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...errorProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('← back');
      expect(frame).toContain('Esc quit');
      expect(frame).not.toContain('Enter continue');
    });

    it('calls onExit when Esc is pressed in error state', async () => {
      const onExit = vi.fn();
      const { stdin } = renderWithTheme(<StepInit {...errorProps} onExit={onExit} />);
      await waitForMount();
      stdin.write('\u001B');
      await waitForUpdate();
      expect(onExit).toHaveBeenCalledOnce();
    });

    it('does not render the initialized items list in error state', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...errorProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).not.toContain('Project initialized');
      expect(frame).not.toContain('feature_requests/queue.txt');
    });
  });

  describe('loading state (initialized=false, initError=null)', () => {
    it('renders "Initializing..." while waiting', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...loadingProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Initializing');
    });

    it('does not render success items while initializing', () => {
      const { lastFrame } = renderWithTheme(<StepInit {...loadingProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).not.toContain('Project initialized');
      expect(frame).not.toContain('feature_requests/queue.txt');
    });
  });

  describe('onRunInit lifecycle', () => {
    it('calls onRunInit with selected backend, model, and effort on mount', async () => {
      const onRunInit = makeOnRunInit();
      renderWithTheme(
        <StepInit
          {...loadingProps}
          selectedBackend="claude"
          selectedModel="claude-haiku-4-5"
          selectedEffort="high"
          onRunInit={onRunInit}
        />
      );
      await waitForMount();
      expect(onRunInit).toHaveBeenCalledOnce();
      expect(onRunInit).toHaveBeenCalledWith({
        backend: 'claude',
        model: 'claude-haiku-4-5',
        effort: 'high'
      });
    });

    it('calls onInitSuccess when onRunInit resolves', async () => {
      const onInitSuccess = vi.fn();
      const onRunInit = makeOnRunInit();
      renderWithTheme(
        <StepInit
          {...loadingProps}
          onRunInit={onRunInit}
          onInitSuccess={onInitSuccess}
        />
      );
      await waitForMount();
      expect(onInitSuccess).toHaveBeenCalledOnce();
    });

    it('calls onInitError with error message when onRunInit rejects', async () => {
      const onInitError = vi.fn();
      const onRunInit = makeOnRunInit('Disk full');
      renderWithTheme(
        <StepInit
          {...loadingProps}
          onRunInit={onRunInit}
          onInitError={onInitError}
        />
      );
      await waitForMount();
      expect(onInitError).toHaveBeenCalledOnce();
      expect(onInitError).toHaveBeenCalledWith('Disk full');
    });

    it('calls onInitError with stringified error when rejection is not an Error', async () => {
      const onInitError = vi.fn();
      const onRunInit = vi.fn().mockRejectedValue('string error');
      renderWithTheme(
        <StepInit
          {...loadingProps}
          onRunInit={onRunInit}
          onInitError={onInitError}
        />
      );
      await waitForMount();
      expect(onInitError).toHaveBeenCalledOnce();
      expect(onInitError).toHaveBeenCalledWith('string error');
    });
  });
});
