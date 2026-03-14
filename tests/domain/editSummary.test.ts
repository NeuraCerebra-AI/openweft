import { describe, expect, it } from 'vitest';

import { buildEditSummary } from '../../src/domain/editSummary.js';

describe('editSummary', () => {
  it('joins name-status and numstat git output', () => {
    const summary = buildEditSummary({
      mergeCommit: 'abc123',
      branch: 'agent-1',
      preMergeCommit: 'def456',
      nameStatusOutput: 'M\tsrc/main.ts\nR100\tsrc/old.ts\tsrc/new.ts',
      numstatOutput: '12\t3\tsrc/main.ts\n5\t1\tsrc/old.ts => src/new.ts'
    });

    expect(summary.total_files_changed).toBe(2);
    expect(summary.total_lines_added).toBe(17);
    expect(summary.files[1]?.old_path).toBe('src/old.ts');
  });
});

