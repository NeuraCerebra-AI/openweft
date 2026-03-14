export type FailureTier = 'transient' | 'agent' | 'fatal';

export interface ClassifiedError {
  tier: FailureTier;
  reason: string;
}

const TRANSIENT_PATTERNS = [/429/, /rate limit/i, /retry-after/i, /etimedout/i, /econnreset/i, /eai_again/i];
const FATAL_PATTERNS = [
  /not logged in/i,
  /authentication/i,
  /auth failed/i,
  /command not found/i,
  /enoent/i,
  /enospc/i,
  /disk full/i,
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

  if (FATAL_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      tier: 'fatal',
      reason: message
    };
  }

  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      tier: 'transient',
      reason: message
    };
  }

  return {
    tier: 'agent',
    reason: message
  };
};

export const classifyFailure = classifyError;

export const circuitBreakerTripped = (failedCount: number, totalCount: number): boolean => {
  if (totalCount <= 0) {
    return false;
  }

  return failedCount / totalCount > 0.5;
};
