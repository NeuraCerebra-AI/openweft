import { describe, expect, it } from 'vitest';

import { buildPlanFileName, formatFeatureId, slugifyFeatureRequest } from '../../src/domain/slug.js';

describe('slug helpers', () => {
  it('formats feature ids with zero padding', () => {
    expect(formatFeatureId(7)).toBe('007');
  });

  it('slugifies feature requests into lowercase hyphenated names', () => {
    expect(slugifyFeatureRequest('Add dark mode toggle to settings page')).toBe(
      'add-dark-mode-toggle-to-settings-page'
    );
  });

  it('adds collision suffixes when filenames already exist', () => {
    expect(
      buildPlanFileName(1, 'Add dark mode toggle', ['001_add-dark-mode-toggle.md'])
    ).toBe('001_add-dark-mode-toggle-2.md');
  });
});
