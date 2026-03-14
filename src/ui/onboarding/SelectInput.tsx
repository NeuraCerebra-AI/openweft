import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../theme.js';

export interface SelectOption<T extends string = string> {
  readonly label: string;
  readonly value: T;
  readonly hint?: string;
}

interface SelectInputProps<T extends string = string> {
  readonly options: readonly SelectOption<T>[];
  readonly onSelect: (value: T) => void;
}

export const SelectInput = <T extends string = string>({
  options,
  onSelect,
}: SelectInputProps<T>): React.ReactElement => {
  const theme = useTheme();
  const [focusedIndex, setFocusedIndex] = useState(0);
  // Use a ref so the Enter handler always reads the latest index
  // without needing to be re-subscribed after every state update.
  const focusedIndexRef = useRef(focusedIndex);
  focusedIndexRef.current = focusedIndex;

  useInput((_input, key) => {
    if (key.upArrow) {
      setFocusedIndex((prev) => (prev <= 0 ? options.length - 1 : prev - 1));
    }
    if (key.downArrow) {
      setFocusedIndex((prev) => (prev >= options.length - 1 ? 0 : prev + 1));
    }
    if (key.return) {
      const current = focusedIndexRef.current;
      const selected = options[current];
      if (selected !== undefined) {
        onSelect(selected.value);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {options.map((option, index) => {
        const isActive = index === focusedIndex;

        return (
          <Box key={option.value} flexDirection="row" gap={1}>
            <Text color={theme.colors.green}>{isActive ? '›' : ' '}</Text>
            <Text color={isActive ? theme.colors.text : theme.colors.subtext}>
              {option.label}
            </Text>
            {option.hint !== undefined && (
              <Text color={theme.colors.muted}>{`(${option.hint})`}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

SelectInput.displayName = 'SelectInput';
