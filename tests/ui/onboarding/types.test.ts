import { describe, it, expectTypeOf } from 'vitest';

import type { BackendDetection, OnboardingState, StepKey, WizardCallbacks } from '../../../src/ui/onboarding/types.js';

describe('onboarding types', () => {
  it('BackendDetection has installed and authenticated boolean fields', () => {
    const detection: BackendDetection = { installed: true, authenticated: false };
    expectTypeOf(detection.installed).toEqualTypeOf<boolean>();
    expectTypeOf(detection.authenticated).toEqualTypeOf<boolean>();
  });

  it('StepKey is a union of 1 through 7', () => {
    expectTypeOf<StepKey>().toEqualTypeOf<1 | 2 | 3 | 4 | 5 | 6 | 7>();
  });

  it('OnboardingState has all required fields with correct types', () => {
    const state: OnboardingState = {
      currentStep: 1,
      gitDetected: true,
      hasCommits: false,
      codexStatus: { installed: true, authenticated: true },
      claudeStatus: { installed: false, authenticated: false },
      selectedBackend: 'codex',
      selectedModel: 'gpt-5.3-codex',
      selectedEffort: 'medium',
      gitInitError: null,
      initialized: false,
      initError: null,
      queuedRequests: [],
      launchDecision: null,
    };
    expectTypeOf(state.currentStep).toEqualTypeOf<StepKey>();
    expectTypeOf(state.gitDetected).toEqualTypeOf<boolean>();
    expectTypeOf(state.hasCommits).toEqualTypeOf<boolean>();
    expectTypeOf(state.codexStatus).toEqualTypeOf<BackendDetection>();
    expectTypeOf(state.claudeStatus).toEqualTypeOf<BackendDetection>();
    expectTypeOf(state.selectedBackend).toEqualTypeOf<'codex' | 'claude' | null>();
    expectTypeOf(state.selectedModel).toEqualTypeOf<string | null>();
    expectTypeOf(state.selectedEffort).toEqualTypeOf<'low' | 'medium' | 'high' | 'xhigh' | 'max' | null>();
    expectTypeOf(state.gitInitError).toEqualTypeOf<string | null>();
    expectTypeOf(state.initialized).toEqualTypeOf<boolean>();
    expectTypeOf(state.initError).toEqualTypeOf<string | null>();
    expectTypeOf(state.queuedRequests).toEqualTypeOf<string[]>();
    expectTypeOf(state.launchDecision).toEqualTypeOf<'start' | 'exit' | null>();
  });

  it('WizardCallbacks has correct async callback signatures', () => {
    const callbacks: WizardCallbacks = {
      onGitInit: async () => undefined,
      onRunInit: async (_selection) => undefined,
      onQueueRequest: async (_request: string) => undefined,
      onOpenSuperpowersRepo: async (_backend) => undefined,
      onRedetectBackends: async () => ({
        codex: { installed: true, authenticated: true },
        claude: { installed: false, authenticated: false },
      }),
    };
    expectTypeOf(callbacks.onGitInit).toEqualTypeOf<() => Promise<void>>();
    expectTypeOf(callbacks.onRunInit).toEqualTypeOf<(selection: {
      backend: 'codex' | 'claude';
      model: string;
      effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    }) => Promise<void>>();
    expectTypeOf(callbacks.onQueueRequest).toEqualTypeOf<(request: string) => Promise<void>>();
    expectTypeOf(callbacks.onOpenSuperpowersRepo).toEqualTypeOf<
      (backend: 'codex' | 'claude') => Promise<void>
    >();
    expectTypeOf(callbacks.onRedetectBackends).toEqualTypeOf<() => Promise<{ codex: BackendDetection; claude: BackendDetection }>>();
  });
});
