import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../theme.js';

interface CompletedSummaryProps {
  readonly items: readonly string[];
}

export const CompletedSummary: React.FC<CompletedSummaryProps> = ({ items }) => {
  const theme = useTheme();

  if (items.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="row" gap={2}>
      {items.map((item) => (
        <Box key={item} flexDirection="row" gap={1}>
          <Text color={theme.colors.green}>{'✓'}</Text>
          <Text color={theme.colors.subtext}>{item}</Text>
        </Box>
      ))}
    </Box>
  );
};

CompletedSummary.displayName = 'CompletedSummary';
