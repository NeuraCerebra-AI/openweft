import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import { formatTime } from './utils.js';

export interface MeterBarProps {
  readonly phase: { current: number; total: number } | null;
  readonly completedCount: number;
  readonly totalAgentCount: number;
  readonly totalTokens: number;
  readonly elapsed: number;
}

export const MeterBar: React.FC<MeterBarProps> = React.memo(
  ({ phase, completedCount, totalAgentCount, totalTokens, elapsed }) => {
    const { colors } = useTheme();

    if (phase === null) {
      return null;
    }

    const tokenValue =
      totalTokens >= 1000
        ? `${Math.floor(totalTokens / 1000)}k`
        : String(totalTokens);

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={colors.blue}>{`Phase ${phase.current}/${phase.total}`}</Text>
        <Text color={colors.muted}>{'·'}</Text>
        <Text color={colors.green}>{`completed ${completedCount}/${totalAgentCount}`}</Text>
        <Text color={colors.muted}>{'·'}</Text>
        <Text color={colors.peach}>{`${tokenValue} tokens`}</Text>
        <Text color={colors.muted}>{'·'}</Text>
        <Text color={colors.subtext}>{`elapsed ${formatTime(elapsed)}`}</Text>
      </Box>
    );
  }
);

MeterBar.displayName = 'MeterBar';
