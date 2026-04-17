import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from './theme.js';
import {
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
  type TextEditingState,
} from './textEditing.js';

const PASTE_FLUSH_DELAY_MS = 25;

interface TextInputFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly onExit: () => void;
  readonly placeholder?: string;
  readonly cursorOffset?: number;
  readonly onCursorOffsetChange?: (offset: number) => void;
  readonly prompt?: string;
  readonly borderColor?: string;
}

export const TextInputField: React.FC<TextInputFieldProps> = ({
  value,
  onChange,
  onSubmit,
  onExit,
  placeholder,
  cursorOffset: controlledCursorOffset,
  onCursorOffsetChange,
  prompt = '› ',
  borderColor,
}) => {
  const theme = useTheme();
  const pastedContents = useRef<Map<number, string>>(new Map());
  const nextPasteId = useRef(1);
  const valueRef = useRef(value);
  const pendingPasteRef = useRef('');
  const pasteFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uncontrolledCursorOffset, setUncontrolledCursorOffset] = React.useState(value.length);
  const cursorOffset = controlledCursorOffset ?? uncontrolledCursorOffset;
  const cursorOffsetRef = useRef(cursorOffset);

  const setCursorOffset = useCallback((offset: number) => {
    const clamped = Math.max(0, Math.min(offset, valueRef.current.length));
    if (cursorOffsetRef.current === clamped) {
      return;
    }
    cursorOffsetRef.current = clamped;
    if (controlledCursorOffset === undefined) {
      setUncontrolledCursorOffset(clamped);
    }
    onCursorOffsetChange?.(clamped);
  }, [controlledCursorOffset, onCursorOffsetChange]);

  const clearPasteTimer = useCallback(() => {
    if (pasteFlushTimerRef.current !== null) {
      clearTimeout(pasteFlushTimerRef.current);
      pasteFlushTimerRef.current = null;
    }
  }, []);

  const applyState = useCallback((nextState: TextEditingState): TextEditingState => {
    valueRef.current = nextState.value;
    onChange(nextState.value);
    setCursorOffset(nextState.cursorOffset);
    return nextState;
  }, [onChange, setCursorOffset]);

  const insertPastedText = useCallback((text: string): TextEditingState => {
    const normalizedText = text.replaceAll('\t', '    ');
    const currentValue = valueRef.current;
    const currentCursorOffset = cursorOffsetRef.current;
    const atomicRanges = getPasteTokenRanges(currentValue);

    if (shouldCollapse(normalizedText)) {
      const id = nextPasteId.current++;
      const token = formatPasteToken(id, countNewlines(normalizedText));
      pastedContents.current.set(id, normalizedText);
      return insertAtCursor(
        { value: currentValue, cursorOffset: currentCursorOffset },
        token,
        atomicRanges,
      );
    }

    return insertAtCursor(
      { value: currentValue, cursorOffset: currentCursorOffset },
      normalizedText,
      atomicRanges,
    );
  }, []);

  const flushPendingPaste = useCallback((): TextEditingState | null => {
    clearPasteTimer();
    const pending = pendingPasteRef.current;
    if (pending.length === 0) {
      return null;
    }

    pendingPasteRef.current = '';
    return applyState(insertPastedText(pending));
  }, [applyState, clearPasteTimer, insertPastedText]);

  const queuePasteChunk = useCallback((chunk: string) => {
    pendingPasteRef.current += chunk;
    clearPasteTimer();
    pasteFlushTimerRef.current = setTimeout(() => {
      void flushPendingPaste();
    }, PASTE_FLUSH_DELAY_MS);
  }, [clearPasteTimer, flushPendingPaste]);

  // Clear paste state when value is reset externally.
  useEffect(() => {
    valueRef.current = value;
    if (value === '') {
      clearPasteTimer();
      pendingPasteRef.current = '';
      pastedContents.current.clear();
      nextPasteId.current = 1;
    }
    setCursorOffset(Math.min(cursorOffsetRef.current, value.length));
  }, [clearPasteTimer, setCursorOffset, value]);

  useEffect(() => {
    cursorOffsetRef.current = Math.max(0, Math.min(cursorOffset, valueRef.current.length));
  }, [cursorOffset]);

  useEffect(() => () => clearPasteTimer(), [clearPasteTimer]);

  useInput((input, key) => {
    if (input && input.length > 1 && !key.ctrl && !key.meta) {
      queuePasteChunk(input);
      return;
    }

    const flushedState = flushPendingPaste();
    const currentValue = flushedState?.value ?? valueRef.current;
    const currentCursorOffset = flushedState?.cursorOffset ?? cursorOffsetRef.current;
    const atomicRanges = getPasteTokenRanges(currentValue);

    if (key.escape) {
      if (currentValue.length > 0) {
        applyState({ value: '', cursorOffset: 0 });
      } else {
        onExit();
      }
      return;
    }

    if (key.return) {
      const trimmed = currentValue.trim();
      if (trimmed.length > 0) {
        const resolved = resolveTokens(trimmed, pastedContents.current);
        onSubmit(resolved);
      }
      return;
    }

    if (key.leftArrow) {
      applyState(moveCursorLeft({ value: currentValue, cursorOffset: currentCursorOffset }, atomicRanges));
      return;
    }

    if (key.rightArrow) {
      applyState(moveCursorRight({ value: currentValue, cursorOffset: currentCursorOffset }, atomicRanges));
      return;
    }

    if (key.backspace || key.delete) {
      const nextState = key.meta
        ? deleteBackwardWord({ value: currentValue, cursorOffset: currentCursorOffset }, atomicRanges)
        : deleteBackward({ value: currentValue, cursorOffset: currentCursorOffset }, atomicRanges);
      for (const range of atomicRanges) {
        if (range.start >= nextState.cursorOffset && range.end <= currentCursorOffset) {
          pastedContents.current.delete(range.id);
        }
      }
      applyState(nextState);
      return;
    }

    // Don't capture control sequences.
    if (key.ctrl || key.meta) return;

    if (input) {
      applyState(insertAtCursor(
        { value: currentValue, cursorOffset: currentCursorOffset },
        input,
        atomicRanges,
      ));
    }
  });

  const showPlaceholder = value.length === 0 && placeholder !== undefined;
  const safeCursorOffset = Math.max(0, Math.min(cursorOffset, value.length));
  const beforeCursor = value.slice(0, safeCursorOffset);
  const afterCursor = value.slice(safeCursorOffset);

  return (
    <Box borderStyle="round" borderColor={borderColor ?? theme.colors.surface2}>
      <Text color={theme.colors.green}>{prompt}</Text>
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
