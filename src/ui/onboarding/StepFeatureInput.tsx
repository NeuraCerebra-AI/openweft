import React, { useState } from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../theme.js';
import { TextInputField } from './TextInputField.js';
import { WizardFooter } from './WizardFooter.js';

export interface StepFeatureInputProps {
  readonly onAdvance: () => void;
  readonly onExit: () => void;
  readonly onQueueRequest: (request: string) => Promise<void>;
}

export const StepFeatureInput: React.FC<StepFeatureInputProps> = ({
  onAdvance,
  onExit,
  onQueueRequest,
}) => {
  const { colors } = useTheme();
  const [value, setValue] = useState('');

  const handleSubmit = (text: string) => {
    void onQueueRequest(text).then(() => {
      onAdvance();
    });
  };

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      {/* Brand header */}
      <Box flexDirection="row" gap={1}>
        <Text color={colors.mauve} bold>
          {'◆ openweft'}
        </Text>
        <Text color={colors.subtext}>{'setup · queue'}</Text>
      </Box>

      {/* Title */}
      <Text color={colors.sky} bold>
        {'What should OpenWeft build?'}
      </Text>

      {/* Description */}
      <Text color={colors.subtext}>
        {'Type a feature request. One line, plain language. You can add more after.'}
      </Text>

      {/* Text input */}
      <TextInputField
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        onExit={onExit}
      />

      {/* Footer */}
      <WizardFooter keys={['submit', 'back', 'quit']} />
    </Box>
  );
};

StepFeatureInput.displayName = 'StepFeatureInput';
