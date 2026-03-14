import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';

interface ToolBlockProps {
  readonly tool: string;
  readonly args: string;
  readonly result?: string;
  readonly success?: boolean;
}

export const ToolBlock: React.FC<ToolBlockProps> = React.memo(({ tool, args, result, success }) => {
  const { colors } = useTheme();

  return (
    <Box flexDirection="row" marginY={0}>
      <Text color={colors.mauve}>{'▎ '}</Text>
      <Text color={colors.mauve} bold>{tool}</Text>
      <Text color={colors.peach}>{` ${args}`}</Text>
      {result !== undefined && (
        <Text color={success === false ? colors.red : colors.green}>{` ${success === false ? '✗' : '✓'} ${result}`}</Text>
      )}
    </Box>
  );
});

ToolBlock.displayName = 'ToolBlock';
