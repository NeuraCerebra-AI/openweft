import { normalizeRelativePath } from './paths.js';
import { PriorityTierSchema, type Manifest, type PriorityTier } from './primitives.js';

export type FileTypeClassification =
  | 'schema-migration'
  | 'config-ci'
  | 'shared-lib'
  | 'route-controller'
  | 'feature-component'
  | 'test'
  | 'docs';

export interface QueueFeatureInput {
  featureId: string;
  title: string;
  manifest: Manifest;
  stepCount?: number | undefined;
  hasExternalApi?: boolean | undefined;
  previousSmoothedPriority?: number | undefined;
  previousTier?: PriorityTier | undefined;
  previousRank?: number | undefined;
  cyclesSeen?: number | undefined;
  successPenalty?: number | undefined;
}

export interface RepoAnalysisContext {
  fanInByPath: Record<string, number>;
  totalDirectories: number;
  medianFanIn: number;
  maxFanIn: number;
}

export interface ScoredFeature extends QueueFeatureInput {
  fileCount: number;
  blastRadius: number;
  normalizedBlastRadius: number;
  successLikelihood: number;
  rawPriority: number;
  smoothedPriority: number;
  tier: PriorityTier;
  highCouplingRatio: number;
}

const TYPE_WEIGHTS: Record<FileTypeClassification, number> = {
  'schema-migration': 1.0,
  'config-ci': 0.8,
  'shared-lib': 0.8,
  'route-controller': 0.5,
  'feature-component': 0.4,
  test: 0.1,
  docs: 0.05
};

