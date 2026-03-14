import { describe, expect, it } from 'vitest';

import {
  appendRequestsToQueueContent,
  extractRequestsFromInput,
  markQueueLineProcessed,
  parseQueueFile
} from '../../src/domain/queue.js';

describe('queue', () => {
  it('parses comments, blanks, pending, and processed lines', () => {
    const parsed = parseQueueFile('# sprint\nadd dark mode\n# ✓ [001] done item\n\n');

    expect(parsed.pending.map((entry) => entry.request)).toEqual(['add dark mode']);
    expect(parsed.processed.map((entry) => entry.featureId)).toEqual(['001']);
    expect(parsed.lines).toHaveLength(5);
  });

  it('extracts feature requests from stdin-style input', () => {
    expect(extractRequestsFromInput('add one\n# ignore\n\nadd two')).toEqual(['add one', 'add two']);
  });

  it('appends requests to queue content', () => {
    expect(appendRequestsToQueueContent('# sprint\n', ['add dark mode'])).toBe('# sprint\nadd dark mode\n');
  });

  it('marks a pending queue line as processed', () => {
    const updated = markQueueLineProcessed('add dark mode\nadd auth\n', 1, '002');
    expect(updated).toBe('add dark mode\n# ✓ [002] add auth\n');
  });
});

