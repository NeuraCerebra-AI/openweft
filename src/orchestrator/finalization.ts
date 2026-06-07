import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

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
  retryAttempts?: number;
  credentialScrub?: 'not-needed' | 'scrubbed' | 'scrub-failed';
  credentialResidueCount?: number;
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

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Best-effort scrub of copied worker credentials (`auth.json`) left behind when
 * codex-home cleanup fails. Recursively walks the codex-home tree, removing every
 * file named exactly `auth.json`. Symbolic links encountered during the walk are
 * skipped (never followed out of the directory). Missing directories (ENOENT) and
 * any other error are tolerated — this function never throws. Returns the number
 * of credential files removed and how many remain present after the attempt.
 *
 * Note: only ever called with OpenWeft's own `config.paths.codexHomeDir`
 * (`.openweft/codex-home`), never the operator's real `~/.codex`, so the walk root
 * is a trusted, OpenWeft-managed path.
 */
export const scrubCodexHomeCredentials = async (
  codexHomeDir: string
): Promise<{ removed: number; remaining: number }> => {
  let removed = 0;
  let remaining = 0;

  const walk = async (rootDir: string): Promise<void> => {
    const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(rootDir, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.name === 'auth.json') {
        try {
          await rm(absolutePath, { force: true });
          removed += 1;
        } catch {
          remaining += 1;
        }
      }
    }
  };

  await walk(codexHomeDir).catch(() => undefined);

  return { removed, remaining };
};

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

  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(input.config.paths.codexHomeDir, { recursive: true, force: true });
      return {
        policy,
        action: 'cleaned',
        error: null,
        retryAttempts: attempt
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await delay(150);
      }
    }
  }

  const scrub = await scrubCodexHomeCredentials(input.config.paths.codexHomeDir);
  return {
    policy,
    action: 'cleanup-failed',
    error: lastError instanceof Error ? lastError.message : String(lastError),
    retryAttempts: maxAttempts,
    credentialScrub: scrub.remaining === 0 ? 'scrubbed' : 'scrub-failed',
    credentialResidueCount: scrub.remaining
  };
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

  // Behavior change C2: a codex-home cleanup failure no longer downgrades a
  // completed run to failed. The merged code is durable, so the run stays
  // completed; the failure is surfaced loudly (warn) in the terminal audit and
  // any copied worker credentials are best-effort scrubbed. (Block A downgrade
  // removed — merge-durability downgrade above is intentionally preserved.)

  // Re-collect diagnostics so the residue re-check below reflects the state
  // after the cleanup attempt.
  diagnostics = await collectDiagnostics(input.config, input.checkpoint);

  if (runtimeCleanup.action === 'cleaned' && diagnostics.runtimeArtifacts.codexHomePresent) {
    // Cleanup reported success but a re-collected diagnostic still shows
    // codex-home present. Scrub copied credentials and surface the failure
    // without downgrading the run (Block B downgrade removed).
    const scrub = await scrubCodexHomeCredentials(input.config.paths.codexHomeDir);
    runtimeCleanup = {
      ...runtimeCleanup,
      action: 'cleanup-failed',
      error: 'codex-home still exists after cleanup attempt',
      credentialScrub: scrub.remaining === 0 ? 'scrubbed' : 'scrub-failed',
      credentialResidueCount: scrub.remaining
    };
    diagnostics = await collectDiagnostics(input.config, input.checkpoint);
  }

  const unresolvedFailedFeatureIds = Object.values(input.checkpoint.features)
    .filter((feature) => feature.status === 'failed')
    .map((feature) => feature.id);
  const event = toTerminalEvent(terminalStatus);

  const cleanupFailed = runtimeCleanup.action === 'cleanup-failed';
  const auditMessage = cleanupFailed
    ? `OpenWeft process ended with status ${terminalStatus}. Codex-home cleanup failed (${runtimeCleanup.error ?? 'unknown error'}); copied worker credentials were ${runtimeCleanup.credentialScrub ?? 'not scrubbed'}.`
    : `OpenWeft process ended with status ${terminalStatus}.`;

  await appendAuditEntry(input.config.paths.auditLogFile, {
    timestamp: timestamp(),
    level: terminalStatus === 'failed' || cleanupFailed ? 'warn' : 'info',
    event,
    message: auditMessage,
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
