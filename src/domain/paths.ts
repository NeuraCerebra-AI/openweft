import path from 'node:path';

export { RelativeFilePathSchema } from './primitives.js';

export const normalizeRelativePath = (value: string, caseSensitive = process.platform === 'linux'): string => {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '');
  return caseSensitive ? normalized : normalized.toLowerCase();
};
