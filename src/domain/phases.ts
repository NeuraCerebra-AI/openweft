import { findManifestOverlap } from './manifest.js';
import type { Manifest } from './primitives.js';
import type { QueueFeatureInput, RepoAnalysisContext, ScoredFeature } from './scoring.js';
import { hasHotFileRisk } from './scoring.js';

export interface PhaseFeature extends ScoredFeature {
  hotFileRisk?: boolean;
}

export interface ExecutionPhase {
  phaseNumber: number;
  features: PhaseFeature[];
}

const phaseHasOverlap = (phase: PhaseFeature[], manifest: Manifest): boolean => {
  return phase.some((feature) => findManifestOverlap(feature.manifest, manifest).length > 0);
};

export const groupFeaturesIntoPhases = (
  features: ScoredFeature[],
  repoContext: RepoAnalysisContext,
  maxParallelAgents: number
): ExecutionPhase[] => {
  const phases: PhaseFeature[][] = [];

  for (const feature of features) {
    const hotRisk = hasHotFileRisk(feature.manifest, repoContext);
    const phaseFeature: PhaseFeature = {
      ...feature,
      hotFileRisk: hotRisk
    };

    if (hotRisk) {
      phases.push([phaseFeature]);
      continue;
    }

    let placed = false;
    for (const phase of phases) {
      if (phase.length >= maxParallelAgents) {
        continue;
      }

      if (phase.some((existing) => existing.hotFileRisk)) {
        continue;
      }

      if (phaseHasOverlap(phase, feature.manifest)) {
        continue;
      }

      phase.push(phaseFeature);
      placed = true;
      break;
    }

    if (!placed) {
      phases.push([phaseFeature]);
    }
  }

  return phases.map((phase, index) => ({
    phaseNumber: index + 1,
    features: phase
  }));
};

export const buildExecutionPhases = (
  features: Array<{
    id: string;
    manifest: Manifest;
    priorityScore: number;
  }>,
  repoContext?: RepoAnalysisContext,
  maxParallelAgents = Number.POSITIVE_INFINITY
): Array<{
  index: number;
  featureIds: string[];
  features: Array<{
    id: string;
    manifest: Manifest;
    priorityScore: number;
  }>;
}> => {
  const safeRepoContext: RepoAnalysisContext = repoContext ?? {
    fanInByPath: {},
    totalDirectories: 2,
    medianFanIn: 0,
    maxFanIn: 0
  };

  const grouped = groupFeaturesIntoPhases(
    features
      .map((feature) => ({
        featureId: feature.id,
        title: feature.id,
        manifest: feature.manifest,
        fileCount: feature.manifest.create.length + feature.manifest.modify.length + feature.manifest.delete.length,
        blastRadius: 0,
        normalizedBlastRadius: 0,
        successLikelihood: 0,
        rawPriority: feature.priorityScore,
        smoothedPriority: feature.priorityScore,
        tier: 'medium' as const,
        highCouplingRatio: 0
      }))
      .sort((left, right) => right.rawPriority - left.rawPriority),
    safeRepoContext,
    maxParallelAgents
  );

  return grouped.map((phase) => ({
    index: phase.phaseNumber,
    featureIds: phase.features.map((feature) => feature.featureId),
    features: phase.features.map((feature) => ({
      id: feature.featureId,
      manifest: feature.manifest,
      priorityScore: feature.smoothedPriority
    }))
  }));
};
