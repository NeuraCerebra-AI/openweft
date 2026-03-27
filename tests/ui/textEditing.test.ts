import { describe, expect, it } from 'vitest';

import {
  deleteBackward,
  deleteBackwardWord,
  insertAtCursor,
  moveCursorLeft,
  moveCursorRight,
} from '../../src/ui/textEditing.js';

describe('textEditing', () => {
  it('moves the cursor left and right within bounds', () => {
    expect(moveCursorLeft({ value: 'hello', cursorOffset: 5 })).toEqual({
      value: 'hello',
      cursorOffset: 4,
    });
    expect(moveCursorLeft({ value: 'hello', cursorOffset: 0 })).toEqual({
      value: 'hello',
      cursorOffset: 0,
    });
    expect(moveCursorRight({ value: 'hello', cursorOffset: 4 })).toEqual({
      value: 'hello',
      cursorOffset: 5,
    });
    expect(moveCursorRight({ value: 'hello', cursorOffset: 5 })).toEqual({
      value: 'hello',
      cursorOffset: 5,
    });
  });

  it('inserts text at the cursor instead of always appending', () => {
    expect(insertAtCursor({ value: 'helo', cursorOffset: 2 }, 'l')).toEqual({
      value: 'hello',
      cursorOffset: 3,
    });
  });

  it('deletes backward relative to the cursor', () => {
    expect(deleteBackward({ value: 'hello', cursorOffset: 3 })).toEqual({
      value: 'helo',
      cursorOffset: 2,
    });
  });

  it('deletes the previous word and trailing spaces before the cursor', () => {
    expect(deleteBackwardWord({ value: 'hello world', cursorOffset: 11 })).toEqual({
      value: 'hello ',
      cursorOffset: 6,
    });

    expect(deleteBackwardWord({ value: 'hello world   ', cursorOffset: 14 })).toEqual({
      value: 'hello ',
      cursorOffset: 6,
    });
  });

  it('treats atomic ranges as indivisible cursor/deletion units', () => {
    const ranges = [{ start: 7, end: 23 }];

    expect(moveCursorLeft({ value: 'prefix [Pasted text #1]', cursorOffset: 23 }, ranges)).toEqual({
      value: 'prefix [Pasted text #1]',
      cursorOffset: 7,
    });

    expect(deleteBackward({ value: 'prefix [Pasted text #1]', cursorOffset: 23 }, ranges)).toEqual({
      value: 'prefix ',
      cursorOffset: 7,
    });
  });
});
