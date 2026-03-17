export interface AtomicRange {
  readonly start: number;
  readonly end: number;
}

export interface TextEditingState {
  readonly value: string;
  readonly cursorOffset: number;
}

const clampCursorOffset = (value: string, cursorOffset: number): number =>
  Math.max(0, Math.min(cursorOffset, value.length));

const findInteriorRange = (
  cursorOffset: number,
  atomicRanges: readonly AtomicRange[],
): AtomicRange | null =>
  atomicRanges.find((range) => cursorOffset > range.start && cursorOffset < range.end) ?? null;

const normalizeCursor = (
  state: TextEditingState,
  atomicRanges: readonly AtomicRange[] = [],
  prefer: 'left' | 'right' = 'right',
): TextEditingState => {
  const cursorOffset = clampCursorOffset(state.value, state.cursorOffset);
  const range = findInteriorRange(cursorOffset, atomicRanges);

  if (range === null) {
    return { value: state.value, cursorOffset };
  }

  return {
    value: state.value,
    cursorOffset: prefer === 'left' ? range.start : range.end,
  };
};

const deleteRange = (state: TextEditingState, start: number, end: number): TextEditingState => ({
  value: state.value.slice(0, start) + state.value.slice(end),
  cursorOffset: start,
});

export const moveCursorLeft = (
  state: TextEditingState,
  atomicRanges: readonly AtomicRange[] = [],
): TextEditingState => {
  const normalized = normalizeCursor(state, atomicRanges, 'left');
  if (normalized.cursorOffset === 0) {
    return normalized;
  }

  const nextOffset = normalized.cursorOffset - 1;
  const blockedRange = findInteriorRange(nextOffset, atomicRanges);
  return {
    value: normalized.value,
    cursorOffset: blockedRange?.start ?? nextOffset,
  };
};

export const moveCursorRight = (
  state: TextEditingState,
  atomicRanges: readonly AtomicRange[] = [],
): TextEditingState => {
  const normalized = normalizeCursor(state, atomicRanges, 'right');
  if (normalized.cursorOffset >= normalized.value.length) {
    return normalized;
  }

  const nextOffset = normalized.cursorOffset + 1;
  const blockedRange = findInteriorRange(nextOffset, atomicRanges);
  return {
    value: normalized.value,
    cursorOffset: blockedRange?.end ?? nextOffset,
  };
};

export const insertAtCursor = (
  state: TextEditingState,
  text: string,
  atomicRanges: readonly AtomicRange[] = [],
): TextEditingState => {
  const normalized = normalizeCursor(state, atomicRanges, 'right');
  const { value, cursorOffset } = normalized;
  return {
    value: value.slice(0, cursorOffset) + text + value.slice(cursorOffset),
    cursorOffset: cursorOffset + text.length,
  };
};

export const deleteBackward = (
  state: TextEditingState,
  atomicRanges: readonly AtomicRange[] = [],
): TextEditingState => {
  const normalized = normalizeCursor(state, atomicRanges, 'left');
  if (normalized.cursorOffset === 0) {
    return normalized;
  }

  const tokenRange = atomicRanges.find((range) => range.end === normalized.cursorOffset);
  if (tokenRange !== undefined) {
    return deleteRange(normalized, tokenRange.start, tokenRange.end);
  }

  return deleteRange(normalized, normalized.cursorOffset - 1, normalized.cursorOffset);
};

export const deleteForward = (
  state: TextEditingState,
  atomicRanges: readonly AtomicRange[] = [],
): TextEditingState => {
  const normalized = normalizeCursor(state, atomicRanges, 'right');
  if (normalized.cursorOffset >= normalized.value.length) {
    return normalized;
  }

  const tokenRange = atomicRanges.find((range) => range.start === normalized.cursorOffset);
  if (tokenRange !== undefined) {
    return deleteRange(normalized, tokenRange.start, tokenRange.end);
  }

  return deleteRange(normalized, normalized.cursorOffset, normalized.cursorOffset + 1);
};

export const deleteBackwardWord = (
  state: TextEditingState,
  atomicRanges: readonly AtomicRange[] = [],
): TextEditingState => {
  const normalized = normalizeCursor(state, atomicRanges, 'left');
  if (normalized.cursorOffset === 0) {
    return normalized;
  }

  const tokenRange = atomicRanges.find((range) => range.end === normalized.cursorOffset);
  if (tokenRange !== undefined) {
    return deleteRange(normalized, tokenRange.start, tokenRange.end);
  }

  let start = normalized.cursorOffset;
  while (start > 0 && /\s/.test(normalized.value[start - 1] ?? '')) {
    start -= 1;
  }
  while (start > 0 && !/\s/.test(normalized.value[start - 1] ?? '')) {
    start -= 1;
  }

  return deleteRange(normalized, start, normalized.cursorOffset);
};
