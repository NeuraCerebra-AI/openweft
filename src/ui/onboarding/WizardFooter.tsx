import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../theme.js';

export type FooterKey = 'select' | 'confirm' | 'submit' | 'continue' | 'back' | 'quit';

export interface WizardFooterProps {
  readonly keys: readonly FooterKey[];
}

const KEY_DISPLAY: Record<FooterKey, string> = {
  select: '↑↓ select',
  confirm: 'Enter confirm',
  submit: 'Enter submit',
  continue: 'Enter continue',
  back: '← back',
  quit: 'Esc quit',
};

const SEPARATOR = ' · ';

export const WizardFooter: React.FC<WizardFooterProps> = ({ keys }) => {
  const { colors } = useTheme();

  return (
    <Box flexDirection="row">
      {keys.map((key, index) => (
        <Text key={key} color={colors.subtext} dimColor>
          {index > 0 ? SEPARATOR : ''}
          {KEY_DISPLAY[key]}
        </Text>
      ))}
    </Box>
  );
};

WizardFooter.displayName = 'WizardFooter';
