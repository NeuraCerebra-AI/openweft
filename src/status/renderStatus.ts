import { createEmptyCostTotals } from '../domain/costs.js';
import { parseQueueFile, summarizeQueueRequest } from '../domain/queue.js';
import type { PriorityTier } from '../domain/primitives.js';
import type { OrchestratorCheckpoint, FeatureCheckpoint } from '../state/checkpoint.js';
import {
  summarizeCurrentHeadCheck,
  summarizeRuntimeArtifacts,
  type RuntimeDiagnostics
} from './runtimeDiagnostics.js';

const formatPriority = (score: number | null | undefined, tier: PriorityTier | null | undefined): string => {
  if (score === null || score === undefined || tier === null || tier === undefined) {
    return 'unscored';
  }

  return `${tier} ${score.toFixed(3)}`;
};

const summarizeFeatureStatuses = (checkpoint: OrchestratorCheckpoint | null): string => {
  if (!checkpoint) {
    return '0 total';
  }

  const counts = new Map<string, number>();
  for (const feature of Object.values(checkpoint.features)) {
    counts.set(feature.status, (counts.get(feature.status) ?? 0) + 1);
  }

  const total = Object.keys(checkpoint.features).length;
  const summaryParts = ['completed', 'planned', 'executing', 'failed', 'pending', 'skipped']
    .map((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? `${count} ${status}` : null;
    })
    .filter((value): value is string => value !== null);

  return summaryParts.length > 0 ? `${total} total (${summaryParts.join(', ')})` : `${total} total`;
};

const sortFeatureIds = (
  checkpoint: OrchestratorCheckpoint | null,
  features: FeatureCheckpoint[]
): FeatureCheckpoint[] => {
  const order = new Map((checkpoint?.queue.orderedFeatureIds ?? []).map((id, index) => [id, index]));

  return [...features].sort((left, right) => {
    const leftIndex = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return left.id.localeCompare(right.id);
  });
};

const formatFeatureList = (
  checkpoint: OrchestratorCheckpoint | null,
  label: string,
  features: FeatureCheckpoint[]
): string[] => {
  if (features.length === 0) {
    return [`${label}: none`];
  }

  const ordered = sortFeatureIds(checkpoint, features);
  return [
    `${label}:`,
    ...ordered.map((feature) => {
      const priority = formatPriority(feature.priorityScore, feature.priorityTier ?? null);
      const errorSuffix = feature.lastError ? ` | ${feature.lastError}` : '';
      const requestLabel = feature.title?.trim() || summarizeQueueRequest(feature.request);
      return `  [${feature.id}] ${requestLabel} (${priority})${errorSuffix}`;
    })
  ];
};

export const renderStatusReport = (input: {
  checkpoint: OrchestratorCheckpoint | null;
  checkpointSource?: 'primary' | 'backup' | 'none';
  queueContent: string;
  usageDisplay?: 'tokens' | 'estimated-cost';
  diagnostics?: RuntimeDiagnostics;
  background?: {
    pid: number;
    alive: boolean;
  } | null;
}): string => {
  const queue = parseQueueFile(input.queueContent);
  const checkpoint = input.checkpoint;
  const cost = checkpoint?.cost ?? createEmptyCostTotals();
  const features = checkpoint ? Object.values(checkpoint.features) : [];
  const executing = features.filter((feature) => feature.status === 'executing');
  const planned = features.filter((feature) => feature.status === 'planned');
  const failed = features.filter((feature) => feature.status === 'failed');
  const completed = features.filter((feature) => feature.status === 'completed');
  const usageDisplay = input.usageDisplay ?? 'tokens';
  const usageLine = usageDisplay === 'estimated-cost'
    ? `Cost: $${cost.totalEstimatedUsd.toFixed(6)} (${cost.totalInputTokens} input / ${cost.totalOutputTokens} output tokens)`
    : `Tokens: ${cost.totalInputTokens} input / ${cost.totalOutputTokens} output`;

  const lines = [
    `Status: ${checkpoint?.status ?? 'idle'}`,
    `Machine State: ${checkpoint?.currentState ?? 'idle'}`,
    `Background: ${input.background ? (input.background.alive ? `running (PID ${input.background.pid})` : `stale PID ${input.background.pid}`) : 'not running'}`,
    `Pending Queue: ${queue.pending.length}`,
    `Processed Queue Entries: ${queue.processed.length}`,
    `Features: ${summarizeFeatureStatuses(checkpoint)}`,
    usageLine,
    ...formatFeatureList(checkpoint, 'Executing', executing),
    ...formatFeatureList(checkpoint, 'Planned', planned),
    ...formatFeatureList(checkpoint, 'Failed', failed),
    ...formatFeatureList(checkpoint, 'Completed', completed.slice(-5))
  ];

  if (input.checkpointSource === 'backup') {
    lines.splice(2, 0, 'Checkpoint Source: backup');
  }

  if (checkpoint?.currentPhase) {
    lines.splice(
      3,
      0,
      `Current Phase: ${checkpoint.currentPhase.name} [${checkpoint.currentPhase.featureIds.join(', ')}]`
    );
  }

  lines.push(
    ...buildStatusDiagnosticsLines({
      checkpointSource: input.checkpointSource,
      diagnostics: input.diagnostics
    })
  );

  return `${lines.join('\n')}\n`;
};

export const buildStatusDiagnosticsLines = (input: {
  checkpointSource: 'primary' | 'backup' | 'none' | undefined;
  diagnostics: RuntimeDiagnostics | undefined;
}): string[] => {
  if (!input.diagnostics) {
    return [];
  }

  const lines = [
    `Primary Checkpoint Updated: ${input.diagnostics.checkpointTimestamps.primaryUpdatedAt ?? 'unknown'}`,
    `Backup Checkpoint Updated: ${input.diagnostics.checkpointTimestamps.backupUpdatedAt ?? 'missing'}`
  ];

  if (input.checkpointSource === 'backup') {
    lines.push('Backup Semantics: previous snapshot by design');
  }

  lines.push(`Current HEAD: ${input.diagnostics.headCommit ?? 'unknown'}`);
  lines.push(`Current HEAD Check: ${summarizeCurrentHeadCheck(input.diagnostics)}`);
  lines.push(`Runtime Artifacts: ${summarizeRuntimeArtifacts(input.diagnostics)}`);

  return lines;
};
