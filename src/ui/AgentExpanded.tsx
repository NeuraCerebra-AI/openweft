import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import { formatTime } from './utils.js';

interface AgentExpandedProps {
  readonly name: string;
  readonly feature: string;
  readonly currentTool: string | null;
  readonly cost: number;
  readonly elapsed: number;
}

export const AgentExpanded: React.FC<AgentExpandedProps> = React.memo(({ name, feature, currentTool, cost, elapsed }) => {
  const { colors, borders } = useTheme();

  return (
    <Box flexDirection="column" borderStyle={borders.panelActive} borderColor={colors.blue} paddingX={1}>
      <Text bold color={colors.text}>{name}</Text>
      <Text color={colors.subtext}>{feature}</Text>
      {currentTool !== null && <Text color={colors.mauve}>{currentTool}</Text>}
      <Text color={colors.muted}>{`$${cost.toFixed(2)} · ${formatTime(elapsed)}`}</Text>
    </Box>
  );
});

AgentExpanded.displayName = 'AgentExpanded';
