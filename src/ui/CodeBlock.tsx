import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from './theme.js';

interface CodeBlockProps {
  readonly filename: string;
  readonly content: string;
  readonly language: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = React.memo(({ filename, content, language }) => {
  const { colors, borders } = useTheme();

  return (
    <Box flexDirection="column" borderStyle={borders.panel} borderColor={colors.surface2} marginY={0}>
      <Box paddingX={1}>
        <Text color={colors.muted} dimColor>{`${filename} (${language})`}</Text>
      </Box>
      <Box paddingX={1}>
        <Text color={colors.text}>{content}</Text>
      </Box>
    </Box>
  );
});

CodeBlock.displayName = 'CodeBlock';
