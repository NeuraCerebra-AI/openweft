import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../theme.js';
import { SelectInput } from './SelectInput.js';
import { WizardFooter } from './WizardFooter.js';

export interface StepWelcomeProps {
  readonly gitDetected: boolean;
  readonly hasCommits: boolean;
  readonly gitInitError: string | null;
  readonly onAdvance: () => void;
  readonly onExit: () => void;
  readonly onGitInit: () => Promise<void>;
  readonly onGitInitError: (error: string) => void;
  readonly onGitInitSuccess: () => void;
}

const GIT_INIT_OPTIONS = [
  { label: 'Initialize git here', value: 'init' },
  { label: 'Exit', value: 'exit' },
] as const;

type GitInitOptionValue = (typeof GIT_INIT_OPTIONS)[number]['value'];

export const StepWelcome: React.FC<StepWelcomeProps> = ({
  gitDetected,
  hasCommits,
  gitInitError,
  onAdvance,
  onExit,
  onGitInit,
  onGitInitError,
  onGitInitSuccess,
}) => {
  const { colors } = useTheme();
  const [initializing, setInitializing] = useState(false);

  // Node.js version from runtime
  const nodeVersion = process.version;

  // Key handling — only active when git is detected (success state)
  // or when there is a gitInitError (only Esc)
  useInput((_input, key) => {
    if (gitDetected) {
      if (key.return) {
        onAdvance();
      } else if (key.escape) {
        onExit();
      }
    } else if (gitInitError !== null) {
      if (key.escape) {
        onExit();
      }
    }
    // When no git and no error: SelectInput handles its own keys
  });

  const handleSelectOption = (value: GitInitOptionValue) => {
    if (value === 'exit') {
      onExit();
      return;
    }

    // value === 'init'
    setInitializing(true);
    onGitInit()
      .then(() => {
        setInitializing(false);
        onGitInitSuccess();
      })
      .catch((err: unknown) => {
        setInitializing(false);
        const message = err instanceof Error ? err.message : String(err);
        onGitInitError(message);
      });
  };

  // Determine footer keys
  const footerKeys = (() => {
    if (gitDetected) {
      return ['continue', 'quit'] as const;
    }
    if (gitInitError !== null) {
      return ['quit'] as const;
    }
    return ['select', 'confirm', 'quit'] as const;
  })();

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      {/* Brand header */}
      <Box flexDirection="row" gap={1}>
        <Text color={colors.mauve} bold>
          {'◆ openweft'}
        </Text>
        <Text color={colors.subtext}>{'setup'}</Text>
      </Box>

      {/* Taglines */}
      <Box flexDirection="column">
        <Text color={colors.text}>
          {'Orchestrate AI coding agents across parallel git worktrees.'}
        </Text>
        <Text color={colors.subtext}>
          {'You give it feature requests. It plans, phases, executes, and merges.'}
        </Text>
      </Box>

      {/* Environment status */}
      <Box flexDirection="column" gap={0}>
        {gitDetected ? (
          <>
            <Box flexDirection="row" gap={1}>
              <Text color={colors.green}>{'✓'}</Text>
              <Text color={colors.text}>{'Git repository detected'}</Text>
            </Box>
            {hasCommits && (
              <Box flexDirection="row" gap={1}>
                <Text color={colors.green}>{'✓'}</Text>
                <Text color={colors.text}>{'Initial commit created'}</Text>
              </Box>
            )}
          </>
        ) : (
          <>
            {/* No git state */}
            {gitInitError !== null ? (
              /* Git init failed — show error inline */
              <Box flexDirection="column" gap={1}>
                <Box flexDirection="row" gap={1}>
                  <Text color={colors.red}>{'✗'}</Text>
                  <Text color={colors.red}>{'Git initialization failed:'}</Text>
                </Box>
                <Text color={colors.red}>{gitInitError}</Text>
              </Box>
            ) : initializing ? (
              /* In-progress indicator */
              <Box flexDirection="row" gap={1}>
                <Text color={colors.yellow}>{'…'}</Text>
                <Text color={colors.yellow}>{'Initializing git repository...'}</Text>
              </Box>
            ) : (
              /* No git — prompt to init */
              <Box flexDirection="column" gap={1}>
                <Text color={colors.yellow} bold>
                  {'No git repository found'}
                </Text>
                <Text color={colors.subtext}>
                  {
                    'OpenWeft uses git worktrees to run agents in parallel. This directory needs to be a git repository.'
                  }
                </Text>
                <SelectInput<GitInitOptionValue>
                  options={GIT_INIT_OPTIONS}
                  onSelect={handleSelectOption}
                />
              </Box>
            )}
          </>
        )}

        {/* Node.js version — always shown */}
        <Box flexDirection="row" gap={1}>
          <Text color={colors.green}>{'✓'}</Text>
          <Text color={colors.text}>{`Node.js ${nodeVersion}`}</Text>
        </Box>
      </Box>

      {/* Footer */}
      <WizardFooter keys={footerKeys} />
    </Box>
  );
};

StepWelcome.displayName = 'StepWelcome';
