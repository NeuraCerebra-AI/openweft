import { describe, expect, it } from 'vitest';

import {
  COLLAPSE_CHAR_THRESHOLD,
  LINE_THRESHOLD,
  countNewlines,
  deleteTokenBefore,
  formatPasteToken,
  resolveTokens,
  shouldCollapse,
} from '../../../src/ui/onboarding/paste.js';

describe('constants', () => {
  it('has correct thresholds', () => {
    expect(COLLAPSE_CHAR_THRESHOLD).toBe(800);
    expect(LINE_THRESHOLD).toBe(2);
  });
});

describe('countNewlines', () => {
  it('returns 0 for single line', () => {
    expect(countNewlines('hello')).toBe(0);
  });

  it('counts newlines correctly', () => {
    expect(countNewlines('a\nb\nc')).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(countNewlines('')).toBe(0);
  });
});

describe('formatPasteToken', () => {
  it('formats single-line paste', () => {
    expect(formatPasteToken(1, 0)).toBe('[Pasted text #1]');
  });

  it('formats multi-line paste as a single token without line-count suffix', () => {
    expect(formatPasteToken(2, 15)).toBe('[Pasted text #2]');
  });

  it('formats 1-line paste as a single token without line-count suffix', () => {
    expect(formatPasteToken(3, 1)).toBe('[Pasted text #3]');
  });
});

describe('shouldCollapse', () => {
  it('returns false for short single-line text', () => {
    expect(shouldCollapse('hello')).toBe(false);
  });

  it('returns true when chars exceed threshold', () => {
    expect(shouldCollapse('a'.repeat(801))).toBe(true);
  });

  it('returns false at exactly char threshold', () => {
    expect(shouldCollapse('a'.repeat(800))).toBe(false);
  });

  it('returns true when lines exceed threshold', () => {
    expect(shouldCollapse('a\nb\nc\nd')).toBe(true); // 3 newlines > 2
  });

  it('returns false at exactly line threshold', () => {
    expect(shouldCollapse('a\nb\nc')).toBe(false); // 2 newlines = 2, not >
  });
});

describe('resolveTokens', () => {
  it('resolves single token', () => {
    const map = new Map([[1, 'actual content']]);
    expect(resolveTokens('[Pasted text #1]', map)).toBe('actual content');
  });

  it('resolves multi-line token', () => {
    const map = new Map([[1, 'line1\nline2']]);
    expect(resolveTokens('[Pasted text #1 +1 lines]', map)).toBe('line1\nline2');
  });

  it('preserves surrounding text', () => {
    const map = new Map([[1, 'spec']]);
    expect(resolveTokens('Add [Pasted text #1] please', map)).toBe('Add spec please');
  });

  it('leaves unresolved tokens as-is', () => {
    expect(resolveTokens('[Pasted text #99]', new Map())).toBe('[Pasted text #99]');
  });

  it('resolves multiple tokens', () => {
    const map = new Map([[1, 'A'], [2, 'B']]);
    expect(resolveTokens('[Pasted text #1] and [Pasted text #2]', map)).toBe('A and B');
  });

  it('returns plain text unchanged', () => {
    expect(resolveTokens('no tokens here', new Map())).toBe('no tokens here');
  });
});

describe('deleteTokenBefore', () => {
  it('returns null when no token at end', () => {
    expect(deleteTokenBefore('hello')).toBeNull();
  });

  it('deletes single-line token at end', () => {
    expect(deleteTokenBefore('prefix [Pasted text #1]')).toEqual({
      newValue: 'prefix ',
      deletedId: 1,
    });
  });

  it('deletes multi-line token at end', () => {
    expect(deleteTokenBefore('[Pasted text #3 +15 lines]')).toEqual({
      newValue: '',
      deletedId: 3,
    });
  });

  it('returns null when token is not at end', () => {
    expect(deleteTokenBefore('[Pasted text #1] suffix')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(deleteTokenBefore('')).toBeNull();
  });
});
