import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';

interface FooterProps {
  readonly mode: 'normal' | 'approval' | 'input';
  readonly executionStarted: boolean;
  readonly composing: boolean;
}

type Hint = readonly [key: string, label: string];

const getHints = (mode: FooterProps['mode'], executionStarted: boolean, composing: boolean): readonly Hint[] => {
  if (composing) return [['Enter', 'submit'], ['Esc', 'cancel']];
  if (mode === 'approval') return [['y', 'approve'], ['n', 'deny'], ['a', 'always'], ['s', 'skip']];
  if (mode === 'input') return [['Enter', 'submit'], ['Esc', 'cancel']];
  // normal
  if (!executionStarted) return [['s', 'start'], ['a', 'add'], ['d', 'remove'], ['?', 'help']];
  return [['a', 'add'], ['d', 'remove'], ['q', 'stop run'], ['?', 'help']];
};

const getModeInfo = (mode: FooterProps['mode'], composing: boolean): { label: string; colorKey: 'blue' | 'yellow' | 'green' } => {
  if (composing) return { label: 'INPUT', colorKey: 'green' };
  if (mode === 'approval') return { label: 'APPROVAL', colorKey: 'yellow' };
  return { label: 'NORMAL', colorKey: 'blue' };
};

export const Footer: React.FC<FooterProps> = React.memo(({ mode, executionStarted, composing }) => {
  const { colors } = useTheme();
  const { label, colorKey } = getModeInfo(mode, composing);
  const hints = getHints(mode, executionStarted, composing);

  return (
    <Box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
      <Text bold color={colors[colorKey]}>{` ${label} `}</Text>
      {hints.map(([key, desc]) => (
        <Text key={key}>
          <Text bold>{key}</Text>
          <Text color={colors.subtext}>{` ${desc}`}</Text>
        </Text>
      ))}
    </Box>
  );
});

Footer.displayName = 'Footer';
