import { describe, expect, it } from 'vitest';

import { circuitBreakerTripped, classifyError } from '../../src/domain/errors.js';

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

  it('A4: classifies a genuine 5xx network error as transient even if the message also mentions a fatal token', () => {
    // A real transient outage whose human-readable text happens to contain "authentication".
    expect(
      classifyError(new Error('503 service unavailable: authentication service degraded')).tier
    ).toBe('transient');
  });

  it('A4: still classifies genuine fatal auth errors as fatal', () => {
    expect(classifyError(new Error('401 Unauthorized: Incorrect API key provided')).tier).toBe('fatal');
    expect(classifyError(new Error('Authentication failed: not logged in')).tier).toBe('fatal');
    expect(classifyError(new Error('ENOENT: no such file or directory')).tier).toBe('fatal');
  });

  it('D2: classifies a SIGKILL signal termination as transient', () => {
    expect(classifyError(new Error('killed'), { signal: 'SIGKILL' }).tier).toBe('transient');
  });

  it('D2: classifies a SIGTERM signal termination as transient', () => {
    expect(classifyError(new Error('killed'), { signal: 'SIGTERM' }).tier).toBe('transient');
  });

  it('D2: classifies a timed-out subprocess as transient', () => {
    expect(classifyError(new Error(''), { timedOut: true }).tier).toBe('transient');
  });

  it('D2: classifies a signal termination as transient even when the message looks fatal (ordering)', () => {
    expect(
      classifyError(new Error('authentication failed'), { signal: 'SIGKILL' }).tier
    ).toBe('transient');
  });

  it('D2: classifies a SIGINT termination as transient (orchestrator separately maps genuine Ctrl+C to aborted)', () => {
    expect(classifyError(new Error('interrupted'), { signal: 'SIGINT' }).tier).toBe('transient');
  });

  it('D2: a null signal with a fatal message remains fatal', () => {
    expect(
      classifyError(new Error('Authentication failed: not logged in'), { signal: null }).tier
    ).toBe('fatal');
  });

  it('D2: no termination info with an agent-ish message stays agent (backward-compatible optional param)', () => {
    expect(classifyError(new Error('Model produced malformed patch output')).tier).toBe('agent');
  });

  it('A3: does not trip the circuit breaker when exactly half of attempts failed', () => {
    // Exactly half failing should not trip a >half breaker.
    expect(circuitBreakerTripped(2, 4)).toBe(false);
    // A clear majority should trip.
    expect(circuitBreakerTripped(3, 4)).toBe(true);
  });

  it('A3: requires a minimum sample before tripping the circuit breaker', () => {
    // A single failure out of a single attempt should not immediately trip the breaker.
    expect(circuitBreakerTripped(1, 1)).toBe(false);
    expect(circuitBreakerTripped(2, 2)).toBe(false);
  });
});
