import React from 'react';
import { Box } from 'ink';

interface StyledCardProps {
  readonly borderColor: string;
  readonly children: React.ReactNode;
}

export const StyledCard: React.FC<StyledCardProps> = ({ borderColor, children }) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
      {children}
    </Box>
  );
};
