import { describe, expect, it } from 'vitest';

import { classifyError } from '../../src/domain/errors.js';

describe('errors', () => {
  it('classifies transient failures', () => {
    expect(classifyError(new Error('HTTP 429 rate limit exceeded')).tier).toBe('transient');
  });

  it('classifies fatal failures', () => {
    expect(classifyError(new Error('Authentication failed: not logged in')).tier).toBe('fatal');
  });

  it('classifies all other failures as agent errors', () => {
    expect(classifyError(new Error('Model produced malformed patch output')).tier).toBe('agent');
  });
});

