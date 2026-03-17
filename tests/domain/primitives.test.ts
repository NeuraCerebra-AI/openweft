import { describe, expect, it } from 'vitest';

import { RelativeFilePathSchema } from '../../src/domain/primitives.js';

describe('RelativeFilePathSchema', () => {
  it('accepts relative paths with internal spaces', () => {
    expect(RelativeFilePathSchema.parse('docs/Release Notes.md')).toBe('docs/Release Notes.md');
  });

  it('rejects relative paths with leading spaces', () => {
    expect(() => RelativeFilePathSchema.parse(' docs/Release Notes.md')).toThrow(
      'Must be a valid relative file path'
    );
  });
});
