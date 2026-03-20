import { describe, expect, it } from 'vitest';

import {
  appendRequestsToQueueContent,
  buildQueueContentFromCheckpointState,
  extractRequestsFromInput,
  removePendingQueueLine,
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

  it('treats stdin-style input as one logical multiline request', () => {
    expect(extractRequestsFromInput('add one\n# keep this line\n\nadd two')).toEqual([
      'add one\n# keep this line\n\nadd two'
    ]);
  });

  it('appends requests to queue content', () => {
    const updated = appendRequestsToQueueContent('# sprint\n', ['add dark mode']);

    expect(updated).toContain('# openweft queue format: v1');
    expect(parseQueueFile(updated).pending.map((entry) => entry.request)).toEqual(['add dark mode']);
  });

  it('round-trips a multiline logical request as one pending queue item', () => {
    const request = 'add dashboard filters\ninclude saved views\nand keyboard shortcuts';
    const updated = appendRequestsToQueueContent('', [request]);
    const parsed = parseQueueFile(updated);

    expect(parsed.pending).toHaveLength(1);
    expect(parsed.pending[0]?.request).toBe(request);
  });

  it('normalizes a legacy queue file into v1 records on append', () => {
    const updated = appendRequestsToQueueContent('# sprint\nadd dark mode\n', ['add auth']);
    const lines = updated.trimEnd().split('\n');

    expect(lines[0]).toBe('# openweft queue format: v1');
    expect(lines[1]).toBe('# sprint');
    expect(lines[2]).toMatch(/^\{"version":1,"type":"pending","id":"q_[^"]+","request":"add dark mode"\}$/);
    expect(lines[3]).toMatch(/^\{"version":1,"type":"pending","id":"q_[^"]+","request":"add auth"\}$/);
    expect(parseQueueFile(updated).pending.map((line) => line.request)).toEqual(['add dark mode', 'add auth']);
  });

  it('throws on malformed v1 record lines once the v1 header is present', () => {
    expect(() => parseQueueFile('# openweft queue format: v1\nnot json\n')).toThrow(
      'Malformed v1 queue record at line 1.'
    );
  });

  it('deduplicates pending requests when appending', () => {
    const updated = appendRequestsToQueueContent('alpha\nbeta\n', ['beta', 'gamma', 'gamma']);

    expect(updated).toContain('# openweft queue format: v1');
    expect(parseQueueFile(updated).pending.map((entry) => entry.request)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('marks a pending queue line as processed', () => {
    const updated = markQueueLineProcessed('add dark mode\nadd auth\n', 1, '002');
    const lines = updated.trimEnd().split('\n');

    expect(lines[0]).toBe('# openweft queue format: v1');
    expect(lines[1]).toMatch(/^\{"version":1,"type":"pending","id":"q_[^"]+","request":"add dark mode"\}$/);
    expect(lines[2]).toMatch(
      /^\{"version":1,"type":"processed","id":"q_[^"]+","featureId":"002","request":"add auth"\}$/
    );
  });

  it('throws when the expected request no longer matches during processing', () => {
    expect(() => markQueueLineProcessed('alpha\nbeta\n', 1, '002', undefined, 'gamma')).toThrow(
      'Queue line 1 no longer matches the expected request and cannot be marked processed safely.'
    );
  });

  it('removes the exact pending queue line by line index', () => {
    const updated = removePendingQueueLine('alpha\nduplicate\nbravo\nduplicate\ncharlie\n', 3);

    expect(updated).toContain('# openweft queue format: v1');
    expect(parseQueueFile(updated).pending.map((entry) => entry.request)).toEqual([
      'alpha',
      'duplicate',
      'bravo',
      'charlie'
    ]);
  });

  it('throws when removing a queue line that does not exist', () => {
    expect(() => removePendingQueueLine('alpha\nbeta\n', 3)).toThrow(
      'Queue line 3 does not exist.'
    );
  });

  it('throws when removing a processed queue line', () => {
    expect(() => removePendingQueueLine('# ✓ [001] alpha\nbeta\n', 0)).toThrow(
      'Queue line 0 is not pending and cannot be removed.'
    );
  });

  it('throws when the expected request no longer matches', () => {
    expect(() => removePendingQueueLine('alpha\nbeta\n', 1, 'gamma')).toThrow(
      'Queue line 1 no longer matches the expected request and cannot be removed safely.'
    );
  });

  it('returns empty string when removing the only pending line', () => {
    expect(removePendingQueueLine('alpha\n', 0)).toBe('');
  });

  it('rebuilds queue content from processed features and pending requests', () => {
    const rebuilt = buildQueueContentFromCheckpointState({
      existingContent: '# sprint notes\n\nlegacy pending\n',
      processed: [
        { featureId: '002', request: 'add export controls' },
        { featureId: '001', request: 'add dashboard filters' }
      ],
      pendingRequests: ['add keyboard shortcuts']
    });
    const parsed = parseQueueFile(rebuilt);

    expect(parsed.processed.map((entry) => entry.featureId)).toEqual(['001', '002']);
    expect(parsed.processed.map((entry) => entry.request)).toEqual([
      'add dashboard filters',
      'add export controls'
    ]);
    expect(parsed.pending.map((entry) => entry.request)).toEqual(['add keyboard shortcuts']);
    expect(rebuilt).toContain('# sprint notes');
  });
});
