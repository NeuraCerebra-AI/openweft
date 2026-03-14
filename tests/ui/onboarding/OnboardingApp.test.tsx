import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import type { OnboardingState, WizardCallbacks } from '../../../src/ui/onboarding/types.js';
import { OnboardingApp } from '../../../src/ui/onboarding/OnboardingApp.js';

const waitForMount = () => new Promise<void>((r) => setTimeout(r, 50));
const waitForUpdate = () => new Promise<void>((r) => setTimeout(r, 50));

const makeState = (overrides?: Partial<OnboardingState>): OnboardingState => ({
  currentStep: 1,
  gitDetected: true,
  hasCommits: true,
  codexStatus: { installed: true, authenticated: true },
  claudeStatus: { installed: true, authenticated: true },
  selectedBackend: null,
  gitInitError: null,
  initialized: false,
  initError: null,
  queuedRequests: [],
  launchDecision: null,
  ...overrides,
});

const makeCallbacks = (): WizardCallbacks => ({
  onGitInit: vi.fn().mockResolvedValue(undefined),
  onRunInit: vi.fn().mockResolvedValue(undefined),
  onQueueRequest: vi.fn().mockResolvedValue(undefined),
  onRedetectBackends: vi.fn().mockResolvedValue({
    codex: { installed: true, authenticated: true },
    claude: { installed: true, authenticated: true },
  }),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OnboardingApp', () => {
  describe('(a) renders step 1 initially', () => {
    it('renders StepWelcome content on step 1', () => {
      const onComplete = vi.fn();
      const { lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 1 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('openweft');
      expect(frame).toContain('setup');
      expect(frame).toContain('Git repository detected');
    });

    it('does NOT show StepBackends content on step 1', () => {
      const onComplete = vi.fn();
      const { lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 1 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );
      const frame = lastFrame() ?? '';
      // StepBackends shows "backends" in the subheader
      expect(frame).not.toContain('backends');
    });
  });

  describe('(b) advancing steps works', () => {
    it('pressing Enter on step 1 advances to step 2', async () => {
      const onComplete = vi.fn();
      const { stdin, lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 1 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );

      await waitForMount();
      stdin.write('\r'); // Enter
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      // StepBackends shows "backends" in the subtitle
      expect(frame).toContain('backends');
    });

    it('initialState with currentStep=2 renders StepBackends', async () => {
      const onComplete = vi.fn();
      const { lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 2 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );

      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('backends');
    });

    it('initialState with currentStep=3 renders StepInit (after selecting backend)', async () => {
      const onComplete = vi.fn();
      const callbacks = makeCallbacks();
      // onRunInit never resolves in this test (we just want to see the init step)
      callbacks.onRunInit = vi.fn(() => new Promise<void>(() => {}));

      const { lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 3, selectedBackend: 'codex' })}
          callbacks={callbacks}
          onComplete={onComplete}
        />
      );

      await waitForMount();
      const frame = lastFrame() ?? '';
      // StepInit shows "init" in the subtitle
      expect(frame).toContain('init');
    });
  });

  describe('(c) left arrow on step 2 goes back to step 1', () => {
    it('left arrow on step 2 returns to step 1', async () => {
      const onComplete = vi.fn();
      const { stdin, lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 2 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );

      await waitForMount();
      stdin.write('\u001B[D'); // left arrow
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      // Should show StepWelcome content
      expect(frame).toContain('Git repository detected');
      expect(frame).not.toContain('backends');
    });
  });

  describe('(d) left arrow on step 1 does nothing', () => {
    it('left arrow on step 1 stays on step 1', async () => {
      const onComplete = vi.fn();
      const { stdin, lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 1 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );

      await waitForMount();
      stdin.write('\u001B[D'); // left arrow
      await waitForUpdate();

      const frame = lastFrame() ?? '';
      // Should still show step 1 content
      expect(frame).toContain('Git repository detected');
      expect(frame).not.toContain('backends');
    });
  });

  describe('(e) Esc calls exit', () => {
    it('Esc on step 1 calls onComplete with launch: false', async () => {
      const onComplete = vi.fn();
      const { stdin } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 1 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );

      await waitForMount();
      stdin.write('\u001B'); // Esc
      await waitForUpdate();

      expect(onComplete).toHaveBeenCalledWith({ launch: false });
    });
  });

  describe('(f) ProgressBar shows correct step', () => {
    it('shows "1 / 6" on step 1', () => {
      const onComplete = vi.fn();
      const { lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 1 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('1 / 6');
    });

    it('shows "2 / 6" on step 2', async () => {
      const onComplete = vi.fn();
      const { lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 2 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('2 / 6');
    });
  });

  describe('(g) CompletedSummary grows with each step', () => {
    it('shows no completed summary items on step 1', () => {
      const onComplete = vi.fn();
      const { lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 1 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );
      const frame = lastFrame() ?? '';
      // CompletedSummary shows "Environment" after step 1 is complete
      // On step 1, nothing is completed yet
      expect(frame).not.toContain('Environment');
    });

    it('shows "Environment" in completed summary on step 2', async () => {
      const onComplete = vi.fn();
      const { lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 2 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Environment');
    });

    it('shows "Environment" and "Backend: codex" in completed summary on step 3', async () => {
      const onComplete = vi.fn();
      const callbacks = makeCallbacks();
      callbacks.onRunInit = vi.fn(() => new Promise<void>(() => {}));

      const { lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 3, selectedBackend: 'codex' })}
          callbacks={callbacks}
          onComplete={onComplete}
        />
      );
      await waitForMount();
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Environment');
      expect(frame).toContain('Backend: codex');
    });
  });

  describe('(h) footer keys change per step', () => {
    it('step 1 footer shows "Enter continue" and "Esc quit"', () => {
      const onComplete = vi.fn();
      const { lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 1 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Enter continue');
      expect(frame).toContain('Esc quit');
    });

    it('step 2 footer shows back key when both backends ready', async () => {
      const onComplete = vi.fn();
      const { lastFrame } = render(
        <OnboardingApp
          initialState={makeState({ currentStep: 2 })}
          callbacks={makeCallbacks()}
          onComplete={onComplete}
        />
      );
      await waitForMount();
      const frame = lastFrame() ?? '';
      // StepBackends in select mode shows back key
      expect(frame).toContain('← back');
    });
  });
});
