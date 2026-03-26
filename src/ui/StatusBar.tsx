import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import { formatTime } from './utils.js';

interface StatusBarProps {
  readonly phase: { current: number; total: number; label?: string } | null;
  readonly activeCount: number;
  readonly pendingCount: number;
  readonly totalCount: number;
  readonly totalTokens: number;
  readonly elapsed: number;
  readonly modelSelection?: {
    readonly backend: string;
    readonly model: string;
    readonly effort: string;
  } | null;
}

export const StatusBar: React.FC<StatusBarProps> = React.memo(
  ({ phase, activeCount, pendingCount, totalCount: _totalCount, totalTokens, elapsed, modelSelection }) => {
    const { colors } = useTheme();

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={colors.mauve} bold>{'◆ openweft'}</Text>
        {phase !== null && (
          <Text>
            <Text color={colors.muted}>{'│ '}</Text>
            <Text color={colors.blue}>{`⚙ ${phase.label ?? `${phase.current}/${phase.total}`}`}</Text>
          </Text>
        )}
        {modelSelection !== null && modelSelection !== undefined && (
          <Text>
            <Text color={colors.muted}>{'│ '}</Text>
            <Text color={colors.green}>{modelSelection.backend}</Text>
            <Text color={colors.muted}>{' · '}</Text>
            <Text color={colors.text}>{modelSelection.model}</Text>
            <Text color={colors.muted}>{' · '}</Text>
            <Text color={colors.peach}>{modelSelection.effort}</Text>
          </Text>
        )}
        {(activeCount > 0 || pendingCount > 0) && (
          <Text>
            <Text color={colors.muted}>{'│ '}</Text>
            <Text color={colors.green}>{`active ${activeCount}`}</Text>
            <Text color={colors.muted}>{' · '}</Text>
            <Text color={colors.teal}>{`pending ${pendingCount}`}</Text>
          </Text>
        )}
        {totalTokens > 0 && (
          <Text>
            <Text color={colors.muted}>{'│ '}</Text>
            <Text color={colors.peach}>{`${totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : String(totalTokens)} tokens`}</Text>
          </Text>
        )}
        <Text>
          <Text color={colors.muted}>{'│ '}</Text>
          <Text>{formatTime(elapsed)}</Text>
        </Text>
      </Box>
    );
  }
);

StatusBar.displayName = 'StatusBar';
