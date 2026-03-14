import { describe, expect, it } from 'vitest';

import { MockAgentAdapter } from '../../src/adapters/mock.js';
import type { AdapterTurnRequest } from '../../src/adapters/types.js';

const baseRequest = (): AdapterTurnRequest => ({
  featureId: '001',
  stage: 'planning-s1',
  cwd: '/tmp/openweft-test',
  prompt: 'Plan the feature.',
  model: 'mock-model',
  auth: { method: 'subscription' }
});

describe('mock adapter', () => {
  it('returns deterministic fixture-backed success payloads', async () => {
    const adapter = new MockAgentAdapter({
      fixtures: {
        'planning-s1': {
          finalMessage: 'Mock planning output',
          sessionId: 'mock-session-123',
          usage: {
            inputTokens: 10,
            outputTokens: 5
          }
        }
      }
    });

    const result = await adapter.runTurn(baseRequest());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalMessage).toBe('Mock planning output');
      expect(result.sessionId).toBe('mock-session-123');
      expect(result.costRecord.estimatedCostUsd).toBe(0);
    }
  });

  it('returns classified failures from error fixtures', async () => {
    const adapter = new MockAgentAdapter({
      fixtures: {
        default: {
          error: 'HTTP 429 rate limit exceeded'
        }
      }
    });

    const result = await adapter.runTurn(baseRequest());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.classified.tier).toBe('transient');
    }
  });
});
