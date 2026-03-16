import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';

interface FooterProps {
  readonly mode: 'normal' | 'approval' | 'input';
  readonly executionStarted: boolean;
  readonly composing: boolean;
}

type KeyBinding = readonly [key: string, description: string];

interface ModeConfig {
  readonly label: string;
  readonly colorKey: 'blue' | 'yellow' | 'green';
  readonly keys: readonly KeyBinding[];
}

const modeConfig: Record<FooterProps['mode'], ModeConfig> = {
  normal: {
    label: 'NORMAL',
    colorKey: 'blue',
    keys: [
      ['Tab', 'switch panel'],
      ['↑↓', 'navigate'],
      ['Enter', 'focus'],
      ['/', 'filter'],
      ['q', 'quit'],
      ['?', 'help'],
    ],
  },
  approval: {
    label: 'APPROVAL',
    colorKey: 'yellow',
    keys: [
      ['y', 'approve'],
      ['n', 'deny'],
      ['a', 'always'],
      ['s', 'skip'],
      ['Esc', 'back'],
    ],
  },
  input: {
    label: 'INPUT',
    colorKey: 'green',
    keys: [
      ['Enter', 'submit'],
      ['Esc', 'cancel'],
      ['↑↓', 'history'],
    ],
  },
};

export const Footer: React.FC<FooterProps> = React.memo(({ mode, executionStarted, composing }) => {
  const { colors } = useTheme();
  const config = modeConfig[mode];
  const modeColor = composing ? colors.green : colors[config.colorKey];
  const keys = composing
    ? [['Enter', 'submit'] as const, ['Esc', 'cancel'] as const]
    : mode === 'normal' && !executionStarted
      ? [['s', 'start'] as const, ['d', 'remove'] as const, ['a', 'add'] as const, ...config.keys]
      : config.keys;

  return (
    <Box flexDirection="row" gap={1}>
      <Text bold color={modeColor}>{` ${config.label} `}</Text>
      {keys.map((binding) => (
        <Text key={binding[0]}>
          <Text bold>{binding[0]}</Text>
          <Text color={colors.subtext}>{` ${binding[1]}`}</Text>
        </Text>
      ))}
    </Box>
  );
});

Footer.displayName = 'Footer';
