import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import { formatTime, getStatusIcon } from './utils.js';
import type { AgentStatus } from './store.js';

interface AgentRowProps {
  readonly name: string;
  readonly status: AgentStatus;
  readonly elapsed: number;
  readonly focused: boolean;
}

export const AgentRow: React.FC<AgentRowProps> = React.memo(({ name, status, elapsed, focused }) => {
  const { colors } = useTheme();
  const { icon, colorKey } = getStatusIcon(status);

  return (
    <Box>
      <Text color={focused ? colors.blue : colors.text}>{focused ? '> ' : '  '}</Text>
      <Text color={colors[colorKey]}>{icon} </Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text bold={focused} wrap="truncate">{name}</Text>
      </Box>
      <Text color={colors.muted}>{` ${formatTime(elapsed)}`}</Text>
    </Box>
  );
});

AgentRow.displayName = 'AgentRow';
