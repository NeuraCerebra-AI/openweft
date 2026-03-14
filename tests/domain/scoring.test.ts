import { describe, expect, it } from 'vitest';

import { assignPriorityTier, classifyFilePath, scoreQueueFeatures } from '../../src/domain/scoring.js';

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
});

