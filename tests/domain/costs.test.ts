import { describe, expect, it, vi } from 'vitest';

import { accumulateCostTotals, createCostEntry, createEmptyCostTotals, estimateCostUsd } from '../../src/domain/costs.js';

describe('costs', () => {
  it('estimates cost from model pricing', () => {
    expect(estimateCostUsd('gpt-5.3-codex', 1_000_000, 100_000)).toBe(3.15);
  });

  it('returns zero quietly for unknown model names', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(estimateCostUsd('unknown-model-xyz', 1_000_000, 100_000)).toBe(0);
    estimateCostUsd('unknown-model-xyz', 500_000, 50_000);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('creates and accumulates cost entries', () => {
    const entry = createCostEntry({
      featureId: '001',
      stage: 'execution',
      model: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      timestamp: '2026-03-13T08:00:00.000Z'
    });

    const totals = accumulateCostTotals(createEmptyCostTotals(), entry);
    expect(totals.totalInputTokens).toBe(1000);
    expect(totals.perFeature['001']?.usd).toBe(entry.estimatedCostUsd);
  });
});
