import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { StepFeatureInput } from '../../../src/ui/onboarding/StepFeatureInput.js';

const renderWithTheme = (el: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{el}</ThemeContext.Provider>);

const waitForMount = () => new Promise<void>((r) => setTimeout(r, 50));
const waitForUpdate = () => new Promise<void>((r) => setTimeout(r, 50));

const defaultProps = {
  onAdvance: vi.fn(),
  onBack: vi.fn(),
  onExit: vi.fn(),
  onQueueRequest: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  defaultProps.onQueueRequest = vi.fn().mockResolvedValue(undefined);
});

describe('StepFeatureInput', () => {
  describe('(a) render', () => {
    it('renders the title "What should OpenWeft build?"', () => {
      const { lastFrame } = renderWithTheme(<StepFeatureInput {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('What should OpenWeft build?');
    });

    it('renders the description text', () => {
      const { lastFrame } = renderWithTheme(<StepFeatureInput {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Type a feature request');
    });

    it('renders the TextInputField (› prompt)', () => {
      const { lastFrame } = renderWithTheme(<StepFeatureInput {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('›');
    });

    it('renders the footer with submit, back, and quit keys', () => {
      const { lastFrame } = renderWithTheme(<StepFeatureInput {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Enter submit');
      expect(frame).toContain('← back');
      expect(frame).toContain('Esc quit');
    });
  });

  describe('(b) submit text', () => {
    it('calls onQueueRequest then onAdvance when text is typed and Enter is pressed', async () => {
      const onAdvance = vi.fn();
      const onQueueRequest = vi.fn().mockResolvedValue(undefined);
      const { stdin } = renderWithTheme(
        <StepFeatureInput
          {...defaultProps}
          onAdvance={onAdvance}
          onQueueRequest={onQueueRequest}
        />,
      );

      await waitForMount();
      stdin.write('h');
      await waitForUpdate();
      stdin.write('i');
      await waitForUpdate();
      stdin.write('\r'); // Enter
      await waitForUpdate();
      // Give async onQueueRequest time to resolve
      await waitForUpdate();

      expect(onQueueRequest).toHaveBeenCalledOnce();
      expect(onQueueRequest).toHaveBeenCalledWith('hi');
      expect(onAdvance).toHaveBeenCalledOnce();
    });

    it('calls onAdvance after onQueueRequest resolves', async () => {
      const onAdvance = vi.fn();
      let resolveQueue!: () => void;
      const onQueueRequest = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveQueue = resolve;
          }),
      );
      const { stdin } = renderWithTheme(
        <StepFeatureInput
          {...defaultProps}
          onAdvance={onAdvance}
          onQueueRequest={onQueueRequest}
        />,
      );

      await waitForMount();
      stdin.write('t');
      await waitForUpdate();
      stdin.write('e');
      await waitForUpdate();
      stdin.write('s');
      await waitForUpdate();
      stdin.write('t');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();

      // onAdvance should not yet be called (promise pending)
      expect(onAdvance).not.toHaveBeenCalled();

      // Now resolve the queue request
      resolveQueue();
      await waitForUpdate();
      await waitForUpdate();

      expect(onAdvance).toHaveBeenCalledOnce();
    });
  });

  describe('(c) submit empty', () => {
    it('does not call onQueueRequest when Enter is pressed with empty input', async () => {
      const onQueueRequest = vi.fn().mockResolvedValue(undefined);
      const onAdvance = vi.fn();
      const { stdin } = renderWithTheme(
        <StepFeatureInput
          {...defaultProps}
          onQueueRequest={onQueueRequest}
          onAdvance={onAdvance}
        />,
      );

      await waitForMount();
      stdin.write('\r'); // Enter with empty value
      await waitForUpdate();

      expect(onQueueRequest).not.toHaveBeenCalled();
      expect(onAdvance).not.toHaveBeenCalled();
    });

    it('does not call onAdvance when Enter is pressed with whitespace-only input', async () => {
      const onQueueRequest = vi.fn().mockResolvedValue(undefined);
      const onAdvance = vi.fn();
      const { stdin } = renderWithTheme(
        <StepFeatureInput
          {...defaultProps}
          onQueueRequest={onQueueRequest}
          onAdvance={onAdvance}
        />,
      );

      await waitForMount();
      // Type spaces (trimmed → empty)
      stdin.write(' ');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();

      expect(onQueueRequest).not.toHaveBeenCalled();
      expect(onAdvance).not.toHaveBeenCalled();
    });
  });

  describe('paste handling', () => {
    it('submits short pasted text directly via onQueueRequest', async () => {
      const onQueueRequest = vi.fn().mockResolvedValue(undefined);
      const onAdvance = vi.fn();
      const { stdin } = renderWithTheme(
        <StepFeatureInput
          {...defaultProps}
          onQueueRequest={onQueueRequest}
          onAdvance={onAdvance}
        />,
      );

      await waitForMount();
      stdin.write('Add authentication');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      await waitForUpdate();

      expect(onQueueRequest).toHaveBeenCalledOnce();
      expect(onQueueRequest).toHaveBeenCalledWith('Add authentication');
      expect(onAdvance).toHaveBeenCalledOnce();
    });

    it('submits resolved content when long paste is collapsed', async () => {
      const longText = 'x'.repeat(1000);
      const onQueueRequest = vi.fn().mockResolvedValue(undefined);
      const onAdvance = vi.fn();
      const { stdin } = renderWithTheme(
        <StepFeatureInput
          {...defaultProps}
          onQueueRequest={onQueueRequest}
          onAdvance={onAdvance}
        />,
      );

      await waitForMount();
      stdin.write(longText);
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      await waitForUpdate();

      expect(onQueueRequest).toHaveBeenCalledOnce();
      expect(onQueueRequest).toHaveBeenCalledWith(longText);
      expect(onAdvance).toHaveBeenCalledOnce();
    });

    it('submits resolved text when typed characters precede a pasted token', async () => {
      const longText = 'z'.repeat(801);
      const onQueueRequest = vi.fn().mockResolvedValue(undefined);
      const { stdin } = renderWithTheme(
        <StepFeatureInput
          {...defaultProps}
          onQueueRequest={onQueueRequest}
        />,
      );

      await waitForMount();
      stdin.write('B');
      await waitForUpdate();
      stdin.write('u');
      await waitForUpdate();
      stdin.write('g');
      await waitForUpdate();
      stdin.write(' ');
      await waitForUpdate();
      stdin.write(longText);
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      await waitForUpdate();

      expect(onQueueRequest).toHaveBeenCalledOnce();
      expect(onQueueRequest).toHaveBeenCalledWith('Bug ' + longText);
    });
  });
});
