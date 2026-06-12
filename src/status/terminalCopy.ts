import { classifyError } from '../domain/errors.js';
import type { OrchestratorCheckpoint } from '../state/checkpoint.js';
import { isActionableFeature, isReviewFeatureStatus } from '../state/recovery.js';

import { summarizeCurrentHeadCheck, type RuntimeDiagnostics } from './runtimeDiagnostics.js';

export type TerminalCopySeverity = 'info' | 'success' | 'warning' | 'error';

export interface TerminalRunCopy {
  severity: TerminalCopySeverity;
  health: string;
  meaning: string;
  nextAction: string;
  details: string[];
}

const hasFailedDurability = (diagnostics: RuntimeDiagnostics | undefined): boolean =>
  Boolean(diagnostics?.mergeDurability.checks.some((check) => check.result !== 'verified'));

const featureErrors = (checkpoint: OrchestratorCheckpoint | null): string[] =>
  checkpoint ? Object.values(checkpoint.features).flatMap((feature) => feature.lastError ? [feature.lastError] : []) : [];

const hasActionableCheckpointWork = (
  checkpoint: OrchestratorCheckpoint | null,
  pendingQueueCount: number
): boolean => {
  if (pendingQueueCount > 0) {
    return true;
  }

  if (!checkpoint) {
    return false;
  }

  if ((checkpoint.pendingMergeSummaries ?? []).length > 0) {
    return true;
  }

  return Object.values(checkpoint.features).some((feature) => isActionableFeature(feature));
};

const hasReviewWork = (checkpoint: OrchestratorCheckpoint | null): boolean =>
  Boolean(checkpoint && Object.values(checkpoint.features).some((feature) => isReviewFeatureStatus(feature.status)));

const firstClassifiedErrorTier = (checkpoint: OrchestratorCheckpoint | null): string | null => {
  for (const error of featureErrors(checkpoint)) {
    const classified = classifyError(error);
    if (classified.tier === 'fatal') {
      if (/auth|not logged in|api key|unauthorized/i.test(error)) {
        return 'auth';
      }
      if (/permission denied|eacces|eperm|operation not permitted/i.test(error)) {
        return 'permission';
      }
    }
  }

  return null;
};

export const buildTerminalRunCopy = (input: {
  checkpoint: OrchestratorCheckpoint | null;
  checkpointSource: 'primary' | 'backup' | 'none' | undefined;
  pendingQueueCount: number;
  diagnostics?: RuntimeDiagnostics;
  background?: {
    pid: number;
    alive: boolean;
  } | null;
}): TerminalRunCopy => {
  const details: string[] = [];
  const checkpoint = input.checkpoint;

  if (hasFailedDurability(input.diagnostics)) {
    return {
      severity: 'error',
      health: 'Durability check failed',
      meaning: `OpenWeft recorded completed work that is not fully reachable from current HEAD. ${summarizeCurrentHeadCheck(input.diagnostics!)}`,
      nextAction: 'Inspect git history and the audit trail before continuing or rerunning work.',
      details
    };
  }

  if (input.checkpointSource === 'backup') {
    return {
      severity: 'warning',
      health: 'Recovered from backup checkpoint',
      meaning: 'The primary checkpoint could not be used, so OpenWeft is showing the backup snapshot.',
      nextAction: 'Inspect the checkpoint details, then run openweft start only when the backup state matches what you expect.',
      details
    };
  }

  const setupFailure = firstClassifiedErrorTier(checkpoint);
  if (setupFailure === 'auth') {
    return {
      severity: 'error',
      health: 'Authentication needed',
      meaning: 'The selected backend could not authenticate, so OpenWeft cannot trust another agent turn yet.',
      nextAction: 'Log in to the backend CLI or configure the required API key, then run openweft start again.',
      details
    };
  }

  if (setupFailure === 'permission') {
    return {
      severity: 'error',
      health: 'Permission blocked',
      meaning: 'The backend command or filesystem operation was blocked by local permissions.',
      nextAction: 'Fix the permission or access problem shown below, then run openweft start again.',
      details
    };
  }

  if (hasReviewWork(checkpoint)) {
    return {
      severity: 'error',
      health: 'Review needed',
      meaning: 'Some work needs an operator review before OpenWeft can safely schedule it.',
      nextAction: 'Review the listed feature plans/errors, then rerun openweft start after resolving them.',
      details
    };
  }

  if (checkpoint?.status === 'stopped') {
    if (hasActionableCheckpointWork(checkpoint, input.pendingQueueCount)) {
      return {
        severity: 'warning',
        health: 'Stopped with resumable work',
        meaning: 'The previous run stopped at a phase-safe point and still has actionable work recorded.',
        nextAction: 'Run openweft resume or openweft start to continue from the same checkpoint.',
        details
      };
    }

    return {
      severity: 'info',
      health: 'Stopped',
      meaning: 'The previous run stopped and there is no automatically actionable work left.',
      nextAction: 'Add more work with openweft add or inspect the run history before starting again.',
      details
    };
  }

  if (checkpoint?.status === 'failed') {
    return {
      severity: 'error',
      health: 'Failed',
      meaning: 'OpenWeft stopped with unresolved failed work.',
      nextAction: 'Read the failed feature details below, fix the cause, then run openweft start again.',
      details
    };
  }

  if (input.background) {
    if (input.background.alive) {
      return {
        severity: 'info',
        health: 'Running in background',
        meaning: `OpenWeft is running as PID ${input.background.pid}; live output is written to .openweft/output.log.`,
        nextAction: 'Use openweft status to check progress or tail .openweft/output.log for raw output.',
        details
      };
    }

    return {
      severity: 'warning',
      health: 'Background PID is stale',
      meaning: `OpenWeft has a recorded background PID ${input.background.pid}, but it is not running.`,
      nextAction: 'Run openweft status for the checkpoint result, then run openweft start if work remains.',
      details
    };
  }

  if (checkpoint?.status === 'completed') {
    return {
      severity: 'success',
      health: 'Completed',
      meaning: 'All schedulable work in the current checkpoint has finished.',
      nextAction: 'Review the completed features, merge output, and audit trail before adding more work.',
      details
    };
  }

  if (checkpoint?.status === 'in-progress') {
    // This branch is only reached when no live OpenWeft process is recorded
    // (a verified live run returns from the background branch above), so the
    // run was interrupted: advising `openweft stop` here would contradict the
    // stop handler, which would correctly report that nothing is running.
    return {
      severity: 'warning',
      health: 'Interrupted',
      meaning: 'The checkpoint reports an in-progress run, but no live OpenWeft process is recorded — the previous run likely crashed or was killed.',
      nextAction: 'Run openweft start to resume from the last checkpoint.',
      details
    };
  }

  if (input.pendingQueueCount > 0) {
    return {
      severity: 'info',
      health: 'Ready',
      meaning: 'There is queued work waiting to be planned and scheduled.',
      nextAction: 'Run openweft start to process the pending queue.',
      details
    };
  }

  return {
    severity: 'info',
    health: 'Idle',
    meaning: 'OpenWeft is not currently running.',
    nextAction: 'Add work with openweft add, then start the run with openweft start.',
    details
  };
};
