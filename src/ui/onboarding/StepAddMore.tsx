import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../theme.js';
import { SelectInput } from './SelectInput.js';
import { TextInputField } from './TextInputField.js';
import { WizardFooter } from './WizardFooter.js';

export interface StepAddMoreProps {
  readonly queuedRequests: readonly string[];
  readonly onAdvance: () => void;
  readonly onExit: () => void;
  readonly onQueueRequest: (request: string) => Promise<void>;
}

type Mode = 'select' | 'input';

const ADD_MORE_OPTIONS = [
  { label: 'Continue to launch', value: 'launch' },
  { label: 'Add another request', value: 'add' },
] as const;

type AddMoreOptionValue = (typeof ADD_MORE_OPTIONS)[number]['value'];

function formatId(index: number): string {
  return `#${String(index + 1).padStart(3, '0')}`;
}

export const StepAddMore: React.FC<StepAddMoreProps> = ({
  queuedRequests,
  onAdvance,
  onExit,
  onQueueRequest,
}) => {
  const { colors } = useTheme();
  const [mode, setMode] = useState<Mode>('select');
  const [inputValue, setInputValue] = useState('');

  // Handle Esc in select mode to exit
  useInput((_input, key) => {
    if (mode === 'select' && key.escape) {
      onExit();
    }
  });

  const handleSelect = (value: AddMoreOptionValue) => {
    if (value === 'launch') {
      onAdvance();
    } else {
      setMode('input');
    }
  };

  const handleInputSubmit = (text: string) => {
    void onQueueRequest(text).then(() => {
      setInputValue('');
      setMode('select');
    });
  };

  const handleInputExit = () => {
    onExit();
  };

  const footerKeys =
    mode === 'input'
      ? (['submit', 'quit'] as const)
      : (['select', 'confirm', 'back', 'quit'] as const);

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
        {'Add more?'}
      </Text>

      {/* Queued items list */}
      <Box flexDirection="column">
        {queuedRequests.map((request, index) => (
          <Box key={index} flexDirection="row" gap={1}>
            <Text color={colors.muted}>{formatId(index)}</Text>
            <Text color={colors.text}>{request}</Text>
          </Box>
        ))}
      </Box>

      {/* Count line */}
      <Text color={colors.subtext}>
        {`${String(queuedRequests.length)} requests queued. Add another or continue to launch.`}
      </Text>

      {/* Select or input mode */}
      {mode === 'select' ? (
        <SelectInput<AddMoreOptionValue>
          options={ADD_MORE_OPTIONS}
          onSelect={handleSelect}
        />
      ) : (
        <TextInputField
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleInputSubmit}
          onExit={handleInputExit}
        />
      )}

      {/* Footer */}
      <WizardFooter keys={footerKeys} />
    </Box>
  );
};

StepAddMore.displayName = 'StepAddMore';
