import React, { useState } from 'react';
import { Box, useInput } from 'ink';

import { ThemeContext, catppuccinMocha } from '../theme.js';
import { ProgressBar } from './ProgressBar.js';
import { CompletedSummary } from './CompletedSummary.js';
import { StepWelcome } from './StepWelcome.js';
import { StepBackends } from './StepBackends.js';
import { StepInit } from './StepInit.js';
import { StepFeatureInput } from './StepFeatureInput.js';
import { StepAddMore } from './StepAddMore.js';
import { StepLaunch } from './StepLaunch.js';
import type { OnboardingState, WizardCallbacks } from './types.js';

export interface OnboardingAppProps {
  readonly initialState: OnboardingState;
  readonly callbacks: WizardCallbacks;
  readonly onComplete: (result: { launch: boolean }) => void;
}

/**
 * Build the completed summary items list based on current state.
 * Items are added as steps are completed (i.e., as currentStep advances past them).
 */
function buildCompletedItems(state: OnboardingState): readonly string[] {
  const items: string[] = [];
  const { currentStep, selectedBackend, queuedRequests } = state;

  // Step 1 complete when we're on step 2 or beyond
  if (currentStep >= 2) {
    items.push('Environment');
  }

  // Step 2 complete when we're on step 3 or beyond (and we have a backend selected)
  if (currentStep >= 3 && selectedBackend !== null) {
    items.push(`Backend: ${selectedBackend}`);
  }

  // Step 3 complete when we're on step 4 or beyond
  if (currentStep >= 4) {
    items.push('Initialized');
  }

  // Step 4 complete when we're on step 5 or beyond
  if (currentStep >= 5) {
    items.push('First request');
  }

  // Step 5 complete when we're on step 6 or beyond
  if (currentStep >= 6) {
    items.push(`Queue: ${String(queuedRequests.length)} items`);
  }

  return items;
}

export const OnboardingApp: React.FC<OnboardingAppProps> = ({
  initialState,
  callbacks,
  onComplete,
}) => {
  const [state, setState] = useState<OnboardingState>(initialState);

  const { currentStep } = state;

  // Navigation helpers
  const onAdvance = () => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.min(6, prev.currentStep + 1) as OnboardingState['currentStep'],
    }));
  };

  const onBack = () => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.max(1, prev.currentStep - 1) as OnboardingState['currentStep'],
    }));
  };

  const onExit = () => {
    onComplete({ launch: false });
  };

  // Handle ← back for steps 1-3 and 6. Steps 4 and 5 handle ← themselves
  // (only going back when text input is empty, per spec).
  useInput((_input, key) => {
    if (key.leftArrow && currentStep > 1 && currentStep !== 4 && currentStep !== 5) {
      onBack();
    }
  });

  // Build completed summary items
  const completedItems = buildCompletedItems(state);

  // Render the active step component
  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <StepWelcome
            gitDetected={state.gitDetected}
            hasCommits={state.hasCommits}
            gitInitError={state.gitInitError}
            onAdvance={onAdvance}
            onExit={onExit}
            onGitInit={callbacks.onGitInit}
            onGitInitSuccess={() => {
              setState((prev) => ({
                ...prev,
                gitDetected: true,
                hasCommits: true,
              }));
            }}
            onGitInitError={(error) => {
              setState((prev) => ({
                ...prev,
                gitInitError: error,
              }));
            }}
          />
        );

      case 2:
        return (
          <StepBackends
            codexStatus={state.codexStatus}
            claudeStatus={state.claudeStatus}
            onAdvance={(selectedBackend) => {
              setState((prev) => ({
                ...prev,
                selectedBackend,
              }));
              onAdvance();
            }}
            onExit={onExit}
            onRedetectBackends={callbacks.onRedetectBackends}
          />
        );

      case 3: {
        // selectedBackend must be set by this point
        const backend = state.selectedBackend ?? 'codex';
        return (
          <StepInit
            selectedBackend={backend}
            initialized={state.initialized}
            initError={state.initError}
            onAdvance={onAdvance}
            onExit={onExit}
            onRunInit={callbacks.onRunInit}
            onInitSuccess={() => {
              setState((prev) => ({
                ...prev,
                initialized: true,
              }));
            }}
            onInitError={(error) => {
              setState((prev) => ({
                ...prev,
                initError: error,
              }));
            }}
          />
        );
      }

      case 4:
        return (
          <StepFeatureInput
            onAdvance={onAdvance}
            onBack={onBack}
            onExit={onExit}
            onQueueRequest={async (request) => {
              await callbacks.onQueueRequest(request);
              setState((prev) => ({
                ...prev,
                queuedRequests: [...prev.queuedRequests, request],
              }));
            }}
          />
        );

      case 5:
        return (
          <StepAddMore
            queuedRequests={state.queuedRequests}
            onAdvance={onAdvance}
            onBack={onBack}
            onExit={onExit}
            onQueueRequest={async (request) => {
              await callbacks.onQueueRequest(request);
              setState((prev) => ({
                ...prev,
                queuedRequests: [...prev.queuedRequests, request],
              }));
            }}
          />
        );

      case 6: {
        const backend = state.selectedBackend ?? 'codex';
        return (
          <StepLaunch
            selectedBackend={backend}
            queuedCount={state.queuedRequests.length}
            onLaunch={(decision) => {
              setState((prev) => ({
                ...prev,
                launchDecision: decision,
              }));
              if (decision === 'start') {
                onComplete({ launch: true });
              } else {
                onComplete({ launch: false });
              }
            }}
            onExit={onExit}
          />
        );
      }

      default:
        return null;
    }
  };

  return (
    <ThemeContext.Provider value={catppuccinMocha}>
      <Box flexDirection="column">
        <ProgressBar steps={6} current={currentStep} />
        {renderStep()}
        {completedItems.length > 0 && <CompletedSummary items={completedItems} />}
      </Box>
    </ThemeContext.Provider>
  );
};

OnboardingApp.displayName = 'OnboardingApp';
