import path from 'node:path';

import { z } from 'zod';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const LEADING_DOT_SEGMENTS_PATTERN = /^(\.\/)+/;
const WINDOWS_DRIVE_PREFIX_PATTERN = /^[A-Za-z]:/;

export const isSafeRelativePath = (value: string): boolean => {
  if (value.length === 0 || value.trim() !== value || CONTROL_CHARACTER_PATTERN.test(value)) {
    return false;
  }

  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || WINDOWS_DRIVE_PREFIX_PATTERN.test(value)) {
    return false;
  }

  const normalizedSeparators = value.replace(/\\/g, '/');
  const withoutLeadingDotSegments = normalizedSeparators.replace(LEADING_DOT_SEGMENTS_PATTERN, '');
  if (
    withoutLeadingDotSegments.length === 0 ||
    withoutLeadingDotSegments.startsWith('/') ||
    withoutLeadingDotSegments.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    return false;
  }

  const normalized = path.posix.normalize(withoutLeadingDotSegments);
  return normalized !== '.' && normalized !== '..' && !normalized.startsWith('../');
};

export const RelativeFilePathSchema = z
  .string()
  .refine(isSafeRelativePath, 'Must be a safe repository-relative file path');

export const normalizeRelativePath = (value: string, caseSensitive = process.platform === 'linux'): string => {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '');
  return caseSensitive ? normalized : normalized.toLowerCase();
};
