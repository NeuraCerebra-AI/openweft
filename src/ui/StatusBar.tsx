import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import { formatTime } from './utils.js';

interface StatusBarProps {
  readonly phase: { current: number; total: number } | null;
  readonly activeCount: number;
  readonly totalCount: number;
  readonly cost: number;
  readonly elapsed: number;
}

export const StatusBar: React.FC<StatusBarProps> = React.memo(({ phase, activeCount, totalCount, cost, elapsed }) => {
  const { colors } = useTheme();

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={colors.mauve} bold>{'◆ openweft'}</Text>
      {phase !== null && (
        <Text>
          <Text color={colors.muted}>{'│ '}</Text>
          <Text color={colors.blue}>{`⚙ ${phase.current}/${phase.total}`}</Text>
        </Text>
      )}
      {totalCount > 0 && (
        <Text>
          <Text color={colors.muted}>{'│ '}</Text>
          <Text color={colors.green}>{`${activeCount}`}</Text>
          <Text color={colors.muted}>{`/${totalCount}`}</Text>
        </Text>
      )}
      {cost > 0 && (
        <Text>
          <Text color={colors.muted}>{'│ '}</Text>
          <Text color={colors.peach}>{`$${cost.toFixed(2)}`}</Text>
        </Text>
      )}
      <Text>
        <Text color={colors.muted}>{'│ '}</Text>
        <Text>{formatTime(elapsed)}</Text>
      </Text>
    </Box>
  );
});

StatusBar.displayName = 'StatusBar';
