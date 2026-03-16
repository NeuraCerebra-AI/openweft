/** Char threshold: paste collapses into token if content exceeds this. */
export const COLLAPSE_CHAR_THRESHOLD = 800;

/** Line threshold: paste collapses if newline count exceeds this. */
export const LINE_THRESHOLD = 2;

/** Maximum characters accepted per paste. Excess is silently truncated. */
export const MAX_PASTE_CHARS = 10_000;

/** Regex matching paste tokens in display text. Captures: (1) paste ID. */
const PASTE_TOKEN_RE = /\[Pasted text #(\d+)(?:\s\+\d+ lines)?\]/g;

/** Regex matching a paste token at the very end of a string. Captures: (1) paste ID. */
const PASTE_TOKEN_TAIL_RE = /\[Pasted text #(\d+)(?:\s\+\d+ lines)?\]$/;

export function countNewlines(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === '\n') count++;
  }
  return count;
}

export function formatPasteToken(id: number, lineCount: number): string {
  if (lineCount === 0) return `[Pasted text #${id}]`;
  return `[Pasted text #${id} +${lineCount} lines]`;
}

export function shouldCollapse(text: string): boolean {
  return text.length > COLLAPSE_CHAR_THRESHOLD || countNewlines(text) > LINE_THRESHOLD;
}

/**
 * Replace paste tokens in displayValue with actual content from the map.
 * Unresolved tokens (no matching ID) are left as-is.
 */
export function resolveTokens(
  displayValue: string,
  contents: ReadonlyMap<number, string>,
): string {
  return displayValue.replace(PASTE_TOKEN_RE, (match, idStr: string) => {
    const id = parseInt(idStr, 10);
    return contents.get(id) ?? match;
  });
}

/**
 * If the value ends with a paste token, return the value with the token
 * removed and the paste ID that was deleted. Returns null if no token at end.
 */
export function deleteTokenBefore(
  value: string,
): { newValue: string; deletedId: number } | null {
  const match = value.match(PASTE_TOKEN_TAIL_RE);
  if (match === null || match.index === undefined) return null;
  const id = parseInt(match[1]!, 10);
  return { newValue: value.slice(0, match.index), deletedId: id };
}
