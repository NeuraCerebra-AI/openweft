import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { FeatureCheckpoint } from '../state/checkpoint.js';
import { getHeadCommit, isCommitAncestor } from '../git/index.js';

export type MergeDurabilityCheckResult = 'verified' | 'missing-merge-commit' | 'not-reachable';

export interface MergeDurabilityCheck {
  featureId: string;
  mergeCommit: string | null;
  result: MergeDurabilityCheckResult;
}

export interface RuntimeDiagnostics {
  checkpointTimestamps: {
    primaryUpdatedAt: string | null;
    backupUpdatedAt: string | null;
  };
  headCommit: string | null;
  mergeDurability: {
    totalCompletedFeatures: number;
    verifiedCount: number;
    checks: readonly MergeDurabilityCheck[];
  };
  runtimeArtifacts: {
    codexHomePresent: boolean;
    residueFileCount: number;
  };
}

export const summarizeMergeDurability = (
  mergeDurability: RuntimeDiagnostics['mergeDurability']
): string => {
  const failingCheck = mergeDurability.checks.find((check) => check.result !== 'verified');
  if (!failingCheck) {
    return `verified (${mergeDurability.verifiedCount}/${mergeDurability.totalCompletedFeatures} completed features)`;
  }

  if (failingCheck.result === 'missing-merge-commit') {
    return `FAILED (${failingCheck.featureId} is missing a recorded merge commit)`;
  }

  return `FAILED (${failingCheck.featureId} not reachable from current HEAD)`;
};

const countResidueFiles = async (rootDir: string): Promise<number> => {
  const entries = await readdir(rootDir, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      total += await countResidueFiles(absolutePath);
      continue;
    }

    if (
      entry.name.endsWith('.sqlite') ||
      entry.name.endsWith('.sqlite-shm') ||
      entry.name.endsWith('.sqlite-wal') ||
      entry.name.endsWith('.jsonl')
    ) {
      total += 1;
    }
  }

  return total;
};

const readCheckpointUpdatedAt = async (checkpointFile: string): Promise<string | null> => {
  try {
    const parsed = JSON.parse(await readFile(checkpointFile, 'utf8')) as { updatedAt?: unknown };
    return typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null;
  } catch {
    return null;
  }
};

const buildMergeDurabilityChecks = async (input: {
  repoRoot: string;
  headCommit: string | null;
  completedFeatures: FeatureCheckpoint[];
}): Promise<MergeDurabilityCheck[]> => {
  if (!input.headCommit) {
    return input.completedFeatures.map((feature) => ({
      featureId: feature.id,
      mergeCommit: feature.mergeCommit ?? null,
      result: feature.mergeCommit ? 'not-reachable' : 'missing-merge-commit'
    }));
  }

  const headCommit = input.headCommit;
  const checks = await Promise.all(input.completedFeatures.map(async (feature) => {
    const mergeCommit = feature.mergeCommit?.trim() ?? '';
    if (!mergeCommit) {
      return {
        featureId: feature.id,
        mergeCommit: null,
        result: 'missing-merge-commit' as const
      };
    }

    const isReachable = await isCommitAncestor(input.repoRoot, mergeCommit, headCommit);
    return {
      featureId: feature.id,
      mergeCommit,
      result: isReachable ? 'verified' as const : 'not-reachable' as const
    };
  }));

  return checks;
};

export const collectRuntimeDiagnostics = async (input: {
  repoRoot: string;
  checkpointFile: string;
  checkpointBackupFile: string;
  codexHomeDir: string;
  completedFeatures: FeatureCheckpoint[];
}): Promise<RuntimeDiagnostics> => {
  const headCommit = await getHeadCommit(input.repoRoot).then((value) => value.trim()).catch(() => null);
  const [primaryUpdatedAt, backupUpdatedAt, codexHomePresent, residueFileCount, checks] = await Promise.all([
    readCheckpointUpdatedAt(input.checkpointFile),
    readCheckpointUpdatedAt(input.checkpointBackupFile),
    readdir(input.codexHomeDir).then(() => true).catch(() => false),
    countResidueFiles(input.codexHomeDir).catch(() => 0),
    buildMergeDurabilityChecks({
      repoRoot: input.repoRoot,
      headCommit,
      completedFeatures: input.completedFeatures
    })
  ]);

  const verifiedCount = checks.filter((check) => check.result === 'verified').length;

  return {
    checkpointTimestamps: {
      primaryUpdatedAt,
      backupUpdatedAt
    },
    headCommit,
    mergeDurability: {
      totalCompletedFeatures: input.completedFeatures.length,
      verifiedCount,
      checks
    },
    runtimeArtifacts: {
      codexHomePresent,
      residueFileCount
    }
  };
};

export const summarizeCurrentHeadCheck = (diagnostics: RuntimeDiagnostics): string => {
  return summarizeMergeDurability(diagnostics.mergeDurability);
};

export const summarizeRuntimeArtifacts = (diagnostics: RuntimeDiagnostics): string => {
  if (!diagnostics.runtimeArtifacts.codexHomePresent) {
    return 'codex-home missing';
  }

  return `preserved (${diagnostics.runtimeArtifacts.residueFileCount} residue files under .openweft/codex-home)`;
};

export const buildCompactDiagnosticsSummary = (diagnostics: RuntimeDiagnostics): string => {
  const headCheckSummary = summarizeCurrentHeadCheck(diagnostics);
  const artifactSummary = summarizeRuntimeArtifacts(diagnostics);
  return `HEAD check: ${headCheckSummary}; Artifacts: ${artifactSummary}`;
};
