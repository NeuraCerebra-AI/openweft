import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../theme.js';

interface ProgressBarProps {
  readonly steps: number;
  readonly current: number; // 1-based (step 1 = first dot active)
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ steps, current }) => {
  const theme = useTheme();

  const dots = Array.from({ length: steps }, (_, i) => {
    const position = i + 1; // 1-based

    if (position < current) {
      // Completed
      return (
        <Text key={position} color={theme.colors.green}>
          {'●'}
        </Text>
      );
    } else if (position === current) {
      // Active
      return (
        <Text key={position} color={theme.colors.blue}>
          {'●'}
        </Text>
      );
    } else {
      // Pending
      return (
        <Text key={position} color={theme.colors.muted}>
          {'○'}
        </Text>
      );
    }
  });

  return (
    <Box flexDirection="row" gap={1}>
      {dots}
      <Text color={theme.colors.subtext}>{` ${current} / ${steps}`}</Text>
    </Box>
  );
};

ProgressBar.displayName = 'ProgressBar';
