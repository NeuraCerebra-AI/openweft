import React from 'react';
import { Box, Text } from 'ink';

import type { UIMode } from './store.js';
import { useTheme } from './theme.js';

interface HelpOverlayProps {
  readonly mode: UIMode;
  readonly executionStarted: boolean;
  readonly canEditModelSelection?: boolean;
}

type Shortcut = readonly [key: string, description: string];

const getShortcuts = (
  mode: HelpOverlayProps['mode'],
  executionStarted: boolean,
  canEditModelSelection: boolean
): readonly Shortcut[] => {
  switch (mode) {
    case 'approval':
      return [
        ['y', 'Approve'],
        ['n', 'Deny'],
        ['a', 'Always approve'],
        ['s', 'Skip'],
        ['q', executionStarted ? 'Stop after phase' : 'Quit'],
        ['Esc', 'Back'],
      ];
    case 'input':
      return [
        ['type', 'Filter agents'],
        ['Backspace', 'Delete character'],
        ['Enter', 'Keep filter'],
        ['Esc', 'Clear filter'],
      ];
    case 'history':
      return [
        ['↑/↓', 'Navigate'],
        ['j/k', 'Navigate'],
        ['Enter', 'View detail'],
        ['Esc', 'Back to dashboard'],
        ['q', 'Quit'],
        ['?', 'Toggle this help'],
      ];
    case 'history-detail':
      return [
        ['Esc', 'Back to list'],
        ['q', 'Quit'],
        ['?', 'Toggle this help'],
      ];
    case 'model-menu':
      return [
        ['↑/↓', 'Change selected value'],
        ['j/k', 'Change selected value'],
        ['←/→', 'Move focus'],
        ['h/l', 'Move focus'],
        ['Enter', 'Save or advance'],
        ['Esc', 'Cancel'],
        ['?', 'Toggle this help'],
      ];
    case 'normal':
      return executionStarted
        ? [
            ['↑/↓', 'Navigate / Scroll'],
            ['j/k', 'Navigate / Scroll'],
            ['Enter', 'Focus agent'],
            ['/', 'Filter agents'],
            ['a', 'Add to queue'],
            ['d', 'Remove queued item'],
            ['h', 'History'],
            ['q', 'Stop after phase'],
            ['?', 'Toggle this help'],
          ]
        : [
            ['↑/↓', 'Navigate / Scroll'],
            ['j/k', 'Navigate / Scroll'],
            ['Enter', 'Focus agent'],
            ['/', 'Filter agents'],
            ['s', 'Start execution'],
            ...(canEditModelSelection ? ([['m', 'Change model + effort']] as const) : []),
            ['a', 'Add to queue'],
            ['d', 'Remove queued item'],
            ['h', 'History'],
            ['q', 'Quit'],
            ['?', 'Toggle this help'],
          ];
  }
};

export const HelpOverlay: React.FC<HelpOverlayProps> = React.memo(({ mode, executionStarted, canEditModelSelection = false }) => {
  const { colors, borders } = useTheme();
  const shortcuts = getShortcuts(mode, executionStarted, canEditModelSelection);

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle={borders.prompt} borderColor={colors.blue} padding={1}>
      <Text bold color={colors.blue}>{'Keyboard Shortcuts'}</Text>
      <Text>{''}</Text>
      {shortcuts.map(([key, description]) => (
        <Text key={key}>
          <Text bold>{key}</Text>
          <Text color={colors.subtext}>{`  ${description}`}</Text>
        </Text>
      ))}
      <Text>{''}</Text>
      <Text color={colors.muted}>{'Press ? or Esc to dismiss'}</Text>
    </Box>
  );
});

HelpOverlay.displayName = 'HelpOverlay';
