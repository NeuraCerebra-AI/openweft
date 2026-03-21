import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import type { CompletedFeature } from './store.js';

interface HistoryDetailViewProps {
  readonly feature: CompletedFeature;
}

export const HistoryDetailView: React.FC<HistoryDetailViewProps> = React.memo(({ feature }) => {
  const { colors, borders } = useTheme();

  return (
    <Box flexDirection="column" flexGrow={1} padding={1}>
      <Box borderStyle={borders.panelActive} borderColor={colors.green} flexDirection="column" paddingX={1}>
        <Text bold color={colors.green}>{'✓ Completed'}</Text>
        <Text>{''}</Text>
        <Box gap={1}>
          <Text bold>{'ID'}</Text>
          <Text color={colors.subtext}>{feature.id}</Text>
        </Box>
        {feature.mergeCommit ? (
          <Box gap={1}>
            <Text bold>{'Commit'}</Text>
            <Text color={colors.subtext}>{feature.mergeCommit}</Text>
          </Box>
        ) : (
          <Box gap={1}>
            <Text bold>{'Commit'}</Text>
            <Text color={colors.muted}>{'unavailable (recovered from prior session)'}</Text>
          </Box>
        )}
        <Text>{''}</Text>
        <Text bold>{'Request'}</Text>
        <Text wrap="wrap">{feature.request}</Text>
      </Box>
    </Box>
  );
});

HistoryDetailView.displayName = 'HistoryDetailView';
