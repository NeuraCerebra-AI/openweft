import { describe, expect, it } from 'vitest';

import { classifyError } from '../../src/domain/errors.js';

describe('errors', () => {
  it('classifies transient failures', () => {
    expect(classifyError(new Error('HTTP 429 rate limit exceeded')).tier).toBe('transient');
  });

  it('classifies fatal failures', () => {
    expect(classifyError(new Error('Authentication failed: not logged in')).tier).toBe('fatal');
  });

  it('classifies provider unauthorized errors as fatal', () => {
    expect(classifyError(new Error('401 Unauthorized: Incorrect API key provided')).tier).toBe('fatal');
  });

  it('classifies missing API key environment variables as fatal', () => {
    expect(classifyError(new Error('Missing required API key environment variable ANTHROPIC_API_KEY.')).tier).toBe('fatal');
  });

  it('classifies provider service-unavailable failures as transient', () => {
    expect(classifyError(new Error('HTTP 503 Service Unavailable from api.anthropic.com')).tier).toBe('transient');
  });

  it('classifies DNS lookup failures as transient', () => {
    expect(classifyError(new Error('getaddrinfo ENOTFOUND api.openai.com')).tier).toBe('transient');
  });

  it('classifies all other failures as agent errors', () => {
    expect(classifyError(new Error('Model produced malformed patch output')).tier).toBe('agent');
  });
});
