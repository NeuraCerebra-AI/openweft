import { describe, expect, it } from 'vitest';

import {
  createPlanFilename,
  createPromptBFilename,
  formatFeatureId,
  getNextFeatureId,
  slugifyFeatureRequest
} from '../../src/domain/featureIds.js';

describe('featureIds', () => {
  it('formats feature ids with zero padding', () => {
    expect(formatFeatureId(7)).toBe('007');
  });

  it('slugifies feature requests and trims punctuation', () => {
    expect(slugifyFeatureRequest('  Add dark mode toggle!!  ')).toBe('add-dark-mode-toggle');
  });

  it('creates collision-safe plan filenames', () => {
    expect(
      createPlanFilename(1, 'Add dark mode toggle', ['001_add-dark-mode-toggle.md', '001_add-dark-mode-toggle-2.md'])
    ).toBe('001_add-dark-mode-toggle-3.md');
  });

  it('creates stable prompt b filenames for a feature id and request', () => {
    expect(
      createPromptBFilename(1, 'Add dark mode toggle')
    ).toBe('001_add-dark-mode-toggle.prompt-b.md');
  });

  it('finds the next feature id from existing ids', () => {
    expect(getNextFeatureId([1, 2, 7])).toBe(8);
  });
});
