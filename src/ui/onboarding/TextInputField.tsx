import React, { useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../theme.js';
import {
  MAX_PASTE_CHARS,
  countNewlines,
  deleteTokenBefore,
  formatPasteToken,
  resolveTokens,
  shouldCollapse,
} from './paste.js';

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
  const pastedContents = useRef<Map<number, string>>(new Map());
  const nextPasteId = useRef(1);

  // Clear paste state when value is reset externally
  useEffect(() => {
    if (value === '') {
      pastedContents.current.clear();
      nextPasteId.current = 1;
    }
  }, [value]);

  useInput((input, key) => {
    if (key.escape) {
      if (value.length > 0) {
        onChange('');
      } else {
        onExit();
      }
      return;
    }

    if (key.return) {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        const resolved = resolveTokens(trimmed, pastedContents.current);
        onSubmit(resolved);
      }
      return;
    }

    if (key.backspace || key.delete) {
      const tokenDel = deleteTokenBefore(value);
      if (tokenDel !== null) {
        pastedContents.current.delete(tokenDel.deletedId);
        onChange(tokenDel.newValue);
      } else {
        onChange(value.slice(0, -1));
      }
      return;
    }

    // Don't capture control sequences
    if (key.ctrl || key.meta) return;

    // Paste detection: multiple characters arrive at once
    if (input && input.length > 1) {
      const text = input.replaceAll('\t', '    ');
      const truncated = text.slice(0, MAX_PASTE_CHARS);

      if (shouldCollapse(truncated)) {
        const id = nextPasteId.current++;
        const lineCount = countNewlines(truncated);
        const token = formatPasteToken(id, lineCount);
        pastedContents.current.set(id, truncated);
        onChange(value + token);
      } else {
        onChange(value + truncated);
      }
      return;
    }

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
