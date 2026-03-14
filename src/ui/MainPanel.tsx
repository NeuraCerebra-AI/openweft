import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';
import { OutputLine } from './OutputLine.js';
import type { OutputLine as OutputLineType } from './store.js';

interface MainPanelProps {
  readonly agentName: string | null;
  readonly lines: OutputLineType[];
  readonly scrollOffset: number;
  readonly viewportHeight: number;
}

export const MainPanel: React.FC<MainPanelProps> = ({ agentName, lines, scrollOffset, viewportHeight }) => {
  const { colors, borders } = useTheme();
  const visibleLines = lines.slice(scrollOffset, scrollOffset + viewportHeight);

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle={borders.panel} borderColor={colors.surface1}>
      {agentName !== null && (
        <Text color={colors.blue} bold>{`◆ ${agentName}`}</Text>
      )}
      {visibleLines.length === 0 && (
        <Text color={colors.muted}>{'Waiting for output...'}</Text>
      )}
      {visibleLines.map((line, i) => (
        <OutputLine key={`${scrollOffset + i}`} line={line} />
      ))}
    </Box>
  );
};
