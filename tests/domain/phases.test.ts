import { describe, expect, it } from 'vitest';

import { groupFeaturesIntoPhases } from '../../src/domain/phases.js';

describe('phases', () => {
  const repoContext = {
    fanInByPath: {
      'src/shared/config.ts': 12
    },
    totalDirectories: 8,
    medianFanIn: 2,
    maxFanIn: 12
  };

  it('separates overlapping manifests into different phases', () => {
    const phases = groupFeaturesIntoPhases(
      [
        {
          featureId: '001',
          title: 'A',
          manifest: { create: ['src/a.ts'], modify: [], delete: [] },
          fileCount: 1,
          blastRadius: 0.1,
          normalizedBlastRadius: 0.1,
          successLikelihood: 0.9,
          rawPriority: 0.9,
          smoothedPriority: 0.9,
          tier: 'high',
          highCouplingRatio: 0
        },
        {
          featureId: '002',
          title: 'B',
          manifest: { create: [], modify: ['src/a.ts'], delete: [] },
          fileCount: 1,
          blastRadius: 0.1,
          normalizedBlastRadius: 0.1,
          successLikelihood: 0.8,
          rawPriority: 0.8,
          smoothedPriority: 0.8,
          tier: 'high',
          highCouplingRatio: 0
        }
      ],
      repoContext,
      3
    );

    expect(phases).toHaveLength(2);
  });

  it('serializes conservative hot-file work', () => {
    const phases = groupFeaturesIntoPhases(
      [
        {
          featureId: '001',
          title: 'Hot',
          manifest: { create: [], modify: ['src/shared/config.ts'], delete: [] },
          fileCount: 1,
          blastRadius: 1,
          normalizedBlastRadius: 1,
          successLikelihood: 0.5,
          rawPriority: 0.5,
          smoothedPriority: 0.5,
          tier: 'medium',
          highCouplingRatio: 1
        },
        {
          featureId: '002',
          title: 'Leaf',
          manifest: { create: ['src/leaf.ts'], modify: [], delete: [] },
          fileCount: 1,
          blastRadius: 0.1,
          normalizedBlastRadius: 0.1,
          successLikelihood: 0.9,
          rawPriority: 0.9,
          smoothedPriority: 0.9,
          tier: 'high',
          highCouplingRatio: 0
        }
      ],
      repoContext,
      3
    );

    expect(phases[0]?.features).toHaveLength(1);
    expect(phases[1]?.features).toHaveLength(1);
  });
});

