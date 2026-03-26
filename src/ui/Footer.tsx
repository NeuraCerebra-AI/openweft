import React from 'react';
import { Box, Text } from 'ink';

import type { UIMode } from './store.js';
import { useTheme } from './theme.js';

interface FooterProps {
  readonly mode: UIMode;
  readonly executionStarted: boolean;
  readonly composing: boolean;
  readonly canEditModelSelection?: boolean;
}

type Hint = readonly [key: string, label: string];

const getHints = (
  mode: FooterProps['mode'],
  executionStarted: boolean,
  composing: boolean,
  canEditModelSelection: boolean
): readonly Hint[] => {
  if (composing) return [['Enter', 'submit'], ['Esc', 'cancel']];
  if (mode === 'history-detail') return [['Esc', 'back'], ['q', 'quit']];
  if (mode === 'history') return [['Enter', 'detail'], ['Esc', 'back'], ['q', 'quit']];
  if (mode === 'model-menu') return [['↑/↓', 'change'], ['←/→', 'focus'], ['Enter', 'save'], ['Esc', 'cancel']];
  if (mode === 'approval') return [['y', 'approve'], ['n', 'deny'], ['a', 'always'], ['s', 'skip']];
  if (mode === 'input') return [['Enter', 'submit'], ['Esc', 'cancel']];
  // normal
  if (!executionStarted) {
    return [
      ['s', 'start'],
      ...(canEditModelSelection ? ([['m', 'model']] as const) : []),
      ['a', 'add'],
      ['d', 'remove'],
      ['h', 'history'],
      ['?', 'help']
    ];
  }
  return [['a', 'add'], ['d', 'remove'], ['h', 'history'], ['q', 'stop run'], ['?', 'help']];
};

const getModeInfo = (mode: FooterProps['mode'], composing: boolean): { label: string; colorKey: 'blue' | 'yellow' | 'green' } => {
  if (composing) return { label: 'INPUT', colorKey: 'green' };
  if (mode === 'history' || mode === 'history-detail') return { label: 'HISTORY', colorKey: 'green' };
  if (mode === 'model-menu') return { label: 'MODEL', colorKey: 'green' };
  if (mode === 'approval') return { label: 'APPROVAL', colorKey: 'yellow' };
  return { label: 'NORMAL', colorKey: 'blue' };
};

export const Footer: React.FC<FooterProps> = React.memo(({ mode, executionStarted, composing, canEditModelSelection = false }) => {
  const { colors } = useTheme();
  const { label, colorKey } = getModeInfo(mode, composing);
  const hints = getHints(mode, executionStarted, composing, canEditModelSelection);

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
