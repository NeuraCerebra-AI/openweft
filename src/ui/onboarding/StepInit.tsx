import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import type { BackendEffortLevel } from '../../config/options.js';
import { useTheme } from '../theme.js';
import { WizardFooter } from './WizardFooter.js';
import { WizardHeader } from './WizardHeader.js';

export interface StepInitProps {
  readonly selectedBackend: 'codex' | 'claude';
  readonly selectedModel: string;
  readonly selectedEffort: BackendEffortLevel;
  readonly initialized: boolean;
  readonly initError: string | null;
  readonly onAdvance: () => void;
  readonly onExit: () => void;
  readonly onRunInit: (selection: {
    backend: 'codex' | 'claude';
    model: string;
    effort: BackendEffortLevel;
  }) => Promise<void>;
  readonly onInitSuccess: () => void;
  readonly onInitError: (error: string) => void;
}

const CREATED_ITEMS = [
  { path: '.openweftrc.json', description: 'config (backend: {backend}, model: {model}, effort: {effort})' },
  { path: '.openweft/', description: 'runtime directory' },
  { path: 'feature_requests/queue.txt', description: 'work queue' },
  { path: 'prompts/prompt-a.md', description: 'plan creation prompt' },
  { path: 'prompts/plan-adjustment.md', description: 'post-merge re-planning prompt' },
  { path: '.gitignore', description: 'added .openweft/' },
] as const;

export const StepInit: React.FC<StepInitProps> = ({
  selectedBackend,
  selectedModel,
  selectedEffort,
  initialized,
  initError,
  onAdvance,
  onExit,
  onRunInit,
  onInitSuccess,
  onInitError,
}) => {
  const { colors } = useTheme();

  // On mount, kick off initialization
  useEffect(() => {
    onRunInit({
      backend: selectedBackend,
      model: selectedModel,
      effort: selectedEffort
    }).then(
      () => {
        onInitSuccess();
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        onInitError(message);
      },
    );
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle keyboard input
  useInput((_input, key) => {
    if (initialized) {
      if (key.return) {
        onAdvance();
      } else if (key.escape) {
        onExit();
      }
    } else if (initError !== null) {
      if (key.escape) {
        onExit();
      }
    }
    // While loading: no keyboard input handled
  });

  // Determine footer keys
  const footerKeys = (() => {
    if (initialized) {
      return ['continue', 'back', 'quit'] as const;
    }
    if (initError !== null) {
      return ['back', 'quit'] as const;
    }
    // Loading — no footer keys while in-flight
    return [] as const;
  })();

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      {/* Brand header */}
      <WizardHeader subtitle="setup · init" />

      {/* Content area */}
      {initialized && (
        <Box flexDirection="column" gap={1}>
          {/* Success title */}
          <Text color={colors.green} bold>
            {'Project initialized'}
          </Text>

          {/* List of created items */}
          <Box flexDirection="column" gap={0}>
            {CREATED_ITEMS.map((item) => {
              const description = item.description
                .replace('{backend}', selectedBackend)
                .replace('{model}', selectedModel)
                .replace('{effort}', selectedEffort);
              return (
                <Box key={item.path} flexDirection="row" gap={1}>
                  <Text color={colors.green}>{'✓'}</Text>
                  <Text color={colors.text}>{item.path}</Text>
                  <Text color={colors.subtext}>{`— ${description}`}</Text>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {initError !== null && !initialized && (
        <Box flexDirection="column" gap={1}>
          {/* Error title */}
          <Text color={colors.red} bold>
            {'Initialization failed'}
          </Text>

          {/* Error message */}
          <Text color={colors.red}>{initError}</Text>

          {/* Suggestion */}
          <Text color={colors.subtext}>
            {'Check file permissions and disk space.'}
          </Text>
        </Box>
      )}

      {!initialized && initError === null && (
        <Box flexDirection="row" gap={1}>
          <Text color={colors.yellow}>{'…'}</Text>
          <Text color={colors.yellow}>{'Initializing...'}</Text>
        </Box>
      )}

      {/* Footer */}
      {footerKeys.length > 0 && <WizardFooter keys={footerKeys} />}
    </Box>
  );
};

StepInit.displayName = 'StepInit';
