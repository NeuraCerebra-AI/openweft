import React from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../theme.js';
import { SelectInput } from './SelectInput.js';
import { WizardFooter } from './WizardFooter.js';

export interface StepLaunchProps {
  readonly selectedBackend: 'codex' | 'claude';
  readonly queuedCount: number;
  readonly onLaunch: (decision: 'start' | 'exit') => void;
  readonly onExit: () => void;
}

type LaunchOptionValue = 'start' | 'exit';

const PIPELINE_STEPS = [
  { step: 1, text: 'Create an implementation plan for each request' },
  {
    step: 2,
    text: 'Score and group by file overlap — non-conflicting work runs in parallel',
  },
  { step: 3, text: null }, // rendered dynamically with backend name
  { step: 4, text: 'Merge results, re-plan remaining work, repeat until done' },
] as const;

const USEFUL_COMMANDS = [
  { cmd: 'openweft status', description: 'check progress' },
  { cmd: 'openweft add', description: 'queue more requests while running' },
  { cmd: 'openweft stop', description: 'gracefully halt' },
] as const;

export const StepLaunch: React.FC<StepLaunchProps> = ({
  selectedBackend,
  queuedCount,
  onLaunch,
  onExit,
}) => {
  const { colors } = useTheme();

  // Handle Esc to exit
  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  const handleSelect = (value: LaunchOptionValue) => {
    onLaunch(value);
  };

  const startLabel =
    queuedCount === 1
      ? `Start now — 1 request queued`
      : `Start now — ${String(queuedCount)} requests queued`;

  const launchOptions = [
    { label: startLabel, value: 'start' as const },
    { label: 'Exit — run openweft later to start', value: 'exit' as const },
  ] satisfies ReadonlyArray<{ label: string; value: LaunchOptionValue }>;

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      {/* Brand header */}
      <Box flexDirection="row" gap={1}>
        <Text color={colors.mauve} bold>
          {'◆ openweft'}
        </Text>
        <Text color={colors.subtext}>{'setup · launch'}</Text>
      </Box>

      {/* Title */}
      <Text color={colors.lavender} bold>
        {'Ready to start'}
      </Text>

      {/* Pipeline explanation */}
      <Box flexDirection="column" gap={0}>
        {PIPELINE_STEPS.map((item) => {
          const text =
            item.step === 3
              ? `Execute each in an isolated git worktree using ${selectedBackend}`
              : item.text;

          return (
            <Box key={item.step} flexDirection="row" gap={1}>
              <Text color={colors.muted}>{`${String(item.step)}.`}</Text>
              <Text color={colors.text}>{text}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Useful commands */}
      <Box flexDirection="column" gap={0}>
        {USEFUL_COMMANDS.map((item) => (
          <Box key={item.cmd} flexDirection="row" gap={1}>
            <Text color={colors.teal}>{item.cmd}</Text>
            <Text color={colors.subtext}>{`— ${item.description}`}</Text>
          </Box>
        ))}
      </Box>

      {/* Select input */}
      <SelectInput<LaunchOptionValue> options={launchOptions} onSelect={handleSelect} />

      {/* Footer */}
      <WizardFooter keys={['select', 'confirm', 'back', 'quit']} />
    </Box>
  );
};

StepLaunch.displayName = 'StepLaunch';
