import type { QueuePendingLine } from '../domain/queue.js';

import type { FeatureCheckpoint, OrchestratorCheckpoint } from './checkpoint.js';

export const REVIEW_FEATURE_STATUSES = new Set<FeatureCheckpoint['status']>([
  'planning-needs-review',
  'adjustment-needs-review',
  'blocked-by-failed-feature'
]);

export const TERMINAL_UNRESOLVED_FEATURE_STATUSES = new Set<FeatureCheckpoint['status']>([
  'failed',
  'planning-needs-review',
  'adjustment-needs-review',
  'blocked-by-failed-feature'
]);

export const isReviewFeatureStatus = (status: FeatureCheckpoint['status']): boolean =>
  REVIEW_FEATURE_STATUSES.has(status);

export const isUnresolvedTerminalFeature = (feature: FeatureCheckpoint): boolean =>
  TERMINAL_UNRESOLVED_FEATURE_STATUSES.has(feature.status);

export const isActionableFeature = (feature: FeatureCheckpoint): boolean => {
  if (feature.status === 'pending' || feature.status === 'planned' || feature.status === 'executing') {
    return true;
  }

  if (feature.status === 'failed') {
    return feature.rerunEligible !== false;
  }

  return isReviewFeatureStatus(feature.status);
};

export const hasActionableCheckpointWork = (checkpoint: OrchestratorCheckpoint | null): boolean => {
  if (!checkpoint) {
    return false;
  }

  if ((checkpoint.pendingMergeSummaries ?? []).length > 0) {
    return true;
  }

  return Object.values(checkpoint.features).some((feature) => isActionableFeature(feature));
};

export const hasActionableUnfinishedWork = (
  checkpoint: OrchestratorCheckpoint | null,
  pendingQueueEntries: readonly Pick<QueuePendingLine, 'kind'>[]
): boolean => {
  if (pendingQueueEntries.some((entry) => entry.kind === 'pending')) {
    return true;
  }

  return hasActionableCheckpointWork(checkpoint);
};

export const syncReviewMetadata = (checkpoint: OrchestratorCheckpoint): void => {
  const features = Object.values(checkpoint.features);
  const planningNeedsReview = features.filter((feature) => feature.status === 'planning-needs-review');
  const adjustmentNeedsReview = features.filter((feature) => feature.status === 'adjustment-needs-review');
  const blocked = features.filter((feature) => feature.status === 'blocked-by-failed-feature');
  const reviewFeature = [...planningNeedsReview, ...adjustmentNeedsReview, ...blocked]
    .find((feature) => feature.reviewReason || feature.lastError);

  checkpoint.review = {
    planningNeedsReviewFeatureIds: planningNeedsReview.map((feature) => feature.id),
    adjustmentNeedsReviewFeatureIds: adjustmentNeedsReview.map((feature) => feature.id),
    blockedFeatureIds: blocked.map((feature) => feature.id),
    lastReviewReason: reviewFeature?.reviewReason ?? reviewFeature?.lastError ?? null
  };
};
