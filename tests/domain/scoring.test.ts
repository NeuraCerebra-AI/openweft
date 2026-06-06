import { describe, expect, it } from 'vitest';

import { assignPriorityTier, classifyFilePath, scoreQueue, scoreQueueFeatures, smoothPriority } from '../../src/domain/scoring.js';

describe('scoring', () => {
  const repoContext = {
    fanInByPath: {
      'src/shared/utils.ts': 10,
      'src/features/a.ts': 1,
      'src/features/b.ts': 0
    },
    totalDirectories: 8,
    medianFanIn: 2,
    maxFanIn: 10
  };

  it('classifies file paths conservatively', () => {
    expect(classifyFilePath('src/shared/utils.ts')).toBe('shared-lib');
    expect(classifyFilePath('src/routes/auth.ts')).toBe('route-controller');
    expect(classifyFilePath('docs/notes.md')).toBe('docs');
  });

  it('scores and ranks queue features', () => {
    const scored = scoreQueueFeatures(
      [
        {
          featureId: '001',
          title: 'Small feature',
          manifest: {
            create: ['src/features/b.ts'],
            modify: [],
            delete: []
          },
          previousRank: 0
        },
        {
          featureId: '002',
          title: 'Shared refactor',
          manifest: {
            create: [],
            modify: ['src/shared/utils.ts'],
            delete: []
          },
          previousRank: 1
        }
      ],
      repoContext
    );

    expect(scored[0]?.featureId).toBe('001');
    expect(scored[0]?.smoothedPriority).toBeGreaterThan(scored[1]?.smoothedPriority ?? 0);
  });

  it('assigns tiers with hysteresis support', () => {
    expect(assignPriorityTier(0.85)).toBe('critical');
    expect(assignPriorityTier(0.54, 'high')).toBe('high');
    expect(assignPriorityTier(0.5, 'high')).toBe('medium');
  });

  it('treats a single-feature queue as having non-zero normalized blast radius', () => {
    const scored = scoreQueueFeatures(
      [
        {
          featureId: '001',
          title: 'Only feature',
          manifest: {
            create: ['src/features/b.ts'],
            modify: [],
            delete: []
          }
        }
      ],
      repoContext
    );

    expect(scored[0]?.normalizedBlastRadius).toBe(1);
    expect(scored[0]?.rawPriority).toBeLessThan(1);
  });

  it('keeps smoothing fully responsive for the first two revisits before applying EWMA damping', () => {
    expect(smoothPriority(0.9, 0.1, 0)).toBe(0.9);
    expect(smoothPriority(0.9, 0.1, 1)).toBe(0.9);
    expect(smoothPriority(0.9, 0.1, 2)).toBeCloseTo(0.3);
  });

  it('treats NaN previousSmoothedPriority as first visit', () => {
    expect(smoothPriority(0.7, NaN, 5)).toBe(0.7);
  });

  it('A1: maps the lowest-blast feature to a near-zero normalized blast radius among several features', () => {
    // Three features with strictly distinct, increasing blast radii.
    // Min-max normalization should map the smallest to ~0 and the largest to 1.
    const scored = scoreQueueFeatures(
      [
        {
          featureId: '001',
          title: 'tiny',
          manifest: { create: ['src/features/b.ts'], modify: [], delete: [] }
        },
        {
          featureId: '002',
          title: 'medium',
          manifest: { create: [], modify: ['src/features/a.ts'], delete: [] }
        },
        {
          featureId: '003',
          title: 'large',
          manifest: { create: [], modify: ['src/shared/utils.ts'], delete: [] }
        }
      ],
      repoContext
    );

    const byId = Object.fromEntries(scored.map((s) => [s.featureId, s]));
    const radii = scored.map((s) => s.blastRadius);
    const minRadius = Math.min(...radii);
    const smallest = scored.find((s) => s.blastRadius === minRadius)!;

    // The smallest blast-radius feature must normalize to ~0 (true min-max).
    expect(smallest.normalizedBlastRadius).toBeCloseTo(0, 5);
    // And the largest must normalize to 1.
    const maxRadius = Math.max(...radii);
    const largest = scored.find((s) => s.blastRadius === maxRadius)!;
    expect(largest.normalizedBlastRadius).toBeCloseTo(1, 5);
    expect(byId['001']).toBeDefined();
  });

  it('A2: produces a deterministic order for several equal-priority new features (no previousRank)', () => {
    const makeFeature = (featureId: string) => ({
      featureId,
      title: `feature ${featureId}`,
      manifest: { create: ['src/features/b.ts'], modify: [], delete: [] }
    });

    // Provide IDs in a deliberately non-sorted input order.
    const inputOrder = ['003', '001', '004', '002'];
    const run = () => scoreQueueFeatures(inputOrder.map(makeFeature), repoContext).map((s) => s.featureId);

    const first = run();
    const second = run();
    // Determinism: same input always yields the same order.
    expect(first).toEqual(second);
    // And the deterministic order should be a stable, well-defined sequence (by featureId).
    expect(first).toEqual(['001', '002', '003', '004']);
  });

  it('propagates cyclesSeen through scoreQueue so EWMA damping activates', () => {
    const feature = {
      id: '001',
      request: 'test',
      manifest: { create: ['src/a.ts'], modify: [], delete: [] },
      previousSmoothedPriority: 0.1,
      cyclesSeen: 3
    };

    const withCycles = scoreQueue([feature], repoContext);
    const withoutCycles = scoreQueue([{ ...feature, cyclesSeen: 0 }], repoContext);

    // With cyclesSeen >= 2, EWMA damping pulls smoothed priority toward previous (0.1)
    // With cyclesSeen < 2, lambda=1.0 so smoothed = raw (ignores previous)
    expect(withCycles[0]!.smoothedPriority).toBeLessThan(withoutCycles[0]!.smoothedPriority);
  });
});
