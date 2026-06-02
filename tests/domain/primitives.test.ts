import { describe, expect, it } from 'vitest';

import { RelativeFilePathSchema } from '../../src/domain/primitives.js';

describe('RelativeFilePathSchema', () => {
  it('accepts relative paths with internal spaces', () => {
    expect(RelativeFilePathSchema.parse('docs/Release Notes.md')).toBe('docs/Release Notes.md');
  });

  it.each([
    'src/auth/login.ts',
    './src/auth/login.ts',
    'packages/@scope/app/src/index.ts',
    'docs/Release Notes.md',
    'src/App.Component.tsx',
    'src/routes/[id]/page.tsx',
    '.github/workflows/release.yml'
  ])('accepts normal repository path %s', (filePath) => {
    expect(RelativeFilePathSchema.parse(filePath)).toBe(filePath);
  });

  it.each([
    '../secrets.txt',
    'src/../secrets.txt',
    '/tmp/secrets.txt',
    'C:\\Users\\warren\\secrets.txt',
    'C:secrets.txt',
    'C:Users\\warren\\secrets.txt',
    'src//file.ts',
    'src/\nfile.ts',
    ''
  ])('rejects unsafe repository path %s', (filePath) => {
    expect(() => RelativeFilePathSchema.parse(filePath)).toThrow(
      'Must be a safe repository-relative file path'
    );
  });

  it('rejects relative paths with leading spaces', () => {
    expect(() => RelativeFilePathSchema.parse(' docs/Release Notes.md')).toThrow(
      'Must be a safe repository-relative file path'
    );
  });
});
