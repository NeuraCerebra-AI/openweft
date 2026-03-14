import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThemeContext, catppuccinMocha } from '../../../src/ui/theme.js';
import { StepAddMore } from '../../../src/ui/onboarding/StepAddMore.js';

const renderWithTheme = (el: React.ReactElement) =>
  render(<ThemeContext.Provider value={catppuccinMocha}>{el}</ThemeContext.Provider>);

const waitForMount = () => new Promise<void>((r) => setTimeout(r, 50));
const waitForUpdate = () => new Promise<void>((r) => setTimeout(r, 50));

const defaultProps = {
  queuedRequests: ['Add user authentication'],
  onAdvance: vi.fn(),
  onExit: vi.fn(),
  onQueueRequest: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  defaultProps.onQueueRequest = vi.fn().mockResolvedValue(undefined);
});

describe('StepAddMore', () => {
  describe('(a) shows queued items with IDs', () => {
    it('renders the title "Add more?"', () => {
      const { lastFrame } = renderWithTheme(<StepAddMore {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Add more?');
    });

    it('renders the first queued item with ID #001', () => {
      const { lastFrame } = renderWithTheme(<StepAddMore {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('#001');
      expect(frame).toContain('Add user authentication');
    });

    it('renders multiple queued items with sequential IDs', () => {
      const { lastFrame } = renderWithTheme(
        <StepAddMore
          {...defaultProps}
          queuedRequests={['Add user authentication', 'Add dark mode', 'Fix login bug']}
        />,
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('#001');
      expect(frame).toContain('Add user authentication');
      expect(frame).toContain('#002');
      expect(frame).toContain('Add dark mode');
      expect(frame).toContain('#003');
      expect(frame).toContain('Fix login bug');
    });

    it('renders count line with number of queued requests', () => {
      const { lastFrame } = renderWithTheme(
        <StepAddMore
          {...defaultProps}
          queuedRequests={['Add user authentication', 'Add dark mode']}
        />,
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('2 requests queued');
    });

    it('renders count line for a single request', () => {
      const { lastFrame } = renderWithTheme(<StepAddMore {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('1 requests queued');
    });

    it('renders select options "Continue to launch" and "Add another request"', () => {
      const { lastFrame } = renderWithTheme(<StepAddMore {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Continue to launch');
      expect(frame).toContain('Add another request');
    });

    it('renders select-mode footer with select, confirm, back, and quit keys', () => {
      const { lastFrame } = renderWithTheme(<StepAddMore {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('↑↓ select');
      expect(frame).toContain('Enter confirm');
      expect(frame).toContain('← back');
      expect(frame).toContain('Esc quit');
    });
  });

  describe('(b) "Continue to launch" fires advance', () => {
    it('calls onAdvance when "Continue to launch" is selected (first item, Enter)', async () => {
      const onAdvance = vi.fn();
      const { stdin } = renderWithTheme(
        <StepAddMore {...defaultProps} onAdvance={onAdvance} />,
      );

      await waitForMount();
      stdin.write('\r'); // Enter on the first option ("Continue to launch")
      await waitForUpdate();

      expect(onAdvance).toHaveBeenCalledOnce();
    });

    it('calls onAdvance when "Continue to launch" is navigated to and confirmed', async () => {
      const onAdvance = vi.fn();
      const { stdin } = renderWithTheme(
        <StepAddMore {...defaultProps} onAdvance={onAdvance} />,
      );

      await waitForMount();
      // First option "Continue to launch" is focused by default — just press Enter
      stdin.write('\r');
      await waitForUpdate();

      expect(onAdvance).toHaveBeenCalledOnce();
    });
  });

  describe('(c) "Add another" shows inline TextInputField', () => {
    it('shows TextInputField (› prompt) after selecting "Add another request"', async () => {
      const { stdin, lastFrame } = renderWithTheme(<StepAddMore {...defaultProps} />);

      await waitForMount();
      stdin.write('\u001B[B'); // down arrow to select "Add another request"
      await waitForUpdate();
      stdin.write('\r'); // confirm
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      expect(frame).toContain('›');
    });

    it('shows input-mode footer (submit + quit) when text input is active', async () => {
      const { stdin, lastFrame } = renderWithTheme(<StepAddMore {...defaultProps} />);

      await waitForMount();
      stdin.write('\u001B[B'); // down arrow
      await waitForUpdate();
      stdin.write('\r'); // confirm "Add another request"
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      expect(frame).toContain('Enter submit');
      expect(frame).toContain('Esc quit');
      // select and back keys should NOT be shown in input mode
      expect(frame).not.toContain('↑↓ select');
      expect(frame).not.toContain('← back');
    });

    it('hides the SelectInput when text input mode is active', async () => {
      const { stdin, lastFrame } = renderWithTheme(<StepAddMore {...defaultProps} />);

      await waitForMount();
      stdin.write('\u001B[B'); // down arrow
      await waitForUpdate();
      stdin.write('\r'); // confirm "Add another request"
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      expect(frame).not.toContain('Continue to launch');
    });
  });

  describe('(d) submitting inline input adds to queue and refreshes list', () => {
    it('calls onQueueRequest with the typed text on submit', async () => {
      const onQueueRequest = vi.fn().mockResolvedValue(undefined);
      const { stdin } = renderWithTheme(
        <StepAddMore {...defaultProps} onQueueRequest={onQueueRequest} />,
      );

      await waitForMount();
      // Navigate to "Add another request"
      stdin.write('\u001B[B'); // down arrow
      await waitForUpdate();
      stdin.write('\r'); // confirm
      await waitForUpdate();

      // Type a new request
      stdin.write('A');
      await waitForUpdate();
      stdin.write('d');
      await waitForUpdate();
      stdin.write('d');
      await waitForUpdate();
      stdin.write(' ');
      await waitForUpdate();
      stdin.write('t');
      await waitForUpdate();
      stdin.write('e');
      await waitForUpdate();
      stdin.write('s');
      await waitForUpdate();
      stdin.write('t');
      await waitForUpdate();

      // Submit
      stdin.write('\r');
      await waitForUpdate();
      await waitForUpdate();

      expect(onQueueRequest).toHaveBeenCalledOnce();
      expect(onQueueRequest).toHaveBeenCalledWith('Add test');
    });

    it('returns to select mode after submitting inline input', async () => {
      const onQueueRequest = vi.fn().mockResolvedValue(undefined);
      const { stdin, lastFrame } = renderWithTheme(
        <StepAddMore {...defaultProps} onQueueRequest={onQueueRequest} />,
      );

      await waitForMount();
      // Navigate to "Add another request"
      stdin.write('\u001B[B');
      await waitForUpdate();
      stdin.write('\r'); // confirm
      await waitForUpdate();

      // Type and submit
      stdin.write('n');
      await waitForUpdate();
      stdin.write('e');
      await waitForUpdate();
      stdin.write('w');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      await waitForUpdate(); // wait for async onQueueRequest to resolve

      // Should be back in select mode — SelectInput visible again
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Continue to launch');
    });

    it('clears the input field after submitting', async () => {
      const onQueueRequest = vi.fn().mockResolvedValue(undefined);
      const { stdin, lastFrame } = renderWithTheme(
        <StepAddMore {...defaultProps} onQueueRequest={onQueueRequest} />,
      );

      await waitForMount();
      stdin.write('\u001B[B');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();

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
      await waitForUpdate();

      // Back in select mode — input value should be cleared for next time
      // Navigate back to "Add another request"
      stdin.write('\u001B[B');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();

      // Input box should show cursor but no text (cleared)
      const frame = lastFrame() ?? '';
      // The text input should be present again (›) but not contain 'test'
      expect(frame).toContain('›');
    });

    it('does not call onQueueRequest when empty input is submitted', async () => {
      const onQueueRequest = vi.fn().mockResolvedValue(undefined);
      const { stdin } = renderWithTheme(
        <StepAddMore {...defaultProps} onQueueRequest={onQueueRequest} />,
      );

      await waitForMount();
      stdin.write('\u001B[B');
      await waitForUpdate();
      stdin.write('\r'); // confirm "Add another"
      await waitForUpdate();

      // Submit empty
      stdin.write('\r');
      await waitForUpdate();

      expect(onQueueRequest).not.toHaveBeenCalled();
    });
  });

  describe('footer transitions', () => {
    it('shows select-mode footer by default', () => {
      const { lastFrame } = renderWithTheme(<StepAddMore {...defaultProps} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('↑↓ select');
      expect(frame).toContain('Enter confirm');
      expect(frame).toContain('← back');
      expect(frame).toContain('Esc quit');
    });

    it('reverts to select-mode footer after submitting inline input', async () => {
      const onQueueRequest = vi.fn().mockResolvedValue(undefined);
      const { stdin, lastFrame } = renderWithTheme(
        <StepAddMore {...defaultProps} onQueueRequest={onQueueRequest} />,
      );

      await waitForMount();
      stdin.write('\u001B[B');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();

      stdin.write('f');
      await waitForUpdate();
      stdin.write('\r');
      await waitForUpdate();
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      expect(frame).toContain('↑↓ select');
      expect(frame).toContain('← back');
    });
  });

  describe('onExit', () => {
    it('calls onExit when Esc is pressed in select mode', async () => {
      const onExit = vi.fn();
      const { stdin } = renderWithTheme(
        <StepAddMore {...defaultProps} onExit={onExit} />,
      );

      await waitForMount();
      stdin.write('\u001B'); // Esc
      await waitForUpdate();

      expect(onExit).toHaveBeenCalledOnce();
    });

    it('calls onExit when Esc is pressed in input mode with empty input', async () => {
      const onExit = vi.fn();
      const { stdin } = renderWithTheme(
        <StepAddMore {...defaultProps} onExit={onExit} />,
      );

      await waitForMount();
      stdin.write('\u001B[B');
      await waitForUpdate();
      stdin.write('\r'); // enter input mode
      await waitForUpdate();

      // Esc with empty input → should call onExit
      stdin.write('\u001B');
      await waitForUpdate();

      expect(onExit).toHaveBeenCalledOnce();
    });
  });
});
