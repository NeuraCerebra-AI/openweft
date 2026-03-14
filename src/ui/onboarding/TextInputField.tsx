import React from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../theme.js';

interface TextInputFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly onExit: () => void;
  readonly placeholder?: string;
}

export const TextInputField: React.FC<TextInputFieldProps> = ({
  value,
  onChange,
  onSubmit,
  onExit,
  placeholder,
}) => {
  const theme = useTheme();

  useInput((input, key) => {
    if (key.escape) {
      if (value.length > 0) {
        onChange(''); // clear
      } else {
        onExit(); // quit
      }
      return;
    }

    if (key.return) {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        onSubmit(trimmed);
      }
      return;
    }

    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }

    // Don't capture control sequences
    if (key.ctrl || key.meta) return;

    // Append regular character
    if (input) {
      onChange(value + input);
    }
  });

  const showPlaceholder = value.length === 0 && placeholder !== undefined;

  return (
    <Box borderStyle="round" borderColor={theme.colors.surface2}>
      <Text color={theme.colors.green}>{'› '}</Text>
      {showPlaceholder ? (
        <Text color={theme.colors.muted}>{placeholder}</Text>
      ) : (
        <Text color={theme.colors.text}>{value}</Text>
      )}
      <Text color={theme.colors.text}>{'█'}</Text>
    </Box>
  );
};

TextInputField.displayName = 'TextInputField';
