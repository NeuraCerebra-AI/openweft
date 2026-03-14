import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';

interface ApprovalPromptProps {
  readonly file: string;
  readonly action: string;
  readonly detail: string;
}

export const ApprovalPrompt: React.FC<ApprovalPromptProps> = React.memo(({ file, action, detail }) => {
  const { colors, borders } = useTheme();

  return (
    <Box flexDirection="column" borderStyle={borders.prompt} borderColor={colors.yellow} paddingX={1} marginY={0}>
      <Text color={colors.yellow} bold>{'⚠ Approval Required'}</Text>
      <Text color={colors.peach}>{`${action}: ${file}`}</Text>
      <Text color={colors.subtext}>{detail}</Text>
      <Text color={colors.muted}>{'[y] approve  [n] deny  [a] always  [s] skip'}</Text>
    </Box>
  );
});

ApprovalPrompt.displayName = 'ApprovalPrompt';
