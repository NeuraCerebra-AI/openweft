export type FailureTier = 'transient' | 'agent' | 'fatal';

export interface ClassifiedError {
  tier: FailureTier;
  reason: string;
}

const TRANSIENT_PATTERNS = [
  /429/,
  /rate limit/i,
  /retry-after/i,
  /etimedout/i,
  /econnreset/i,
  /eai_again/i,
  /getaddrinfo enotfound/i,
  /\b503\b.*\bservice unavailable\b/i
];
const FATAL_PATTERNS = [
  /not logged in/i,
  /authentication/i,
  /auth failed/i,
  /\b401\b.*\bunauthorized\b/i,
  /incorrect api key/i,
  /command not found/i,
  /enoent/i,
  /enospc/i,
  /disk full/i,
  /missing required api key environment variable/i,
  /invalid config/i,
  /template empty/i
];

const toMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return JSON.stringify(error);
};

export const classifyError = (error: unknown): ClassifiedError => {
  const message = toMessage(error);

  // Prefer transient classification: a genuine network/5xx failure (e.g. a 503 or
  // a 429) is retryable even when its human-readable text incidentally mentions a
  // fatal-sounding token such as "authentication". Transient patterns are narrow and
  // specific, so they will not spuriously match a truly fatal message.
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      tier: 'transient',
      reason: message
    };
  }

  if (FATAL_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      tier: 'fatal',
      reason: message
    };
  }

  return {
    tier: 'agent',
    reason: message
  };
};

export const classifyFailure = classifyError;

// Require a minimum number of observed attempts before the breaker can trip, so a
// single early failure (1 of 1) does not immediately open the circuit on noise.
const CIRCUIT_BREAKER_MIN_SAMPLE = 3;

export const circuitBreakerTripped = (failedCount: number, totalCount: number): boolean => {
  if (totalCount < CIRCUIT_BREAKER_MIN_SAMPLE) {
    return false;
  }

  return failedCount / totalCount > 0.5;
};
