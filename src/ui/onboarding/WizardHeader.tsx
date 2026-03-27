import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../theme.js';

interface WizardHeaderProps {
  readonly subtitle: string;
}

export const WizardHeader: React.FC<WizardHeaderProps> = ({ subtitle }) => {
  const { colors } = useTheme();

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={colors.mauve} bold>
        {'◆ openweft'}
      </Text>
      <Text color={colors.subtext}>{subtitle}</Text>
    </Box>
  );
};

WizardHeader.displayName = 'WizardHeader';
