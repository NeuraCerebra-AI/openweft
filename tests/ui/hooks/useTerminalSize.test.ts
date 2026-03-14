import { describe, it, expect } from 'vitest';
import type { TerminalSize } from '../../../src/ui/hooks/useTerminalSize.js';

describe('TerminalSize type', () => {
  it('has columns and rows', () => {
    const size: TerminalSize = { columns: 120, rows: 40 };
    expect(size.columns).toBe(120);
    expect(size.rows).toBe(40);
  });
});
