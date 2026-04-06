import { rm } from 'node:fs/promises';

import type { ResolvedOpenWeftConfig } from '../config/index.js';
import type { OrchestratorCheckpoint } from '../state/checkpoint.js';
import { saveCheckpoint } from '../state/checkpoint.js';
import { appendAuditEntry } from './audit.js';
import {
  collectRuntimeDiagnostics,
  type RuntimeDiagnostics
} from '../status/runtimeDiagnostics.js';

type TerminalEventName = 'run.completed' | 'run.failed' | 'run.paused' | 'run.stopped';

export interface RuntimeCleanupSummary {
  policy: 'on-success-clean' | 'preserve';
  action: 'cleaned' | 'preserved' | 'nothing-to-clean' | 'cleanup-failed';
  error: string | null;
}

export interface TerminalRunSummary {
  event: TerminalEventName;
  status: OrchestratorCheckpoint['status'];
  finalHead: string | null;
  unresolvedFailedFeatureIds: string[];
  mergeDurability: RuntimeDiagnostics['mergeDurability'];
  runtimeCleanup: RuntimeCleanupSummary;
  diagnostics: RuntimeDiagnostics;
}

const timestamp = (): string => new Date().toISOString();

const saveCheckpointSnapshot = async (
  config: ResolvedOpenWeftConfig,
  checkpoint: OrchestratorCheckpoint
): Promise<void> => {
  checkpoint.updatedAt = timestamp();
  await saveCheckpoint({
    checkpoint,
    checkpointFile: config.paths.checkpointFile,
    checkpointBackupFile: config.paths.checkpointBackupFile
  });
};

const toTerminalEvent = (status: OrchestratorCheckpoint['status']): TerminalEventName => {
  switch (status) {
    case 'completed':
      return 'run.completed';
    case 'paused':
      return 'run.paused';
    case 'stopped':
      return 'run.stopped';
    default:
      return 'run.failed';
  }
};

const collectDiagnostics = async (
  config: ResolvedOpenWeftConfig,
  checkpoint: OrchestratorCheckpoint
): Promise<RuntimeDiagnostics> => {
  return collectRuntimeDiagnostics({
    repoRoot: config.repoRoot,
    checkpointFile: config.paths.checkpointFile,
    checkpointBackupFile: config.paths.checkpointBackupFile,
    codexHomeDir: config.paths.codexHomeDir,
    completedFeatures: Object.values(checkpoint.features).filter((feature) => feature.status === 'completed')
  });
};

const buildMergeDurabilityFailureMessage = (
  check: RuntimeDiagnostics['mergeDurability']['checks'][number]
): string => {
  if (check.result === 'missing-merge-commit') {
    return 'missing recorded merge commit during final durability verification';
  }

  return `recorded merge commit ${check.mergeCommit ?? 'unknown'} is not reachable from final HEAD`;
};

const applyMergeDurabilityFailures = (
  checkpoint: OrchestratorCheckpoint,
  mergeDurability: RuntimeDiagnostics['mergeDurability']
): boolean => {
  let changed = false;

  for (const check of mergeDurability.checks) {
    if (check.result === 'verified') {
      continue;
    }

    const feature = checkpoint.features[check.featureId];
    if (!feature) {
      continue;
    }

    checkpoint.features[check.featureId] = {
      ...feature,
      status: 'failed',
      lastError: buildMergeDurabilityFailureMessage(check),
      rerunEligible: false
    };
    changed = true;
  }

  return changed;
};

const buildRuntimeCleanupSummary = async (input: {
  config: ResolvedOpenWeftConfig;
  status: OrchestratorCheckpoint['status'];
  diagnostics: RuntimeDiagnostics;
}): Promise<RuntimeCleanupSummary> => {
  const policy = input.config.runtime.codexHomeRetention;

  if (input.status !== 'completed' || policy === 'preserve') {
    return {
      policy,
      action: input.diagnostics.runtimeArtifacts.codexHomePresent ? 'preserved' : 'nothing-to-clean',
      error: null
    };
  }

  if (!input.diagnostics.runtimeArtifacts.codexHomePresent) {
    return {
      policy,
      action: 'nothing-to-clean',
      error: null
    };
  }

  try {
    await rm(input.config.paths.codexHomeDir, { recursive: true, force: true });
    return {
      policy,
      action: 'cleaned',
      error: null
    };
  } catch (error) {
    return {
      policy,
      action: 'cleanup-failed',
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

export const finalizeRun = async (input: {
  config: ResolvedOpenWeftConfig;
  checkpoint: OrchestratorCheckpoint;
  plannedCount: number;
  mergedCount: number;
}): Promise<TerminalRunSummary> => {
  let terminalStatus = input.checkpoint.status;
  let diagnostics = await collectDiagnostics(input.config, input.checkpoint);
  let mergeDurability = diagnostics.mergeDurability;

  if (
    terminalStatus === 'completed' &&
    mergeDurability.checks.some((check) => check.result !== 'verified')
  ) {
    applyMergeDurabilityFailures(input.checkpoint, mergeDurability);
    input.checkpoint.status = 'failed';
    input.checkpoint.currentState = 'idle';
    input.checkpoint.currentPhase = null;
    await saveCheckpointSnapshot(input.config, input.checkpoint);
    terminalStatus = input.checkpoint.status;
    diagnostics = await collectDiagnostics(input.config, input.checkpoint);
  }

  let runtimeCleanup = await buildRuntimeCleanupSummary({
    config: input.config,
    status: terminalStatus,
    diagnostics
  });

  if (runtimeCleanup.action === 'cleanup-failed' && terminalStatus === 'completed') {
    input.checkpoint.status = 'failed';
    input.checkpoint.currentState = 'idle';
    input.checkpoint.currentPhase = null;
    await saveCheckpointSnapshot(input.config, input.checkpoint);
    terminalStatus = input.checkpoint.status;
  }

  diagnostics = await collectDiagnostics(input.config, input.checkpoint);

  if (runtimeCleanup.action === 'cleaned' && diagnostics.runtimeArtifacts.codexHomePresent) {
    runtimeCleanup = {
      ...runtimeCleanup,
      action: 'cleanup-failed',
      error: 'codex-home still exists after cleanup attempt'
    };
    if (terminalStatus === 'completed') {
      input.checkpoint.status = 'failed';
      input.checkpoint.currentState = 'idle';
      input.checkpoint.currentPhase = null;
      await saveCheckpointSnapshot(input.config, input.checkpoint);
      terminalStatus = input.checkpoint.status;
      diagnostics = await collectDiagnostics(input.config, input.checkpoint);
    }
  }

  const unresolvedFailedFeatureIds = Object.values(input.checkpoint.features)
    .filter((feature) => feature.status === 'failed')
    .map((feature) => feature.id);
  const event = toTerminalEvent(terminalStatus);

  await appendAuditEntry(input.config.paths.auditLogFile, {
    timestamp: timestamp(),
    level: terminalStatus === 'failed' ? 'warn' : 'info',
    event,
    message: `OpenWeft process ended with status ${terminalStatus}.`,
    data: {
      status: terminalStatus,
      finalHead: diagnostics.headCommit,
      plannedCount: input.plannedCount,
      mergedCount: input.mergedCount,
      queue: input.checkpoint.queue,
      unresolvedFailedFeatureIds,
      mergeDurability,
      runtimeCleanup
    }
  });

  return {
    event,
    status: terminalStatus,
    finalHead: diagnostics.headCommit,
    unresolvedFailedFeatureIds,
    mergeDurability,
    runtimeCleanup,
    diagnostics
  };
};
