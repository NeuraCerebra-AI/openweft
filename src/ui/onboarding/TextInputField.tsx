import React, { useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../theme.js';
import {
  MAX_PASTE_CHARS,
  countNewlines,
  formatPasteToken,
  getPasteTokenRanges,
  resolveTokens,
  shouldCollapse,
} from './paste.js';
import {
  deleteBackward,
  deleteBackwardWord,
  insertAtCursor,
  moveCursorLeft,
  moveCursorRight,
} from '../textEditing.js';

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
  const [cursorOffset, setCursorOffset] = React.useState(value.length);

  // Clear paste state when value is reset externally
  useEffect(() => {
    if (value === '') {
      pastedContents.current.clear();
      nextPasteId.current = 1;
    }
    setCursorOffset((previous) => Math.min(previous, value.length));
  }, [value]);

  useInput((input, key) => {
    const atomicRanges = getPasteTokenRanges(value);

    if (key.escape) {
      if (value.length > 0) {
        onChange('');
        setCursorOffset(0);
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

    if (key.leftArrow) {
      setCursorOffset((previous) => moveCursorLeft({ value, cursorOffset: previous }, atomicRanges).cursorOffset);
      return;
    }

    if (key.rightArrow) {
      setCursorOffset((previous) => moveCursorRight({ value, cursorOffset: previous }, atomicRanges).cursorOffset);
      return;
    }

    if (key.backspace || key.delete) {
      const nextState = key.meta
        ? deleteBackwardWord({ value, cursorOffset }, atomicRanges)
        : deleteBackward({ value, cursorOffset }, atomicRanges);
      for (const range of atomicRanges) {
        if (range.start >= nextState.cursorOffset && range.end <= cursorOffset) {
          pastedContents.current.delete(range.id);
        }
      }
      onChange(nextState.value);
      setCursorOffset(nextState.cursorOffset);
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
        const nextState = insertAtCursor({ value, cursorOffset }, token, atomicRanges);
        onChange(nextState.value);
        setCursorOffset(nextState.cursorOffset);
      } else {
        const nextState = insertAtCursor({ value, cursorOffset }, truncated, atomicRanges);
        onChange(nextState.value);
        setCursorOffset(nextState.cursorOffset);
      }
      return;
    }

    // Append regular character
    if (input) {
      const nextState = insertAtCursor({ value, cursorOffset }, input, atomicRanges);
      onChange(nextState.value);
      setCursorOffset(nextState.cursorOffset);
    }
  });

  const showPlaceholder = value.length === 0 && placeholder !== undefined;
  const beforeCursor = value.slice(0, cursorOffset);
  const afterCursor = value.slice(cursorOffset);

  return (
    <Box borderStyle="round" borderColor={theme.colors.surface2}>
      <Text color={theme.colors.green}>{'› '}</Text>
      {showPlaceholder ? (
        <Text color={theme.colors.muted}>{placeholder}</Text>
      ) : (
        <Text color={theme.colors.text}>{beforeCursor}</Text>
      )}
      <Text color={theme.colors.text}>{'█'}</Text>
      {!showPlaceholder ? (
        <Text color={theme.colors.text}>{afterCursor}</Text>
      ) : null}
    </Box>
  );
};

TextInputField.displayName = 'TextInputField';