const OP_WEIGHTS = {
  create: 0.6,
  modify: 1.0,
  delete: 0.3
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeValue = (value: number, min: number, max: number): number => {
  if (max === min) {
    return value === 0 ? 0 : 1;
  }

  return (value - min) / (max - min);
};

export const classifyFilePath = (filePath: string): FileTypeClassification => {
  const normalized = normalizeRelativePath(filePath);

  if (/\.(md|mdx|txt|rst)$/i.test(normalized) || normalized.startsWith('docs/')) {
    return 'docs';
  }

  if (/(\.|\/)(test|spec)\./.test(normalized) || normalized.includes('/tests/')) {
    return 'test';
  }

  if (
    normalized.includes('/migrations/') ||
    normalized.includes('/migration/') ||
    normalized.includes('/schema/') ||
    normalized.endsWith('.sql') ||
    /prisma|drizzle|knex/i.test(normalized)
  ) {
    return 'schema-migration';
  }

  if (
    normalized === 'package.json' ||
    normalized === 'pnpm-lock.yaml' ||
    normalized === 'package-lock.json' ||
    normalized === 'tsconfig.json' ||
    normalized === 'dockerfile' ||
    normalized.includes('/.github/') ||
    normalized.includes('/workflows/') ||
    normalized.includes('/ci/')
  ) {
    return 'config-ci';
  }

  if (
    normalized.includes('/shared/') ||
    normalized.includes('/common/') ||
    normalized.includes('/utils/') ||
    normalized.includes('/lib/') ||
    normalized.includes('/core/')
  ) {
    return 'shared-lib';
  }

  if (
    normalized.includes('/routes/') ||
    normalized.includes('/controllers/') ||
    normalized.includes('/api/')
  ) {
    return 'route-controller';
  }

  return 'feature-component';
};

const getDirectoryCount = (manifest: Manifest): number => {
  const directories = new Set(
    [...manifest.create, ...manifest.modify, ...manifest.delete].map((filePath) => {
      const normalized = normalizeRelativePath(filePath);
      const lastSlash = normalized.lastIndexOf('/');
      return lastSlash === -1 ? '.' : normalized.slice(0, lastSlash);
    })
  );

  return directories.size;
};

export const hasHotFileRisk = (manifest: Manifest, repoContext: RepoAnalysisContext): boolean => {
  const paths = [...manifest.create, ...manifest.modify, ...manifest.delete];
  return paths.some((filePath) => {
    const classification = classifyFilePath(filePath);
    const fanIn = repoContext.fanInByPath[normalizeRelativePath(filePath)] ?? 0;
    return (
      classification === 'schema-migration' ||
      classification === 'config-ci' ||
      (classification === 'shared-lib' && fanIn > repoContext.medianFanIn)
    );
  });
};

export const calculateBlastRadius = (manifest: Manifest, repoContext: RepoAnalysisContext): number => {
  const fileRisks: number[] = [];
  const manifestOperations: Array<keyof Manifest> = ['create', 'modify', 'delete'];

  for (const operation of manifestOperations) {
    const files = manifest[operation];
    for (const filePath of files) {
      const classification = classifyFilePath(filePath);
      const typeWeight = TYPE_WEIGHTS[classification];
      const fanIn = repoContext.fanInByPath[normalizeRelativePath(filePath)] ?? 0;
      const normalizedFanIn = repoContext.maxFanIn > 0 ? fanIn / repoContext.maxFanIn : 0;
      const fanInScore = operation === 'create' ? 0.1 : Math.max(normalizedFanIn, 0.1);
      fileRisks.push(typeWeight * OP_WEIGHTS[operation] * fanInScore);
    }
  }

  const uniqueDirectories = Math.max(1, getDirectoryCount(manifest));
  const totalDirectories = Math.max(2, repoContext.totalDirectories);
  const spreadMultiplier = 1 + Math.log2(uniqueDirectories) / Math.log2(totalDirectories);

  return fileRisks.reduce((sum, risk) => sum + risk, 0) * spreadMultiplier;
};

export const calculateSuccessLikelihood = (feature: QueueFeatureInput, repoContext: RepoAnalysisContext): number => {
  const files = [...feature.manifest.create, ...feature.manifest.modify, ...feature.manifest.delete];
  const fileCount = Math.max(files.length, 1);
  const createRatio = feature.manifest.create.length / fileCount;
  const modifyRatio = feature.manifest.modify.length / fileCount;
  const highCouplingRatio =
    files.filter((filePath) => (repoContext.fanInByPath[normalizeRelativePath(filePath)] ?? 0) > repoContext.medianFanIn)
      .length / fileCount;
  const stepCount = feature.stepCount ?? Math.ceil(fileCount * 1.5);

  let score = 0.85;
  score -= 0.1 * (fileCount - 1);
  score -= 0.15 * modifyRatio;
  score += 0.1 * createRatio;
  if (feature.hasExternalApi) score -= 0.2;
  score -= 0.05 * Math.max(0, stepCount - 3);
  score -= 0.1 * highCouplingRatio;
  score -= feature.successPenalty ?? 0;

  return clamp(score, 0.05, 0.95);
};

export const smoothPriority = (
  rawPriority: number,
  previousSmoothedPriority?: number,
  cyclesSeen = 0
): number => {
  if (previousSmoothedPriority === undefined) {
    return rawPriority;
  }

  // Favor responsiveness for the first two revisits, then settle into a conservative EWMA.
  const lambda = cyclesSeen < 2 ? 1.0 : 0.25;
  return lambda * rawPriority + (1 - lambda) * previousSmoothedPriority;
};

export const assignPriorityTier = (
  score: number,
  previousTier?: PriorityTier
): PriorityTier => {
  switch (previousTier) {
    case 'critical':
      return score < 0.77 ? 'high' : 'critical';
    case 'high':
      if (score > 0.82) {
        return 'critical';
      }
      if (score < 0.52) {
        return 'medium';
      }
      return 'high';
    case 'medium':
      if (score > 0.57) {
        return 'high';
      }
      if (score < 0.27) {
        return 'low';
      }
      return 'medium';
    default:
      if (score > 0.82) {
        return 'critical';
      }
      if (score > 0.57) {
        return 'high';
      }
      if (score > 0.32) {
        return 'medium';
      }
      return 'low';
  }
};

export const scoreQueueFeatures = (
  features: QueueFeatureInput[],
  repoContext: RepoAnalysisContext
): ScoredFeature[] => {
  const blastRadiusValues = features.map((feature) => calculateBlastRadius(feature.manifest, repoContext));
  const minBlastRadius = Math.min(...blastRadiusValues, 0);
  const maxBlastRadius = Math.max(...blastRadiusValues, 0);

  const scored = features.map((feature, index) => {
    const blastRadius = blastRadiusValues[index] ?? 0;
    const normalizedBlastRadius = normalizeValue(blastRadius, minBlastRadius, maxBlastRadius);
    const successLikelihood = calculateSuccessLikelihood(feature, repoContext);
    const rawPriority = successLikelihood / (Math.pow(normalizedBlastRadius, 0.6) + 0.01);
    const smoothedPriority = smoothPriority(rawPriority, feature.previousSmoothedPriority, feature.cyclesSeen);
    const tier = assignPriorityTier(smoothedPriority, feature.previousTier);
    const paths = [...feature.manifest.create, ...feature.manifest.modify, ...feature.manifest.delete];
    const fileCount = paths.length;
    const highCouplingRatio =
      fileCount === 0
        ? 0
        : paths.filter((filePath) => (repoContext.fanInByPath[normalizeRelativePath(filePath)] ?? 0) > repoContext.medianFanIn)
            .length / fileCount;

    return {
      ...feature,
      fileCount,
      blastRadius,
      normalizedBlastRadius,
      successLikelihood,
      rawPriority,
      smoothedPriority,
      tier,
      highCouplingRatio
    };
  });

  return scored.sort((left, right) => {
    const delta = right.smoothedPriority - left.smoothedPriority;
    if (Math.abs(delta) <= 0.03) {
      return (left.previousRank ?? Number.MAX_SAFE_INTEGER) - (right.previousRank ?? Number.MAX_SAFE_INTEGER);
    }

    return delta;
  });
};

export type RepoRiskContext = RepoAnalysisContext;

export interface ScoreableFeature {
  id: string;
  request: string;
  manifest: Manifest;
  stepCount?: number | undefined;
  hasExternalApi?: boolean | undefined;
  previousSmoothedPriority?: number | undefined;
  previousTier?: PriorityTier | undefined;
}

export interface QueueScoringOptions {
  previousOrdering?: string[] | undefined;
}

export interface FeatureScoreBreakdown {
  id: string;
  blastRadiusRaw: number;
  blastRadius: number;
  successLikelihood: number;
  rawPriority: number;
  smoothedPriority: number;
  tier: PriorityTier;
}

export const scoreQueue = (
  features: ScoreableFeature[],
  repoContext: RepoRiskContext,
  options: QueueScoringOptions = {}
): FeatureScoreBreakdown[] => {
  const previousIndex = new Map((options.previousOrdering ?? []).map((featureId, index) => [featureId, index]));

  const scored = scoreQueueFeatures(
    features.map((feature) => ({
      featureId: feature.id,
      title: feature.request,
      manifest: feature.manifest,
      stepCount: feature.stepCount,
      hasExternalApi: feature.hasExternalApi,
      previousSmoothedPriority: feature.previousSmoothedPriority,
      previousTier: feature.previousTier,
      previousRank: previousIndex.get(feature.id)
    })),
    repoContext
  );

  return scored.map((entry) => ({
    id: entry.featureId,
    blastRadiusRaw: entry.blastRadius,
    blastRadius: entry.normalizedBlastRadius,
    successLikelihood: entry.successLikelihood,
    rawPriority: entry.rawPriority,
    smoothedPriority: entry.smoothedPriority,
    tier: entry.tier
  }));
};
