import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import type { CompletedFeature } from './store.js';

interface HistoryViewProps {
  readonly features: readonly CompletedFeature[];
  readonly focusedIndex: number;
}

export const HistoryView: React.FC<HistoryViewProps> = React.memo(({ features, focusedIndex }) => {
  const { colors, borders } = useTheme();

  if (features.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} padding={1}>
        <Text color={colors.muted}>{'No completed features yet.'}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1}>
        <Text bold color={colors.subtext}>{'Completed Features'}</Text>
      </Box>
      {features.map((feature, index) => {
        const focused = index === focusedIndex;
        return (
          <Box
            key={feature.id}
            paddingX={1}
            borderStyle={focused ? borders.panelActive : undefined}
            borderColor={focused ? colors.green : undefined}
            borderLeft={focused}
            borderRight={false}
            borderTop={false}
            borderBottom={false}
          >
            <Text color={colors.green}>{'✓ '}</Text>
            <Text bold={focused}>
              {feature.request.length > 70 ? feature.request.slice(0, 67) + '...' : feature.request}
            </Text>
            {feature.mergeCommit ? (
              <Text color={colors.muted}>{`  ${feature.mergeCommit.slice(0, 7)}`}</Text>
            ) : (
              <Text color={colors.muted}>{'  —'}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
});

HistoryView.displayName = 'HistoryView';
