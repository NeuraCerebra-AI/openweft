import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import PQueue from 'p-queue';
import { simpleGit } from 'simple-git';

import {
  buildConflictResolutionPrompt,
  buildExecutionPrompt,
  CODE_EDIT_SUMMARY_MARKER,
  injectPromptTemplate,
  USER_REQUEST_MARKER
} from '../adapters/prompts.js';
import type { AgentAdapter, AdapterCommandSpec, AdapterTurnRequest, AdapterTurnResult } from '../adapters/types.js';
import type { OrchestratorEventHandler } from '../ui/events.js';
import type { ResolvedOpenWeftConfig } from '../config/index.js';
import { addCostRecordToTotals, type CostRecord } from '../domain/costs.js';
import { listEditSummaryPaths, type EditSummary } from '../domain/editSummary.js';
import { circuitBreakerTripped, classifyError } from '../domain/errors.js';
import { createPlanFilename, createPromptBFilename, formatFeatureId, slugifyFeatureRequest } from '../domain/featureIds.js';
import { assertLedgerSection, parseManifestDocument, type Manifest, updateManifestInMarkdown } from '../domain/manifest.js';
import { buildExecutionPhases } from '../domain/phases.js';
import type { PriorityTier } from '../domain/primitives.js';
import {
  getNextFeatureIdFromQueue,
  buildQueueContentFromCheckpointState,
  markQueueLineProcessed,
  parseQueueFile,
  summarizeQueueRequest
} from '../domain/queue.js';
import { scoreQueue, type FeatureScoreBreakdown, type RepoRiskContext } from '../domain/scoring.js';
import {
  appendTextFile,
  appendJsonLine,
  ensureRuntimeDirectories,
  pathExists,
  readTextFileIfExists,
  readTextFileWithRetry,
  writeTextFileAtomic
} from '../fs/index.js';
import {
  abortMerge,
  commitAllChanges,
  createWorktree,
  getAutoGcSetting,
  getHeadCommit,
  getWorktreeStatusSummary,
  hasChangesSince,
  mergeBranchIntoCurrent,
  mergeBranchIntoWorktree,
  pruneOrphanedOpenWeftArtifacts,
  removeWorktree,
  resetWorktreeToHead,
  restoreAutoGc,
  setAutoGc
} from '../git/index.js';
import { findReusableExecutionCommit } from '../git/worktrees.js';
import { sendOpenWeftNotification, type NotificationDependencies, type NotificationResult } from '../notifications/index.js';
import {
  createEmptyCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  type FeatureCheckpoint,
  type OrchestratorCheckpoint
} from '../state/checkpoint.js';
import { getTmuxSlotLogFile, type TmuxMonitor } from '../tmux/index.js';
import { OPENWEFT_VERSION } from '../version.js';
import { appendAuditEntry } from './audit.js';
import { TurnApprovalError } from './approval.js';
import { repairPlanMarkdownIfNeeded } from './planMarkdown.js';
import type { ApprovalController } from './approval.js';
import type { StopController } from './stop.js';

const STAGE_ONE_MIN_LENGTH = 10;
const MAX_SCORING_FILE_BYTES = 512 * 1024;
const MAX_FULL_FEATURE_RERUNS = 2;
const MAX_TOTAL_EXECUTION_PASSES = MAX_FULL_FEATURE_RERUNS + 1;
const MAX_MERGE_RESOLUTION_ROUNDS = 3;
const PROMPT_B_FENCE_PATTERN = /```(?:md|markdown)\s*\n/i;
const RECOVERABLE_PLANNING_ERROR_PATTERNS = [
  'Claude output did not include a result string.',
  'Planning stage 1 returned too little output',
  'No ledger section found under a "## Ledger" heading.',
  'Failed to extract manifest for feature'
] as const;
const BINARY_SCORING_EXTENSIONS = new Set([
  '.bmp',
  '.class',
  '.dll',
  '.dylib',
  '.exe',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.o',
  '.otf',
  '.pdf',
  '.png',
  '.so',
  '.ttf',
  '.wasm',
  '.webp',
  '.woff',
  '.woff2',
  '.zip'
]);
const ACTIONABLE_CHECKPOINT_FEATURE_STATUSES = new Set<FeatureCheckpoint['status']>([
  'pending',
  'planned',
  'executing',
  'failed'
]);
const RECOVERABLE_EXECUTION_STATUSES = new Set<FeatureCheckpoint['status']>(['planned', 'executing']);
const PROMPT_B_SAVE_FAILURE_PATTERN = /\b(?:could not|can't|cannot|failed to|unable to)\s+(?:save|write)\b/i;
const PROMPT_B_WRITE_FAILURE_CONTEXT_PATTERN =
  /\b(?:read-only|operation not permitted|permission denied|sandbox)\b/i;

const looksLikeWrappedPromptBSaveFailure = (preamble: string): boolean => {
  if (preamble.trim().length === 0) {
    return false;
  }

  return (
    PROMPT_B_SAVE_FAILURE_PATTERN.test(preamble) ||
    (PROMPT_B_WRITE_FAILURE_CONTEXT_PATTERN.test(preamble) &&
      /\b(?:save|write|intended path)\b/i.test(preamble))
  );
};

const sanitizePromptBMarkdown = (raw: string): string => {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(PROMPT_B_FENCE_PATTERN);
  const fenceIndex = fenceMatch?.index ?? -1;

  if (fenceIndex > 0 && looksLikeWrappedPromptBSaveFailure(trimmed.slice(0, fenceIndex))) {
    const matchedFence = fenceMatch?.[0];
    if (matchedFence) {
      const contentStart = fenceIndex + matchedFence.length;
      const contentEnd = trimmed.lastIndexOf('\n```');
      if (contentEnd > contentStart) {
        return `${trimmed.slice(contentStart, contentEnd).trimEnd()}\n`;
      }
    }
  }

  const headingIndex = trimmed.search(/^#{1,6}\s+\S/m);
  if (headingIndex > 0 && looksLikeWrappedPromptBSaveFailure(trimmed.slice(0, headingIndex))) {
    return `${trimmed.slice(headingIndex).trimEnd()}\n`;
  }

  return `${trimmed}\n`;
};

interface OrchestratorOutput {
  checkpoint: OrchestratorCheckpoint;
  mergedCount: number;
  plannedCount: number;
}

interface RealRunInput {
  config: ResolvedOpenWeftConfig;
  configHash: string;
  adapter: AgentAdapter;
  stopController?: StopController;
  streamOutput?: boolean;
  tmuxRequested?: boolean;
  tmuxMonitor?: TmuxMonitor;
  writeLine?: (message: string) => void;
  notificationDependencies?: NotificationDependencies;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: OrchestratorEventHandler;
  approvalController?: ApprovalController;
}

interface RealRunContext extends RealRunInput {
  checkpoint: OrchestratorCheckpoint;
  mergedCount: number;
  plannedCount: number;
  error: string | null;
  recoveredExecutions: Map<string, RecoveredExecutionResult>;
  resumeReanalysisPhaseIndex: number | null;
  approvalState: RunApprovalState;
}

interface RecoveredExecutionResult {
  featureId: string;
  status: 'completed';
  allowFullRerun: false;
  branchName: string;
  worktreePath: string;
  sessionId: null;
  baselineCommit: null;
  evolvedPlanFile: null;
}

interface RunApprovalState {
  firstApprovalSatisfied: boolean;
  approvedFeatureIds: Set<string>;
  firstApprovalPending: Promise<void> | null;
  featureApprovalPending: Map<string, Promise<void>>;
}

const timestamp = (): string => new Date().toISOString();

const isRecoverablePlanningError = (message: string): boolean =>
  RECOVERABLE_PLANNING_ERROR_PATTERNS.some((pattern) => message.includes(pattern));

const cloneCheckpoint = (checkpoint: OrchestratorCheckpoint): OrchestratorCheckpoint => {
  return structuredClone(checkpoint);
};

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

const createFreshCheckpoint = (configHash: string): OrchestratorCheckpoint => {
  const createdAt = timestamp();

  return createEmptyCheckpoint({
    orchestratorVersion: OPENWEFT_VERSION,
    configHash,
    runId: randomUUID(),
    checkpointId: randomUUID(),
    createdAt
  });
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

const getAutoGcBreadcrumbFile = (config: ResolvedOpenWeftConfig): string => {
  return path.join(config.paths.openweftDir, 'gc-auto-previous.json');
};

const restoreAutoGcFromBreadcrumb = async (
  config: ResolvedOpenWeftConfig
): Promise<boolean> => {
  const breadcrumbFile = getAutoGcBreadcrumbFile(config);
  const breadcrumbText = await readTextFileIfExists(breadcrumbFile);
  if (!breadcrumbText) {
    return false;
  }

  const parsed = JSON.parse(breadcrumbText) as {
    previousValue?: unknown;
  };
  if (parsed.previousValue !== null && typeof parsed.previousValue !== 'string') {
    throw new Error(`Invalid gc.auto breadcrumb at ${breadcrumbFile}.`);
  }

  await restoreAutoGc(config.repoRoot, parsed.previousValue ?? null);
  await rm(breadcrumbFile, { force: true });
  return true;
};

const pruneOrphanedOpenWeftArtifactsAtStartup = async (
  config: ResolvedOpenWeftConfig
): Promise<{
  removedWorktreePaths: string[];
  removedBranchNames: string[];
}> => {
  const checkpointResult = await loadCheckpoint({
    checkpointFile: config.paths.checkpointFile,
    checkpointBackupFile: config.paths.checkpointBackupFile
  });
  const retainedFeatures = checkpointResult.checkpoint
    ? Object.values(checkpointResult.checkpoint.features).filter((feature) =>
        ACTIONABLE_CHECKPOINT_FEATURE_STATUSES.has(feature.status)
      )
    : [];

  return pruneOrphanedOpenWeftArtifacts({
    repoRoot: config.repoRoot,
    worktreesDir: config.paths.worktreesDir,
    retainedWorktreePaths: retainedFeatures.map((feature) => feature.worktreePath),
    retainedBranchNames: retainedFeatures.map((feature) => feature.branchName)
  });
};

const appendCostRecord = async (
  config: ResolvedOpenWeftConfig,
  checkpoint: OrchestratorCheckpoint,
  record: CostRecord
): Promise<void> => {
  await appendJsonLine(config.paths.costsFile, record);
  checkpoint.cost = addCostRecordToTotals(checkpoint.cost, record);
};

const listMarkdownFiles = async (directoryPath: string): Promise<string[]> => {
  try {
    const entries = await readdir(directoryPath);
    return entries.filter((entry) => entry.endsWith('.md'));
  } catch {
    return [];
  }
};

const createPromptBArtifactPath = (
  config: ResolvedOpenWeftConfig,
  featureId: string,
  request: string
): string => {
  const promptBFilename = createPromptBFilename(
    Number.parseInt(featureId, 10),
    request
  );
  return path.join(config.paths.promptBArtifactsDir, promptBFilename);
};

const countFeatureStatuses = (
  checkpoint: OrchestratorCheckpoint,
  statuses: FeatureCheckpoint['status'][]
): number => {
  const statusSet = new Set(statuses);
  return Object.values(checkpoint.features).filter((feature) => statusSet.has(feature.status)).length;
};

const updateFeatureCheckpoint = (
  checkpoint: OrchestratorCheckpoint,
  featureId: string,
  patch: Partial<FeatureCheckpoint>
): void => {
  const existing = checkpoint.features[featureId];
  if (!existing) {
    throw new Error(`Feature ${featureId} is not present in the checkpoint.`);
  }

  checkpoint.features[featureId] = {
    ...existing,
    ...patch,
    updatedAt: timestamp()
  };
};

const shouldScheduleFullFeatureRerun = (
  result: Pick<ExecutionAttemptResult, 'status' | 'allowFullRerun'>,
  attempts: number
): boolean => {
  return result.status === 'failed' && result.allowFullRerun && attempts < MAX_TOTAL_EXECUTION_PASSES;
};

const resolveReusableSessionId = (
  feature: Pick<FeatureCheckpoint, 'sessionId' | 'sessionScope'>,
  desiredScope: 'repo' | 'worktree'
): string | null => {
  return feature.sessionId && feature.sessionScope === desiredScope ? feature.sessionId : null;
};

const writeShadowPlan = async (
  config: ResolvedOpenWeftConfig,
  featureId: string,
  markdown: string
): Promise<string> => {
  const shadowFile = path.join(config.paths.shadowPlansDir, `${featureId}.md`);
  await writeTextFileAtomic(shadowFile, markdown);
  return shadowFile;
};

const maybeReadShadowPlan = async (
  config: ResolvedOpenWeftConfig,
  featureId: string
): Promise<string | null> => {
  const shadowFile = path.join(config.paths.shadowPlansDir, `${featureId}.md`);
  return readTextFileIfExists(shadowFile);
};

const updateQueueOrdering = (
  checkpoint: OrchestratorCheckpoint,
  scores: FeatureScoreBreakdown[]
): void => {
  checkpoint.queue = {
    orderedFeatureIds: scores.map((score) => score.id),
    totalCount: scores.length
  };

  for (const [index, score] of scores.entries()) {
    const existing = checkpoint.features[score.id];
    if (!existing) {
      continue;
    }

    checkpoint.features[score.id] = {
      ...existing,
      priorityScore: score.smoothedPriority,
      priorityTier: score.tier,
      scoringCycles: (existing.scoringCycles ?? 0) + 1,
      updatedAt: timestamp()
    };

    checkpoint.queue.orderedFeatureIds[index] = score.id;
  }
};

const isExecutionEligibleFeature = (
  feature: Pick<FeatureCheckpoint, 'status' | 'rerunEligible'>
): boolean => {
  return feature.status === 'planned' || (feature.status === 'failed' && feature.rerunEligible);
};

const getExecutionEligibleFeatures = (
  checkpoint: OrchestratorCheckpoint
): FeatureCheckpoint[] => {
  return Object.values(checkpoint.features).filter((feature) => isExecutionEligibleFeature(feature));
};

const getBackendAuth = (
  config: ResolvedOpenWeftConfig,
  adapter: AgentAdapter
): AdapterTurnRequest['auth'] => {
  if (adapter.backend === 'claude') {
    return config.auth.claude.envVar
      ? { method: config.auth.claude.method, envVar: config.auth.claude.envVar }
      : { method: config.auth.claude.method };
  }

  if (adapter.backend === 'codex') {
    return config.auth.codex.envVar
      ? { method: config.auth.codex.method, envVar: config.auth.codex.envVar }
      : { method: config.auth.codex.method };
  }

  return { method: 'subscription' };
};

const getBackendModel = (
  config: ResolvedOpenWeftConfig,
  adapter: AgentAdapter
): string => {
  if (adapter.backend === 'claude') {
    return config.models.claude;
  }

  if (adapter.backend === 'codex') {
    return config.models.codex;
  }

  return 'mock-model';
};

const getBackendEffortLevel = (
  config: ResolvedOpenWeftConfig,
  adapter: AgentAdapter
): AdapterTurnRequest['effortLevel'] => {
  if (adapter.backend === 'claude') {
    return config.effort.claude;
  }

  if (adapter.backend === 'codex') {
    return config.effort.codex;
  }

  return undefined;
};

const getBackendEffortConfig = (
  config: ResolvedOpenWeftConfig,
  adapter: AgentAdapter
): Pick<AdapterTurnRequest, 'effortLevel'> | Record<never, never> => {
  const effortLevel = getBackendEffortLevel(config, adapter);

  return effortLevel ? { effortLevel } : {};
};

const buildCodexHomeDir = (
  config: ResolvedOpenWeftConfig,
  featureId: string,
  scope: 'planning-s1' | 'planning-s2' | 'session'
): string => {
  return path.join(config.paths.openweftDir, 'codex-home', `${featureId}-${scope}`);
};

const shouldPauseForBudget = (config: ResolvedOpenWeftConfig, checkpoint: OrchestratorCheckpoint): boolean => {
  const pauseAt = config.budget.pauseAtUsd;
  return pauseAt !== null && checkpoint.cost.totalEstimatedUsd >= pauseAt;
};

const shouldStopForBudget = (config: ResolvedOpenWeftConfig, checkpoint: OrchestratorCheckpoint): boolean => {
  const stopAt = config.budget.stopAtUsd;
  return stopAt !== null && checkpoint.cost.totalEstimatedUsd >= stopAt;
};

const isMissingBranchError = (error: unknown): boolean => {
  return error instanceof Error && /branch.+not found|not a valid branch/i.test(error.message);
};

const maybeNotify = async (
  input: RealRunInput,
  message: string
): Promise<NotificationResult | null> => {
  try {
    return await sendOpenWeftNotification(
      {
        message
      },
      input.notificationDependencies
    );
  } catch {
    return null;
  }
};

const emitProgress = (input: RealRunInput, message: string): void => {
  input.writeLine?.(message);
};

const announceProgress = async (input: RealRunInput, message: string): Promise<void> => {
  emitProgress(input, message);
  await maybeNotify(input, message);
};

const emitOrchestratorEvent = (
  input: RealRunInput,
  event: Parameters<OrchestratorEventHandler>[0]
): void => {
  input.onEvent?.(event);
};

const getAgentName = (
  checkpoint: OrchestratorCheckpoint,
  featureId: string
): string => {
  const feature = checkpoint.features[featureId];
  if (!feature) {
    return featureId;
  }

  return `${feature.id} ${feature.title?.trim() || feature.request.trim()}`;
};

const getAgentFeature = (
  checkpoint: OrchestratorCheckpoint,
  featureId: string,
  stage: AdapterTurnRequest['stage']
): string => {
  const feature = checkpoint.features[featureId];
  if (!feature) {
    return stage;
  }

  return feature.title?.trim() || feature.request.trim();
};

const getFeatureCostUsd = (
  checkpoint: OrchestratorCheckpoint,
  featureId: string
): number => {
  return checkpoint.cost.perFeature[featureId]?.usd ?? 0;
};

const turnNeedsApproval = (stage: AdapterTurnRequest['stage']): boolean => {
  return stage === 'execution' || stage === 'adjustment' || stage === 'conflict-resolution';
};

const turnRequiresInteractiveApproval = (
  input: RealRunContext,
  request: AdapterTurnRequest
): boolean => {
  if (!turnNeedsApproval(request.stage)) {
    return false;
  }

  if (input.config.approval === 'always') {
    return false;
  }

  if (input.config.approval === 'first-only') {
    return !input.approvalState.firstApprovalSatisfied;
  }

  return !input.approvalState.approvedFeatureIds.has(request.featureId);
};

const syncCheckpointApprovalState = (
  checkpoint: OrchestratorCheckpoint,
  approvalState: RunApprovalState
): void => {
  checkpoint.approvalState = {
    firstApprovalSatisfied: approvalState.firstApprovalSatisfied,
    approvedFeatureIds: [...approvalState.approvedFeatureIds].sort()
  };
};

const buildApprovalRequest = (
  input: RealRunInput,
  request: AdapterTurnRequest
): { file: string; action: string; detail: string } => {
  const relativeCwd = path.relative(input.config.repoRoot, request.cwd) || '.';

  return {
    file: relativeCwd,
    action: request.stage,
    detail: `Allow ${input.adapter.backend} to run ${request.stage} for feature ${request.featureId} in ${relativeCwd}.`
  };
};

const maybeAwaitTurnApproval = async (
  input: RealRunContext,
  checkpoint: OrchestratorCheckpoint,
  request: AdapterTurnRequest
): Promise<void> => {
  if (!turnRequiresInteractiveApproval(input, request)) {
    return;
  }

  if (!input.approvalController) {
    throw new Error(
      `Approval mode "${input.config.approval}" requires an approval controller.`
    );
  }

  const requestApproval = async (): Promise<void> => {
    const decision = await input.approvalController!.requestApproval({
      agentId: request.featureId,
      request: buildApprovalRequest(input, request)
    });

    if (decision === 'approve') {
      input.approvalState.firstApprovalSatisfied = true;
      input.approvalState.approvedFeatureIds.add(request.featureId);
      syncCheckpointApprovalState(checkpoint, input.approvalState);
      await saveCheckpointSnapshot(input.config, checkpoint);
      return;
    }

    const skipWasRequestedForShutdown =
      decision === 'skip' && (input.stopController?.isRequested ?? false);

    if (!skipWasRequestedForShutdown) {
      emitOrchestratorEvent(input, {
        type: 'agent:failed',
        agentId: request.featureId,
        error:
          decision === 'deny'
            ? `User denied ${request.stage} for feature ${request.featureId}.`
            : `User skipped ${request.stage} for feature ${request.featureId}.`
      });
    }

    throw new TurnApprovalError(request.featureId, request.stage, decision);
  };

  if (input.config.approval === 'first-only') {
    while (!input.approvalState.firstApprovalSatisfied) {
      const existingPending = input.approvalState.firstApprovalPending;
      if (existingPending) {
        try {
          await existingPending;
        } catch {
          // Another turn's denial/skip should not force this turn to fail.
        }

        if (input.stopController?.isRequested) {
          throw new TurnApprovalError(request.featureId, request.stage, 'skip');
        }

        if (input.approvalState.firstApprovalSatisfied) {
          return;
        }

        continue;
      }

      let approvalPromise!: Promise<void>;
      approvalPromise = requestApproval().finally(() => {
        if (input.approvalState.firstApprovalPending === approvalPromise) {
          input.approvalState.firstApprovalPending = null;
        }
      });
      input.approvalState.firstApprovalPending = approvalPromise;
      return approvalPromise;
    }

    return;
  }

  const existingFeaturePending = input.approvalState.featureApprovalPending.get(request.featureId);
  if (existingFeaturePending) {
    return existingFeaturePending;
  }

  let approvalPromise!: Promise<void>;
  approvalPromise = requestApproval().finally(() => {
    if (input.approvalState.featureApprovalPending.get(request.featureId) === approvalPromise) {
      input.approvalState.featureApprovalPending.delete(request.featureId);
    }
  });
  input.approvalState.featureApprovalPending.set(request.featureId, approvalPromise);
  return approvalPromise;
};

const appendTmuxSlotLine = async (
  input: RealRunInput,
  slotNumber: number,
  message: string
): Promise<void> => {
  if (!input.tmuxMonitor) {
    return;
  }

  const slotLogFile = getTmuxSlotLogFile(input.tmuxMonitor.logDirectory, slotNumber);
  await appendTextFile(slotLogFile, `[${timestamp()}] ${message}\n`);
};

const buildPlanAdjustmentPrompt = (input: {
  template: string;
  planFilePath: string;
  planContent: string;
  codeEditSummaryJson: string;
}): string => {
  const injectedTemplate = injectPromptTemplate(
    input.template,
    CODE_EDIT_SUMMARY_MARKER,
    input.codeEditSummaryJson
  );

  return [
    'You are re-evaluating a feature implementation plan after recent merged edits.',
    `The plan file to inspect is at ${input.planFilePath}.`,
    'Review the current repository state and determine whether the merged edits interfere with this plan.',
    'Do not write to disk. Return the full plan markdown, including the ## Ledger and ## Manifest sections.',
    'If no changes are needed, return the original plan unchanged.',
    '',
    '=== CURRENT PLAN START ===',
    input.planContent,
    '=== CURRENT PLAN END ===',
    '',
    injectedTemplate
  ].join('\n');
};

const appendAudit = async (
  config: ResolvedOpenWeftConfig,
  entry: {
    level: 'info' | 'warn' | 'error';
    event: string;
    message: string;
    data?: Record<string, unknown>;
  }
): Promise<void> => {
  await appendAuditEntry(config.paths.auditLogFile, {
    timestamp: timestamp(),
    ...entry
  });
};

const sanitizeCommandForAudit = (command: AdapterCommandSpec): Record<string, unknown> => {
  return {
    command: command.command,
    args: command.args,
    cwd: command.cwd
  };
};

const loadOrCreateCheckpoint = async (
  input: RealRunInput
): Promise<{
  checkpoint: OrchestratorCheckpoint;
  recoveredExecutions: Map<string, RecoveredExecutionResult>;
  resumeReanalysisPhaseIndex: number | null;
}> => {
  const existing = await loadCheckpoint({
    checkpointFile: input.config.paths.checkpointFile,
    checkpointBackupFile: input.config.paths.checkpointBackupFile
  });

  if (!existing.checkpoint) {
    return {
      checkpoint: createFreshCheckpoint(input.configHash),
      recoveredExecutions: new Map(),
      resumeReanalysisPhaseIndex: null
    };
  }

  if (
    existing.checkpoint.configHash !== input.configHash &&
    countFeatureStatuses(existing.checkpoint, ['planned', 'executing', 'failed']) > 0
  ) {
    throw new Error(
      'OpenWeft configuration changed while unfinished work remains. Resolve or clear the checkpoint before resuming.'
    );
  }

  const checkpoint = cloneCheckpoint(existing.checkpoint);
  let needsCheckpointSave = false;
  const recoveredExecutions = new Map<string, RecoveredExecutionResult>();
  const repoGit = simpleGit(input.config.repoRoot);
  const baseBranch = (await repoGit.revparse(['--abbrev-ref', 'HEAD'])).trim();
  const repoHeadCommit = (await repoGit.revparse(['HEAD'])).trim();
  const resumeReanalysisPhaseIndex =
    checkpoint.pendingMergeSummaries.length > 0 ? (checkpoint.currentPhase?.index ?? 0) : null;

  if (existing.checkpoint.currentState === 'planning') {
    const existingQueueContent = (await readTextFileIfExists(input.config.paths.queueFile)) ?? '';
    const recoveredQueueContent = buildQueueContentFromCheckpointState({
      existingContent: existingQueueContent,
      processed: Object.values(existing.checkpoint.features).map((feature) => ({
        featureId: feature.id,
        request: feature.request
      })),
      pendingRequests: existing.checkpoint.pendingRequests.map((entry) => entry.request)
    });
    await writeTextFileAtomic(input.config.paths.queueFile, recoveredQueueContent);
    needsCheckpointSave = true;
  }

  if (checkpoint.currentPhase !== null) {
    checkpoint.currentPhase = null;
    needsCheckpointSave = true;
  }
  if (checkpoint.currentState !== 'idle') {
    checkpoint.currentState = 'idle';
    needsCheckpointSave = true;
  }

  for (const feature of Object.values(checkpoint.features)) {
    if (RECOVERABLE_EXECUTION_STATUSES.has(feature.status) || (feature.status === 'failed' && feature.rerunEligible)) {
      let alreadyMerged = false;
      const recovered = await findReusableExecutionCommit({
        repoRoot: input.config.repoRoot,
        worktreesDir: input.config.paths.worktreesDir,
        worktreePath: feature.worktreePath,
        branchName: feature.branchName,
        baseBranch,
        expectedCommitMessage: `openweft: complete feature ${feature.id}`
      });

      if (recovered) {
        if (recovered.kind === 'already-merged') {
          alreadyMerged = true;
          if (!checkpoint.pendingMergeSummaries.some((entry) => entry.featureId === feature.id)) {
            checkpoint.pendingMergeSummaries = [
              ...checkpoint.pendingMergeSummaries,
              {
                featureId: feature.id,
                summary: buildRecoveredMergeSummary(feature, feature.mergeCommit ?? repoHeadCommit)
              }
            ];
          }
          updateFeatureCheckpoint(checkpoint, feature.id, {
            status: 'completed',
            mergeCommit: feature.mergeCommit ?? repoHeadCommit,
            evolvedPlanFile: null,
            branchName: feature.branchName,
            worktreePath: feature.worktreePath,
            sessionId: null,
            sessionScope: null,
            lastError: null,
            rerunEligible: false
          });
          needsCheckpointSave = true;
        } else if (feature.status === 'failed') {
          recoveredExecutions.set(feature.id, {
            featureId: feature.id,
            status: 'completed',
            allowFullRerun: false,
            branchName: recovered.branchName,
            worktreePath: recovered.worktreePath,
            sessionId: null,
            baselineCommit: null,
            evolvedPlanFile: null
          });
          updateFeatureCheckpoint(checkpoint, feature.id, {
            status: 'planned',
            sessionId: null,
            sessionScope: null,
            lastError: null,
            rerunEligible: false
          });
          needsCheckpointSave = true;
        } else {
          recoveredExecutions.set(feature.id, {
            featureId: feature.id,
            status: 'completed',
            allowFullRerun: false,
            branchName: recovered.branchName,
            worktreePath: recovered.worktreePath,
            sessionId: null,
            baselineCommit: null,
            evolvedPlanFile: null
          });
        }
      }

      if (feature.status === 'executing' && !alreadyMerged) {
        feature.status = 'planned';
        feature.sessionId = null;
        feature.sessionScope = null;
        feature.updatedAt = timestamp();
        needsCheckpointSave = true;
      }
    }
  }

  let repairedPromptBFiles = false;
  for (const feature of Object.values(checkpoint.features)) {
    if (!ACTIONABLE_CHECKPOINT_FEATURE_STATUSES.has(feature.status) || recoveredExecutions.has(feature.id)) {
      continue;
    }

    const canonicalPromptBFile = createPromptBArtifactPath(input.config, feature.id, feature.request);
    const configuredPromptBExists = feature.promptBFile ? await pathExists(feature.promptBFile) : false;
    const canonicalPromptBExists = await pathExists(canonicalPromptBFile);

    if (configuredPromptBExists) {
      if (feature.promptBFile !== canonicalPromptBFile && canonicalPromptBExists) {
        updateFeatureCheckpoint(checkpoint, feature.id, {
          promptBFile: canonicalPromptBFile
        });
        repairedPromptBFiles = true;
        needsCheckpointSave = true;
      }
      continue;
    }

    if (canonicalPromptBExists) {
      updateFeatureCheckpoint(checkpoint, feature.id, {
        promptBFile: canonicalPromptBFile
      });
      repairedPromptBFiles = true;
      needsCheckpointSave = true;
      continue;
    }

    if (repairedPromptBFiles) {
      await saveCheckpointSnapshot(input.config, checkpoint);
      repairedPromptBFiles = false;
      needsCheckpointSave = false;
    }

    throw new Error(`Prompt B artifact is missing for actionable feature ${feature.id}.`);
  }

  if (repairedPromptBFiles) {
    await saveCheckpointSnapshot(input.config, checkpoint);
    needsCheckpointSave = false;
  }

  let repairedEvolvedPlanFiles = false;
  for (const feature of Object.values(checkpoint.features)) {
    const canonicalEvolvedPlanFile = buildEvolvedPlanPath(input.config, feature.id);
    const configuredEvolvedPlanExists = feature.evolvedPlanFile
      ? await pathExists(feature.evolvedPlanFile)
      : false;
    const canonicalEvolvedPlanExists = await pathExists(canonicalEvolvedPlanFile);

    if (configuredEvolvedPlanExists) {
      if (feature.evolvedPlanFile !== canonicalEvolvedPlanFile) {
        updateFeatureCheckpoint(checkpoint, feature.id, {
          evolvedPlanFile: canonicalEvolvedPlanFile
        });
        repairedEvolvedPlanFiles = true;
        needsCheckpointSave = true;
      }
      continue;
    }

    if (canonicalEvolvedPlanExists) {
      updateFeatureCheckpoint(checkpoint, feature.id, {
        evolvedPlanFile: canonicalEvolvedPlanFile
      });
      repairedEvolvedPlanFiles = true;
      needsCheckpointSave = true;
      continue;
    }

    if (feature.evolvedPlanFile !== null) {
      updateFeatureCheckpoint(checkpoint, feature.id, {
        evolvedPlanFile: null
      });
      repairedEvolvedPlanFiles = true;
      needsCheckpointSave = true;
    }
  }

  if (repairedEvolvedPlanFiles) {
    await saveCheckpointSnapshot(input.config, checkpoint);
    needsCheckpointSave = false;
  }

  if (needsCheckpointSave) {
    await saveCheckpointSnapshot(input.config, checkpoint);
  }

  return {
    checkpoint,
    recoveredExecutions,
    resumeReanalysisPhaseIndex
  };
};

const collectScoringPaths = async (
  repoRoot: string,
  paths: string[]
): Promise<RepoRiskContext> => {
  const uniquePaths = [...new Set(paths)];
  const sourceFiles: Array<{ path: string; skipContentScan: boolean }> = [];
  const directories = new Set<string>();
  const queue: string[] = [repoRoot];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.openweft') {
        continue;
      }

      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        directories.add(path.relative(repoRoot, entryPath) || '.');
        continue;
      }

      if (entry.isFile()) {
        const fileStats = await stat(entryPath).catch(() => null);
        const skipContentScan =
          (fileStats?.size ?? 0) > MAX_SCORING_FILE_BYTES ||
          BINARY_SCORING_EXTENSIONS.has(path.extname(entry.name).toLowerCase());
        sourceFiles.push({
          path: entryPath,
          skipContentScan
        });
        directories.add(path.relative(repoRoot, path.dirname(entryPath)) || '.');
      }
    }
  }

  const fanInByPath: Record<string, number> = {};
  const normalizedNeedles = uniquePaths.map((targetPath) => {
    const normalized = targetPath.replace(/\\/g, '/');
    return {
      path: normalized,
      exact: normalized,
      withoutExtension: normalized.replace(/\.[^.]+$/, '')
    };
  });

  for (const target of normalizedNeedles) {
    fanInByPath[target.path] = 0;
  }

  for (const sourceFile of sourceFiles) {
    if (sourceFile.skipContentScan) {
      continue;
    }

    const relativeSource = path.relative(repoRoot, sourceFile.path).replace(/\\/g, '/');
    const content = await readFile(sourceFile.path, 'utf8').catch(() => '');

      for (const target of normalizedNeedles) {
        if (relativeSource === target.path) {
          continue;
        }

        // This is intentionally a lightweight heuristic, not a full import graph:
        // substring matches are fast, repository-agnostic, and good enough for coarse fan-in scoring.
        if (
          content.includes(target.exact) ||
          content.includes(target.withoutExtension)
        ) {
        fanInByPath[target.path] = (fanInByPath[target.path] ?? 0) + 1;
      }
    }
  }

  const fanInValues = Object.values(fanInByPath).sort((left, right) => left - right);
  const medianFanIn =
    fanInValues.length === 0
      ? 0
      : fanInValues[Math.floor(fanInValues.length / 2)] ?? 0;
  const maxFanIn = fanInValues[fanInValues.length - 1] ?? 0;

  return {
    fanInByPath,
    totalDirectories: Math.max(directories.size, 2),
    medianFanIn,
    maxFanIn
  };
};

const createFeatureBranchName = (featureId: string, request: string): string => {
  return `openweft-${featureId}-${slugifyFeatureRequest(request, 32)}`;
};

const getFeatureLabel = (feature: Pick<FeatureCheckpoint, 'id' | 'title' | 'request'>): string => {
  const title = feature.title?.trim() || feature.request.trim();
  return `${feature.id} ${title}`;
};

const buildWorktreePath = (config: ResolvedOpenWeftConfig, featureId: string): string => {
  return path.join(config.paths.worktreesDir, featureId);
};

const buildWorktreePlanFilePath = (planFile: string, worktreePath: string): string => {
  return path.join(worktreePath, '.openweft', 'feature-plans', path.basename(planFile));
};

const buildWorktreePromptBFilePath = (promptBFile: string, worktreePath: string): string => {
  return path.join(worktreePath, '.openweft', 'prompt-b-briefs', path.basename(promptBFile));
};

const buildEvolvedPlanPath = (config: ResolvedOpenWeftConfig, featureId: string): string => {
  return path.join(config.paths.evolvedPlansDir, `${featureId}.md`);
};

const syncPlanFileToWorktree = async (
  config: ResolvedOpenWeftConfig,
  planFile: string,
  worktreePath: string
): Promise<string> => {
  const targetPlanPath = buildWorktreePlanFilePath(planFile, worktreePath);
  const content = await readTextFileWithRetry(planFile);
  await writeTextFileAtomic(targetPlanPath, content);
  return targetPlanPath;
};

const stagePlanFileFromWorktree = async (
  config: ResolvedOpenWeftConfig,
  featureId: string,
  worktreePlanFile: string
): Promise<string | null> => {
  const content = await readTextFileIfExists(worktreePlanFile);
  if (content === null) {
    return null;
  }

  const evolvedPlanPath = buildEvolvedPlanPath(config, featureId);
  await writeTextFileAtomic(evolvedPlanPath, content);
  return evolvedPlanPath;
};

const promoteStagedPlan = async (
  config: ResolvedOpenWeftConfig,
  featureId: string,
  planFile: string
): Promise<boolean> => {
  const evolvedPlanPath = buildEvolvedPlanPath(config, featureId);
  const content = await readTextFileIfExists(evolvedPlanPath);
  if (content === null) {
    return false;
  }

  await writeTextFileAtomic(planFile, content);
  await writeShadowPlan(config, featureId, content);
  await rm(evolvedPlanPath, { force: true });
  return true;
};

const syncPromptBFileToWorktree = async (
  config: ResolvedOpenWeftConfig,
  promptBFile: string,
  worktreePath: string
): Promise<string> => {
  const targetPromptBPath = buildWorktreePromptBFilePath(promptBFile, worktreePath);
  const content = await readTextFileWithRetry(promptBFile);
  await writeTextFileAtomic(targetPromptBPath, content);
  return targetPromptBPath;
};

const buildPlanningStageOneRequest = (
  input: RealRunInput,
  featureId: string,
  prompt: string
): AdapterTurnRequest => ({
  featureId,
  stage: 'planning-s1',
  cwd: input.config.repoRoot,
  prompt,
  model: getBackendModel(input.config, input.adapter),
  auth: getBackendAuth(input.config, input.adapter),
  persistSession: false,
  ...getBackendEffortConfig(input.config, input.adapter),
  ...(input.adapter.backend === 'codex'
    ? {
        sandboxMode: 'read-only' as const,
        isolatedHomeDir: buildCodexHomeDir(input.config, featureId, 'planning-s1')
      }
    : {}),
  ...(input.adapter.backend === 'claude'
    ? {
        claudePermissionMode: 'plan' as const
      }
    : {})
});

const buildPlanningStageTwoRequest = (
  input: RealRunInput,
  featureId: string,
  prompt: string
): AdapterTurnRequest => ({
  featureId,
  stage: 'planning-s2',
  cwd: input.config.repoRoot,
  prompt,
  model: getBackendModel(input.config, input.adapter),
  auth: getBackendAuth(input.config, input.adapter),
  persistSession: false,
  ...getBackendEffortConfig(input.config, input.adapter),
  ...(input.adapter.backend === 'codex'
    ? {
        sandboxMode: 'read-only' as const,
        isolatedHomeDir: buildCodexHomeDir(input.config, featureId, 'planning-s2')
      }
    : {}),
  ...(input.adapter.backend === 'claude'
    ? {
        claudePermissionMode: 'plan' as const
      }
    : {})
});

const buildExecutionRequest = (
  input: RealRunInput,
  featureId: string,
  worktreePath: string,
  prompt: string,
  sessionId: string | null
): AdapterTurnRequest => ({
  featureId,
  stage: 'execution',
  cwd: worktreePath,
  prompt,
  model: getBackendModel(input.config, input.adapter),
  auth: getBackendAuth(input.config, input.adapter),
  sessionId,
  ...getBackendEffortConfig(input.config, input.adapter),
  ...(input.adapter.backend === 'codex'
    ? {
        sandboxMode: 'danger-full-access' as const,
        isolatedHomeDir: buildCodexHomeDir(input.config, featureId, 'session')
      }
    : {}),
  ...(input.adapter.backend === 'claude'
    ? {
        claudePermissionMode: 'acceptEdits' as const
      }
    : {})
});

const buildAdjustmentRequest = (
  input: RealRunInput,
  featureId: string,
  prompt: string,
  sessionId: string | null
): AdapterTurnRequest => ({
  featureId,
  stage: 'adjustment',
  cwd: input.config.repoRoot,
  prompt,
  model: getBackendModel(input.config, input.adapter),
  auth: getBackendAuth(input.config, input.adapter),
  sessionId,
  ...getBackendEffortConfig(input.config, input.adapter),
  ...(input.adapter.backend === 'codex'
    ? {
        sandboxMode: 'read-only' as const,
        isolatedHomeDir: buildCodexHomeDir(input.config, featureId, 'session')
      }
    : {}),
  ...(input.adapter.backend === 'claude'
    ? {
        claudePermissionMode: 'plan' as const
      }
    : {})
});

const buildConflictResolutionRequest = (
  input: RealRunInput,
  featureId: string,
  worktreePath: string,
  prompt: string,
  sessionId: string | null
): AdapterTurnRequest => ({
  featureId,
  stage: 'conflict-resolution',
  cwd: worktreePath,
  prompt,
  model: getBackendModel(input.config, input.adapter),
  auth: getBackendAuth(input.config, input.adapter),
  sessionId,
  ...getBackendEffortConfig(input.config, input.adapter),
  ...(input.adapter.backend === 'codex'
    ? {
        sandboxMode: 'danger-full-access' as const,
        isolatedHomeDir: buildCodexHomeDir(input.config, featureId, 'session')
      }
    : {}),
  ...(input.adapter.backend === 'claude'
    ? {
        claudePermissionMode: 'acceptEdits' as const
      }
    : {})
});

const runTurnAndRecord = async (
  input: RealRunContext,
  checkpoint: OrchestratorCheckpoint,
  request: AdapterTurnRequest
): Promise<AdapterTurnResult> => {
  if (shouldStopForBudget(input.config, checkpoint)) {
    throw new Error('Budget stop threshold reached before launching a new agent turn.');
  }

  if (request.isolatedHomeDir) {
    await mkdir(request.isolatedHomeDir, { recursive: true });

    if (input.adapter.backend === 'codex' && request.auth.method === 'subscription') {
      const defaultCodexHome = path.join(os.homedir(), '.codex');
      const authFile = path.join(defaultCodexHome, 'auth.json');
      const configFile = path.join(defaultCodexHome, 'config.toml');

      if (await pathExists(authFile)) {
        await copyFile(authFile, path.join(request.isolatedHomeDir, 'auth.json'));
      }

      if (await pathExists(configFile)) {
        await copyFile(configFile, path.join(request.isolatedHomeDir, 'config.toml'));
      }
    }
  }

  const commandPreview = input.adapter.buildCommand(request);
  emitOrchestratorEvent(input, {
    type: 'agent:started',
    agentId: request.featureId,
    name: getAgentName(checkpoint, request.featureId),
    feature: getAgentFeature(checkpoint, request.featureId, request.stage),
    stage: request.stage
  });
  await maybeAwaitTurnApproval(input, checkpoint, request);
  await appendAudit(input.config, {
    level: 'info',
    event: 'agent.turn.start',
    message: `Launching ${input.adapter.backend} ${request.stage} turn for feature ${request.featureId}.`,
    data: {
      backend: input.adapter.backend,
      featureId: request.featureId,
      stage: request.stage,
      resumedSession: Boolean(request.sessionId),
      command: sanitizeCommandForAudit(commandPreview)
    }
  });

  const result = await input.adapter.runTurn(request);

  if (result.ok) {
    await appendCostRecord(input.config, checkpoint, result.costRecord);
    emitOrchestratorEvent(input, {
      type: 'session:cost-update',
      totalCost: checkpoint.cost.totalEstimatedUsd
    });
    emitOrchestratorEvent(input, {
      type: 'agent:text',
      agentId: request.featureId,
      text: result.finalMessage,
      stage: request.stage
    });
    emitOrchestratorEvent(input, {
      type: 'agent:completed',
      agentId: request.featureId,
      cost: getFeatureCostUsd(checkpoint, request.featureId)
    });
    await appendAudit(input.config, {
      level: 'info',
      event: 'agent.turn.completed',
      message: `Completed ${input.adapter.backend} ${request.stage} turn for feature ${request.featureId}.`,
      data: {
        backend: input.adapter.backend,
        featureId: request.featureId,
        stage: request.stage,
        resumedSession: Boolean(request.sessionId),
        returnedSessionId: result.sessionId !== null,
        exitCode: result.artifacts.exitCode,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cachedInputTokens: result.usage.cachedInputTokens
        },
        command: sanitizeCommandForAudit(result.artifacts.command)
      }
    });
  } else {
    emitOrchestratorEvent(input, {
      type: 'agent:failed',
      agentId: request.featureId,
      error: result.error
    });
    await appendAudit(input.config, {
      level: result.classified.tier === 'fatal' ? 'error' : 'warn',
      event: 'agent.turn.failed',
      message: `Failed ${input.adapter.backend} ${request.stage} turn for feature ${request.featureId}.`,
      data: {
        backend: input.adapter.backend,
        featureId: request.featureId,
        stage: request.stage,
        resumedSession: Boolean(request.sessionId),
        returnedSessionId: result.sessionId !== null,
        exitCode: result.artifacts.exitCode,
        errorTier: result.classified.tier,
        error: result.error,
        command: sanitizeCommandForAudit(result.artifacts.command)
      }
    });
  }

  return result;
};

const planPendingRequests = async (
  context: RealRunContext
): Promise<{ checkpoint: OrchestratorCheckpoint; plannedCount: number }> => {
  await ensureRuntimeDirectories(context.config.paths);

  const queueContent = (await readTextFileIfExists(context.config.paths.queueFile)) ?? '';
  const parsedQueue = parseQueueFile(queueContent);
  if (parsedQueue.pending.length === 0) {
    return {
      checkpoint: cloneCheckpoint(context.checkpoint),
      plannedCount: 0
    };
  }

  const checkpoint = cloneCheckpoint(context.checkpoint);
  const promptTemplate = await readTextFileWithRetry(context.config.paths.promptA);
  const existingPlanFiles = await listMarkdownFiles(context.config.paths.featureRequestsDir);
  const usedPlanFiles = new Set(existingPlanFiles);
  let nextFeatureId = getNextFeatureIdFromQueue(existingPlanFiles, queueContent);
  let updatedQueueContent = queueContent;
  let plannedCount = 0;
  let workingQueue = parsedQueue;

  checkpoint.status = 'in-progress';
  checkpoint.currentState = 'planning';
  checkpoint.pendingRequests = workingQueue.pending.map((line) => ({
    request: line.request,
    queuedAt: checkpoint.createdAt
  }));
  await saveCheckpointSnapshot(context.config, checkpoint);

  while (workingQueue.pending.length > 0) {
    if (context.stopController?.isRequested) {
      break;
    }

    const pending = workingQueue.pending[0];
    if (!pending) {
      break;
    }

    const featureId = formatFeatureId(nextFeatureId);
    nextFeatureId += 1;
    let promptBFilePath: string | null = null;

    let repairedPlan:
      | {
          markdown: string;
          manifest: Manifest;
          sessionId: string | null;
        }
      | null = null;

    try {
      const stageOnePrompt = injectPromptTemplate(
        promptTemplate,
        USER_REQUEST_MARKER,
        pending.request
      );
      const stageOne = await runTurnAndRecord(
        context,
        checkpoint,
        buildPlanningStageOneRequest(context, featureId, stageOnePrompt)
      );

      if (!stageOne.ok) {
        throw new Error(stageOne.error);
      }

      if (stageOne.finalMessage.trim().length < STAGE_ONE_MIN_LENGTH) {
        throw new Error(`Planning stage 1 returned too little output for feature ${featureId}.`);
      }

      promptBFilePath = createPromptBArtifactPath(
        context.config,
        featureId,
        pending.request
      );
      const promptBMarkdown = sanitizePromptBMarkdown(stageOne.finalMessage);
      await writeTextFileAtomic(promptBFilePath, promptBMarkdown);
      await appendAudit(context.config, {
        level: 'info',
        event: 'planner.prompt-b.persisted',
        message: `Persisted Prompt B artifact for feature ${featureId}.`,
        data: {
          featureId,
          promptBFile: promptBFilePath
        }
      });

      const manifestInstruction = [
        'CRITICAL INSTRUCTION: Your response text must BE the full Markdown plan document.',
        'Include a "## Ledger" section covering constraints, assumptions, watchpoints, and validation.',
        'Include a "## Manifest" heading with a ```json code block containing { "create": [], "modify": [], "delete": [] }.',
        'Do NOT write files. Do NOT use Write, Edit, or ExitPlanMode tools. Return the plan as your response text ONLY.'
      ].join(' ');

      const stageTwoPrompt = [
        'IMPORTANT: You are receiving Prompt B, the generated worker brief for this feature.',
        `IMPORTANT: The Prompt B artifact has been saved at ${promptBFilePath}.`,
        manifestInstruction,
        '',
        '=== PROMPT B START ===',
        promptBMarkdown.trim(),
        '=== PROMPT B END ===',
        '',
        manifestInstruction
      ].join('\n');

      const stageTwo = await runTurnAndRecord(
        context,
        checkpoint,
        buildPlanningStageTwoRequest(context, featureId, stageTwoPrompt)
      );

      if (!stageTwo.ok) {
        throw new Error(stageTwo.error);
      }

      const shadowMarkdown = await maybeReadShadowPlan(context.config, featureId);
      repairedPlan = await repairPlanMarkdownIfNeeded({
        featureId,
        request: pending.request,
        initialMarkdown: stageTwo.finalMessage,
        shadowMarkdown,
        promptBMarkdown,
        onInvalidPlanAttempt: async (attempt) => {
          const shadowPlanFile = attempt.markdown
            ? await writeShadowPlan(context.config, featureId, attempt.markdown)
            : null;
          await appendAudit(context.config, {
            level: 'warn',
            event: 'feature.planning.repair.rejected',
            message:
              attempt.source === 'initial'
                ? `Initial planning markdown for feature ${featureId} failed validation.`
                : attempt.source === 'repair-turn-failed'
                  ? `Repair attempt ${attempt.attempt} for feature ${featureId} failed before validation.`
                  : `Repair attempt ${attempt.attempt} for feature ${featureId} produced invalid markdown.`,
            data: {
              featureId,
              attempt: attempt.attempt,
              source: attempt.source,
              error: attempt.error,
              shadowPlanFile,
              sessionId: attempt.sessionId
            }
          });
        },
        runRepairTurn: async (prompt) =>
          runTurnAndRecord(
            context,
            checkpoint,
            buildPlanningStageTwoRequest(context, featureId, prompt)
          )
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isRecoverablePlanningError(message)) {
        throw error;
      }

      checkpoint.features[featureId] = {
        id: featureId,
        title: summarizeQueueRequest(pending.request),
        request: pending.request,
        status: 'skipped',
        attempts: 0,
        planFile: null,
        promptBFile: promptBFilePath,
        evolvedPlanFile: null,
        branchName: null,
        worktreePath: null,
        sessionId: null,
        sessionScope: null,
        backend: context.adapter.backend,
        manifest: null,
        rerunEligible: false,
        mergeResolutionAttempts: 0,
        priorityScore: null,
        priorityTier: null,
        scoringCycles: 0,
        lastError: message,
        updatedAt: timestamp()
      };

      updatedQueueContent = markQueueLineProcessed(
        updatedQueueContent,
        pending.lineIndex,
        featureId,
        pending.request,
        pending.request
      );

      workingQueue = parseQueueFile(updatedQueueContent);
      checkpoint.pendingRequests = workingQueue.pending.map((line) => ({
        request: line.request,
        queuedAt: checkpoint.createdAt
      }));

      await appendAudit(context.config, {
        level: 'error',
        event: 'feature.planning.skipped',
        message: `Skipped feature ${featureId} after planning failed.`,
        data: {
          featureId,
          request: pending.request,
          error: message,
          promptBFile: promptBFilePath
        }
      });
      await announceProgress(
        context,
        `Skipping feature ${featureId} because planning failed: ${message}`
      );
      await saveCheckpointSnapshot(context.config, checkpoint);
      await writeTextFileAtomic(
        context.config.paths.queueFile,
        updatedQueueContent || '# OpenWeft feature queue\n'
      );
      continue;
    }

    if (!repairedPlan) {
      throw new Error(`Planning completed without a repaired plan for feature ${featureId}.`);
    }

    const planFilename = createPlanFilename(Number.parseInt(featureId, 10), pending.request, usedPlanFiles);
    usedPlanFiles.add(planFilename);
    const planFilePath = path.join(context.config.paths.featureRequestsDir, planFilename);

    await writeTextFileAtomic(planFilePath, repairedPlan.markdown);
    await writeShadowPlan(context.config, featureId, repairedPlan.markdown);

    updatedQueueContent = markQueueLineProcessed(
      updatedQueueContent,
      pending.lineIndex,
      featureId,
      pending.request,
      pending.request
    );

    checkpoint.features[featureId] = {
      id: featureId,
      title: summarizeQueueRequest(pending.request),
      request: pending.request,
      status: 'planned',
      attempts: 0,
      planFile: planFilePath,
      promptBFile: promptBFilePath,
      evolvedPlanFile: null,
      branchName: null,
      worktreePath: null,
      sessionId: repairedPlan.sessionId,
      sessionScope: repairedPlan.sessionId ? 'repo' : null,
      backend: context.adapter.backend,
      manifest: repairedPlan.manifest,
      rerunEligible: true,
      mergeResolutionAttempts: 0,
      priorityScore: null,
      priorityTier: null,
      scoringCycles: 0,
      updatedAt: timestamp()
    };
    workingQueue = parseQueueFile(updatedQueueContent);
    checkpoint.pendingRequests = workingQueue.pending.map((line) => ({
      request: line.request,
      queuedAt: checkpoint.createdAt
    }));
    await saveCheckpointSnapshot(context.config, checkpoint);
    await writeTextFileAtomic(
      context.config.paths.queueFile,
      updatedQueueContent || '# OpenWeft feature queue\n'
    );
    plannedCount += 1;
  }

  await writeTextFileAtomic(
    context.config.paths.queueFile,
    updatedQueueContent || '# OpenWeft feature queue\n'
  );

  if (context.stopController?.isRequested) {
    checkpoint.status = 'stopped';
    checkpoint.currentState = 'stopped';
    checkpoint.currentPhase = null;
  } else {
    checkpoint.pendingRequests = [];
  }
  await saveCheckpointSnapshot(context.config, checkpoint);

  return {
    checkpoint,
    plannedCount
  };
};

const scoreAndPhaseCheckpoint = async (
  context: RealRunContext
): Promise<{
  checkpoint: OrchestratorCheckpoint;
  scores: FeatureScoreBreakdown[];
  phases: ReturnType<typeof buildExecutionPhases>;
}> => {
  const checkpoint = cloneCheckpoint(context.checkpoint);
  const executableFeatures = getExecutionEligibleFeatures(checkpoint);

  if (executableFeatures.length === 0) {
    checkpoint.queue = {
      orderedFeatureIds: [],
      totalCount: 0
    };

    return {
      checkpoint,
      scores: [],
      phases: []
    };
  }

  const manifestPaths = executableFeatures.flatMap((feature) => {
    const manifest = feature.manifest ?? { create: [], modify: [], delete: [] };
    return [...manifest.create, ...manifest.modify, ...manifest.delete];
  });
  const repoContext = (await collectScoringPaths(
    context.config.repoRoot,
    manifestPaths
  )) as RepoRiskContext;
  const scores = scoreQueue(
    executableFeatures.map((feature) => ({
      id: feature.id,
      request: feature.request,
      manifest: feature.manifest ?? { create: [], modify: [], delete: [] },
      previousSmoothedPriority: feature.priorityScore ?? undefined,
      previousTier: feature.priorityTier ?? undefined,
      cyclesSeen: feature.scoringCycles ?? 0,
      successPenalty: feature.status === 'failed' ? 0.15 : 0
    })),
    repoContext,
    {
      previousOrdering: checkpoint.queue.orderedFeatureIds
    }
  );

  updateQueueOrdering(checkpoint, scores);

  const phases = buildExecutionPhases(
    scores.map((score) => {
      const feature = checkpoint.features[score.id];
      return {
        id: score.id,
        manifest: feature?.manifest ?? { create: [], modify: [], delete: [] },
        priorityScore: score.smoothedPriority
      };
    }),
    repoContext,
    context.config.concurrency.maxParallelAgents
  );

  return {
    checkpoint,
    scores,
    phases
  };
};

const createOrResetFeatureWorktree = async (
  input: RealRunInput,
  feature: FeatureCheckpoint,
  baseBranch: string
): Promise<{ branchName: string; worktreePath: string; baselineCommit: string }> => {
  const worktreePath = buildWorktreePath(input.config, feature.id);
  const branchName = feature.branchName ?? createFeatureBranchName(feature.id, feature.request);

  if (feature.worktreePath && (await pathExists(feature.worktreePath))) {
    await removeWorktree({
      repoRoot: input.config.repoRoot,
      worktreePath: feature.worktreePath,
      branchName,
      force: true
    });
  } else if (feature.branchName) {
    await simpleGit(input.config.repoRoot).raw(['worktree', 'prune']);
    try {
      await simpleGit(input.config.repoRoot).deleteLocalBranch(branchName, true);
    } catch (error) {
      if (!isMissingBranchError(error)) {
        throw error;
      }
    }
  }

  const created = await createWorktree({
    repoRoot: input.config.repoRoot,
    worktreePath,
    branchName,
    startPoint: baseBranch
  });

  const baselineCommit = created.head.trim();
  return {
    branchName,
    worktreePath,
    baselineCommit
  };
};

const getManifestPaths = (feature: FeatureCheckpoint): string[] => {
  const manifest = feature.manifest ?? { create: [], modify: [], delete: [] };
  return [...manifest.create, ...manifest.modify, ...manifest.delete];
};

const buildRecoveredMergeSummary = (
  feature: Pick<FeatureCheckpoint, 'id' | 'branchName' | 'manifest' | 'mergeCommit'>,
  mergeCommit: string
): EditSummary => {
  const manifest = feature.manifest ?? { create: [], modify: [], delete: [] };
  const files = [
    ...manifest.create.map((filePath) => ({
      path: filePath,
      change_type: 'added' as const,
      lines_added: 0,
      lines_removed: 0,
      old_path: null
    })),
    ...manifest.modify.map((filePath) => ({
      path: filePath,
      change_type: 'modified' as const,
      lines_added: 0,
      lines_removed: 0,
      old_path: null
    })),
    ...manifest.delete.map((filePath) => ({
      path: filePath,
      change_type: 'deleted' as const,
      lines_added: 0,
      lines_removed: 0,
      old_path: null
    }))
  ];
  const branch = feature.branchName ?? `recovered-${feature.id}`;

  return {
    merge_commit: mergeCommit,
    branch,
    pre_merge_commit: feature.mergeCommit ?? mergeCommit,
    total_files_changed: files.length,
    total_lines_added: 0,
    total_lines_removed: 0,
    files
  };
};

const normalizeRepoRelativePath = (value: string): string => value.replace(/\\/g, '/');

const buildMergedPathSet = (
  mergeSummaries: Array<{ featureId: string; summary: EditSummary }>
): Set<string> => {
  const paths = new Set<string>();

  for (const mergeSummary of mergeSummaries) {
    for (const filePath of listEditSummaryPaths(mergeSummary.summary)) {
      paths.add(normalizeRepoRelativePath(filePath));
    }
  }

  return paths;
};

const appendMergePhaseOrderAudit = async (
  context: RealRunContext,
  phaseIndex: number,
  successfulFeatureIds: string[],
  scoreById: Map<string, FeatureScoreBreakdown>
): Promise<void> => {
  if (successfulFeatureIds.length === 0) {
    return;
  }

  await appendAudit(context.config, {
    level: 'info',
    event: 'merge.phase.order',
    message: `Recorded merge order for phase ${phaseIndex}.`,
    data: {
      phaseIndex,
      orderedFeatures: successfulFeatureIds.map((featureId) => ({
        featureId,
        smoothedPriority: scoreById.get(featureId)?.smoothedPriority ?? 0
      }))
    }
  });
};

const appendMergeFeatureResultAudit = async (
  context: RealRunContext,
  input: {
    phaseIndex: number;
    feature: FeatureCheckpoint;
    result: 'merged' | 'merged-after-conflict-resolution' | 'failed';
    failureStage?:
      | 'merge-into-current'
      | 'merge-into-worktree'
      | 'conflict-resolution-approval'
      | 'conflict-resolution-turn'
      | 'post-resolution-retry';
    conflictFiles?: string[];
    editSummary?: EditSummary;
    error?: string | null;
  }
): Promise<void> => {
  const featureLabel = getFeatureLabel(input.feature);
  const message =
    input.result === 'merged'
      ? `Feature ${featureLabel} merged without conflicts.`
      : input.result === 'merged-after-conflict-resolution'
        ? `Feature ${featureLabel} merged after conflict resolution.`
        : `Feature ${featureLabel} failed during merge processing.`;

  await appendAudit(context.config, {
    level: input.result === 'failed' ? 'warn' : 'info',
    event: 'merge.feature.result',
    message,
    data: {
      phaseIndex: input.phaseIndex,
      featureId: input.feature.id,
      branchName: input.feature.branchName,
      priorityScore: input.feature.priorityScore ?? null,
      result: input.result,
      failureStage: input.failureStage ?? null,
      conflictFiles: input.conflictFiles ?? [],
      error: input.error ?? null,
      editSummary: input.editSummary ?? null
    }
  });
};

const appendReanalysisDecisionAudit = async (
  context: RealRunContext,
  input: {
    phaseIndex: number;
    feature: FeatureCheckpoint;
    decision:
      | 'skipped-no-plan-file'
      | 'skipped-no-overlap'
      | 'adjustment-attempted'
      | 'adjustment-failed';
    overlapPaths?: string[];
    planChanged?: boolean | null;
    error?: string | null;
  }
): Promise<void> => {
  const featureLabel = getFeatureLabel(input.feature);
  const message =
    input.decision === 'skipped-no-plan-file'
      ? `Skipped re-analysis for feature ${featureLabel} because no plan file is available.`
      : input.decision === 'skipped-no-overlap'
        ? `Skipped re-analysis for feature ${featureLabel} because no merged paths overlapped its manifest.`
        : input.decision === 'adjustment-attempted'
          ? `Ran re-analysis for feature ${featureLabel}.`
          : `Re-analysis failed for feature ${featureLabel}.`;

  await appendAudit(context.config, {
    level: input.decision === 'adjustment-failed' ? 'warn' : 'info',
    event: 'reanalysis.feature.decision',
    message,
    data: {
      phaseIndex: input.phaseIndex,
      featureId: input.feature.id,
      decision: input.decision,
      overlapPaths: input.overlapPaths ?? [],
      planChanged: input.planChanged ?? null,
      error: input.error ?? null
    }
  });
};

const runPendingReanalysis = async (
  context: RealRunContext,
  checkpoint: OrchestratorCheckpoint,
  phaseIndex: number,
  mergeSummaries: Array<{ featureId: string; summary: EditSummary }>
): Promise<'continued' | 'stopped'> => {
  const remaining = getExecutionEligibleFeatures(checkpoint);

  if (remaining.length > 0 && mergeSummaries.length > 0) {
    const template = await readTextFileWithRetry(context.config.paths.planAdjustment);
    const mergedPathSet = buildMergedPathSet(mergeSummaries);
    const aggregatedMergeSummaryJson = JSON.stringify(
      mergeSummaries.map((mergedSummary) => mergedSummary.summary),
      null,
      2
    );

    for (const feature of remaining) {
      if (!feature.planFile) {
        await appendReanalysisDecisionAudit(context, {
          phaseIndex,
          feature,
          decision: 'skipped-no-plan-file'
        });
        continue;
      }

      const overlapPaths = getManifestPaths(feature)
        .map((manifestPath) => normalizeRepoRelativePath(manifestPath))
        .filter((manifestPath, index, manifestPaths) =>
          mergedPathSet.has(manifestPath) && manifestPaths.indexOf(manifestPath) === index
        );
      if (overlapPaths.length === 0) {
        await appendReanalysisDecisionAudit(context, {
          phaseIndex,
          feature,
          decision: 'skipped-no-overlap'
        });
        continue;
      }

      const planFile = feature.planFile;
      const currentPlan = await readTextFileWithRetry(planFile);
      await writeShadowPlan(context.config, feature.id, currentPlan);

      const prompt = buildPlanAdjustmentPrompt({
        template,
        planFilePath: planFile,
        planContent: currentPlan,
        codeEditSummaryJson: aggregatedMergeSummaryJson
      });
      let adjustment: AdapterTurnResult;
      try {
        adjustment = await runTurnAndRecord(
          context,
          checkpoint,
          buildAdjustmentRequest(
            context,
            feature.id,
            prompt,
            resolveReusableSessionId(feature, 'repo')
          )
        );
      } catch (error) {
        if (error instanceof TurnApprovalError) {
          if (context.stopController?.isRequested) {
            checkpoint.status = 'stopped';
            checkpoint.currentState = 'stopped';
            checkpoint.currentPhase = null;
            await saveCheckpointSnapshot(context.config, checkpoint);
            return 'stopped';
          }
          updateFeatureCheckpoint(checkpoint, feature.id, {
            lastError: error.message
          });
          await appendReanalysisDecisionAudit(context, {
            phaseIndex,
            feature,
            decision: 'adjustment-failed',
            overlapPaths,
            error: error.message
          });
          await announceProgress(
            context,
            `Plan adjustment for ${getFeatureLabel(feature)} failed: ${error.message}`
          );
          continue;
        }
        throw error;
      }

      if (!adjustment.ok) {
        updateFeatureCheckpoint(checkpoint, feature.id, {
          lastError: adjustment.error
        });
        await appendReanalysisDecisionAudit(context, {
          phaseIndex,
          feature,
          decision: 'adjustment-failed',
          overlapPaths,
          error: adjustment.error ?? null
        });
        await announceProgress(
          context,
          `Plan adjustment for ${getFeatureLabel(feature)} failed${adjustment.error ? `: ${adjustment.error}` : '.'}`
        );
        continue;
      }

      if (context.adapter.backend === 'mock') {
        updateFeatureCheckpoint(checkpoint, feature.id, {
          sessionId: adjustment.sessionId,
          sessionScope: adjustment.sessionId ? 'repo' : null
        });
        await appendReanalysisDecisionAudit(context, {
          phaseIndex,
          feature,
          decision: 'adjustment-attempted',
          overlapPaths
        });
        continue;
      }

      try {
        const adjustedPlan = adjustment.finalMessage;
        const shadowPlan = await maybeReadShadowPlan(context.config, feature.id);
        assertLedgerSection(adjustedPlan);
        const parsed = parseManifestDocument(adjustedPlan, {
          ...(shadowPlan
            ? {
                lastKnownGood: parseManifestDocument(shadowPlan).manifest
              }
            : {})
        });
        const normalizedPlan = updateManifestInMarkdown(adjustedPlan, parsed.manifest);
        const planChanged = normalizedPlan !== currentPlan;
        await writeTextFileAtomic(planFile, normalizedPlan);
        await writeShadowPlan(context.config, feature.id, normalizedPlan);
        updateFeatureCheckpoint(checkpoint, feature.id, {
          manifest: parsed.manifest,
          sessionId: adjustment.sessionId,
          sessionScope: adjustment.sessionId ? 'repo' : null,
          lastError: null
        });
        await appendReanalysisDecisionAudit(context, {
          phaseIndex,
          feature,
          decision: 'adjustment-attempted',
          overlapPaths,
          planChanged
        });
      } catch (error) {
        await appendReanalysisDecisionAudit(context, {
          phaseIndex,
          feature,
          decision: 'adjustment-failed',
          overlapPaths,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  }

  if (mergeSummaries.length > 0) {
    checkpoint.pendingMergeSummaries = [];
    await saveCheckpointSnapshot(context.config, checkpoint);
  }

  return 'continued';
};

const runFeatureExecutionAttempt = async (
  context: RealRunContext,
  checkpoint: OrchestratorCheckpoint,
  feature: FeatureCheckpoint,
  baseBranch: string
): Promise<{
  featureId: string;
  status: 'completed' | 'failed' | 'fatal' | 'aborted';
  allowFullRerun: boolean;
  branchName: string | null;
  worktreePath: string | null;
  sessionId: string | null;
  baselineCommit: string | null;
  evolvedPlanFile: string | null;
  error?: string;
}> => {
  const worktreeState = await createOrResetFeatureWorktree(context, feature, baseBranch);
  const worktreePromptBFile = feature.promptBFile
    ? await syncPromptBFileToWorktree(context.config, feature.promptBFile, worktreeState.worktreePath)
    : null;
  const worktreePlanFile = feature.planFile
    ? await syncPlanFileToWorktree(context.config, feature.planFile, worktreeState.worktreePath)
    : null;

  if (!feature.promptBFile || !worktreePromptBFile) {
    return {
      featureId: feature.id,
      status: 'fatal',
      allowFullRerun: false,
      branchName: worktreeState.branchName,
      worktreePath: worktreeState.worktreePath,
      sessionId: null,
      baselineCommit: worktreeState.baselineCommit,
      evolvedPlanFile: null,
      error: 'Prompt B artifact is missing.'
    };
  }

  if (!feature.planFile || !worktreePlanFile) {
    return {
      featureId: feature.id,
      status: 'fatal',
      allowFullRerun: false,
      branchName: worktreeState.branchName,
      worktreePath: worktreeState.worktreePath,
      sessionId: null,
      baselineCommit: worktreeState.baselineCommit,
      evolvedPlanFile: null,
      error: 'Feature plan file is missing.'
    };
  }

  const promptBContent = await readTextFileWithRetry(feature.promptBFile);
  const planContent = await readTextFileWithRetry(feature.planFile);
  const executionPrompt = buildExecutionPrompt({
    promptBFilePath: worktreePromptBFile,
    promptBContent,
    planFilePath: worktreePlanFile,
    planContent
  });
  const retryBackoffMs =
    context.adapter.backend === 'claude'
      ? context.config.rateLimits.claude.retryBackoffMs
      : context.config.rateLimits.codex.retryBackoffMs;
  const retryMaxAttempts =
    context.adapter.backend === 'claude'
      ? context.config.rateLimits.claude.retryMaxAttempts
      : context.config.rateLimits.codex.retryMaxAttempts;

  let sessionId = resolveReusableSessionId(feature, 'worktree');
  let transientAttempts = 0;
  let agentRetryUsed = false;

  while (true) {
    let result: AdapterTurnResult;
    try {
      result = await runTurnAndRecord(
        context,
        checkpoint,
        buildExecutionRequest(
          context,
          feature.id,
          worktreeState.worktreePath,
          executionPrompt,
          sessionId
        )
      );
    } catch (error) {
      if (error instanceof TurnApprovalError) {
        return {
          featureId: feature.id,
          status: context.stopController?.isRequested ? 'aborted' : 'failed',
          allowFullRerun: false,
          branchName: worktreeState.branchName,
          worktreePath: worktreeState.worktreePath,
          sessionId,
          baselineCommit: worktreeState.baselineCommit,
          evolvedPlanFile: null,
          error: error.message
        };
      }
      throw error;
    }

    if (result.ok) {
      sessionId = result.sessionId;

      const producedChanges = await hasChangesSince(
        worktreeState.worktreePath,
        worktreeState.baselineCommit
      );
      if (!producedChanges) {
        return {
          featureId: feature.id,
          status: 'failed',
          allowFullRerun: true,
          branchName: worktreeState.branchName,
          worktreePath: worktreeState.worktreePath,
          sessionId,
          baselineCommit: worktreeState.baselineCommit,
          evolvedPlanFile: null,
          error: 'Agent completed without producing any workspace changes.'
        };
      }

      const commit = await commitAllChanges(
        worktreeState.worktreePath,
        `openweft: complete feature ${feature.id}`
      );

      if (!commit) {
        return {
          featureId: feature.id,
          status: 'failed',
          allowFullRerun: true,
          branchName: worktreeState.branchName,
          worktreePath: worktreeState.worktreePath,
          sessionId,
          baselineCommit: worktreeState.baselineCommit,
          evolvedPlanFile: null,
          error: 'Agent produced changes, but OpenWeft could not create a feature commit.'
        };
      }

      const evolvedPlanFile = await stagePlanFileFromWorktree(
        context.config,
        feature.id,
        worktreePlanFile
      );

      return {
        featureId: feature.id,
        status: 'completed',
        allowFullRerun: false,
        branchName: worktreeState.branchName,
        worktreePath: worktreeState.worktreePath,
        sessionId,
        baselineCommit: worktreeState.baselineCommit,
        evolvedPlanFile
      };
    }

    if (result.classified.tier === 'fatal') {
      return {
        featureId: feature.id,
        status: 'fatal',
        allowFullRerun: false,
        branchName: worktreeState.branchName,
        worktreePath: worktreeState.worktreePath,
        sessionId: result.sessionId,
        baselineCommit: worktreeState.baselineCommit,
        evolvedPlanFile: null,
        error: result.error
      };
    }

    if (context.stopController?.isRequested) {
      return {
        featureId: feature.id,
        status: 'aborted',
        allowFullRerun: false,
        branchName: worktreeState.branchName,
        worktreePath: worktreeState.worktreePath,
        sessionId: result.sessionId,
        baselineCommit: worktreeState.baselineCommit,
        evolvedPlanFile: null
      };
    }

    if (result.classified.tier === 'transient' && transientAttempts < retryMaxAttempts) {
      transientAttempts += 1;
      const jitter = Math.round(retryBackoffMs * (0.2 * Math.random()));
      await (context.sleep ?? sleep)(retryBackoffMs * transientAttempts + jitter);
      sessionId = result.sessionId;
      continue;
    }

    if (result.classified.tier === 'agent' && !agentRetryUsed) {
      agentRetryUsed = true;
      await resetWorktreeToHead(worktreeState.worktreePath);
      sessionId = null;
      const freshPrompt = [
        'A previous attempt failed.',
        `Failure summary: ${result.error}`,
        'Start fresh, load the plan file again, and execute the plan completely.'
      ].join('\n\n');

      const retryPrompt = `${executionPrompt}\n\n${freshPrompt}`;
      let retryResult: AdapterTurnResult;
      try {
        retryResult = await runTurnAndRecord(
          context,
          checkpoint,
          buildExecutionRequest(
            context,
            feature.id,
            worktreeState.worktreePath,
            retryPrompt,
            sessionId
          )
        );
      } catch (error) {
        if (error instanceof TurnApprovalError) {
          return {
            featureId: feature.id,
            status: context.stopController?.isRequested ? 'aborted' : 'failed',
            allowFullRerun: false,
          branchName: worktreeState.branchName,
          worktreePath: worktreeState.worktreePath,
          sessionId,
          baselineCommit: worktreeState.baselineCommit,
          evolvedPlanFile: null,
          error: error.message
        };
        }
        throw error;
      }

      if (retryResult.ok) {
        sessionId = retryResult.sessionId;
        const commit = await commitAllChanges(
          worktreeState.worktreePath,
          `openweft: complete feature ${feature.id}`
        );

        if (!commit) {
          return {
            featureId: feature.id,
            status: 'failed',
            allowFullRerun: true,
            branchName: worktreeState.branchName,
            worktreePath: worktreeState.worktreePath,
            sessionId,
            baselineCommit: worktreeState.baselineCommit,
            evolvedPlanFile: null,
            error: 'Agent retry completed without a committable result.'
          };
        }

        const evolvedPlanFile = await stagePlanFileFromWorktree(
          context.config,
          feature.id,
          worktreePlanFile
        );

        return {
          featureId: feature.id,
          status: 'completed',
          allowFullRerun: false,
          branchName: worktreeState.branchName,
          worktreePath: worktreeState.worktreePath,
          sessionId,
          baselineCommit: worktreeState.baselineCommit,
          evolvedPlanFile
        };
      }

      return {
        featureId: feature.id,
        status: retryResult.classified.tier === 'fatal' ? 'fatal' : 'failed',
        allowFullRerun: retryResult.classified.tier !== 'fatal',
        branchName: worktreeState.branchName,
        worktreePath: worktreeState.worktreePath,
        sessionId: retryResult.sessionId,
        baselineCommit: worktreeState.baselineCommit,
        evolvedPlanFile: null,
        error: retryResult.error
      };
    }

    return {
      featureId: feature.id,
      status: 'failed',
      allowFullRerun: true,
      branchName: worktreeState.branchName,
      worktreePath: worktreeState.worktreePath,
      sessionId: result.sessionId,
      baselineCommit: worktreeState.baselineCommit,
      evolvedPlanFile: null,
      error: result.error
    };
  }
};

type ExecutionAttemptResult = Awaited<ReturnType<typeof runFeatureExecutionAttempt>>;

const createUnexpectedExecutionFailure = (
  config: ResolvedOpenWeftConfig,
  feature: Pick<FeatureCheckpoint, 'id' | 'request' | 'branchName' | 'worktreePath'>,
  error: unknown
): {
  classified: ReturnType<typeof classifyError>;
  result: ExecutionAttemptResult;
} => {
  const classified = classifyError(error);

  return {
    classified,
    result: {
      featureId: feature.id,
      status: classified.tier === 'fatal' ? 'fatal' : 'failed',
      allowFullRerun: false,
      branchName: feature.branchName ?? createFeatureBranchName(feature.id, feature.request),
      worktreePath: feature.worktreePath ?? buildWorktreePath(config, feature.id),
      sessionId: null,
      baselineCommit: null,
      evolvedPlanFile: null,
      error: classified.reason
    }
  };
};

const executePhases = async (
  context: RealRunContext,
  scores: FeatureScoreBreakdown[],
  phases: ReturnType<typeof buildExecutionPhases>
): Promise<{ checkpoint: OrchestratorCheckpoint; mergedCount: number }> => {
  const checkpoint = cloneCheckpoint(context.checkpoint);
  const baseBranch = (await simpleGit(context.config.repoRoot).revparse(['--abbrev-ref', 'HEAD'])).trim();
  const scoreById = new Map(scores.map((score) => [score.id, score]));
  let mergedCount = 0;
  const previousGc = await getAutoGcSetting(context.config.repoRoot);
  const gcBreadcrumbFile = getAutoGcBreadcrumbFile(context.config);
  await writeTextFileAtomic(
    gcBreadcrumbFile,
    `${JSON.stringify({ previousValue: previousGc, savedAt: timestamp() })}\n`
  );
  let gcDisabled = false;

  try {
    await setAutoGc(context.config.repoRoot, '0');
    gcDisabled = true;

    for (const phase of phases) {
      if (context.stopController?.isRequested) {
        checkpoint.status = 'stopped';
        checkpoint.currentState = 'stopped';
        checkpoint.currentPhase = null;
        await saveCheckpointSnapshot(context.config, checkpoint);
        return {
          checkpoint,
          mergedCount
        };
      }

      checkpoint.status = 'in-progress';
      checkpoint.currentState = 'executing';
      checkpoint.currentPhase = {
        index: phase.index,
        name: `Phase ${phase.index}`,
        featureIds: phase.featureIds,
        startedAt: timestamp()
      };
      emitOrchestratorEvent(context, {
        type: 'phase:started',
        phase: phase.index,
        total: phases.length,
        featureIds: [...phase.featureIds]
      });
      await announceProgress(
        context,
        `Phase ${phase.index} starting (${phase.featureIds.length} feature${phase.featureIds.length === 1 ? '' : 's'}).`
      );

      for (const featureId of phase.featureIds) {
        updateFeatureCheckpoint(checkpoint, featureId, {
          status: 'executing',
          lastError: null
        });
      }

      await saveCheckpointSnapshot(context.config, checkpoint);

      const queue = new PQueue({
        concurrency: Math.max(1, Math.min(phase.features.length, context.config.concurrency.maxParallelAgents))
      });
      const availableTmuxSlots = context.tmuxMonitor
        ? Array.from({ length: context.tmuxMonitor.slotCount }, (_, index) => index + 1)
        : [];

      const promises = phase.features.map((phaseFeature, index) =>
        queue.add(
          async () => {
            if (index > 0 && context.config.concurrency.staggerDelayMs > 0) {
              await (context.sleep ?? sleep)(context.config.concurrency.staggerDelayMs * index);
            }

            const feature = checkpoint.features[phaseFeature.id];
            if (!feature) {
              throw new Error(`Feature ${phaseFeature.id} is not in the checkpoint.`);
            }

            const tmuxSlot = availableTmuxSlots.shift() ?? null;
            if (tmuxSlot !== null) {
              await appendTmuxSlotLine(
                context,
                tmuxSlot,
                `Assigned ${getFeatureLabel(feature)} for execution in phase ${phase.index}.`
              );
            }

            try {
              const recovered = context.recoveredExecutions.get(feature.id);
              if (recovered) {
                context.recoveredExecutions.delete(feature.id);
                const result: ExecutionAttemptResult = recovered;
                if (tmuxSlot !== null) {
                  await appendTmuxSlotLine(
                    context,
                    tmuxSlot,
                    `Recovered completed execution for ${getFeatureLabel(feature)} without rerunning the agent.`
                  );
                }
                return result;
              }

              const result = await runFeatureExecutionAttempt(context, checkpoint, feature, baseBranch);
              if (tmuxSlot !== null) {
                await appendTmuxSlotLine(
                  context,
                  tmuxSlot,
                  result.status === 'completed'
                    ? `Completed ${getFeatureLabel(feature)}.`
                    : `Failed ${getFeatureLabel(feature)}${result.error ? `: ${result.error}` : '.'}`
                );
              }
              return result;
            } catch (error) {
              const unexpectedFailure = createUnexpectedExecutionFailure(context.config, feature, error);
              await appendAudit(context.config, {
                level: unexpectedFailure.result.status === 'fatal' ? 'error' : 'warn',
                event: 'feature.execution.failed',
                message: `Feature ${feature.id} failed before an execution result was recorded.`,
                data: {
                  featureId: feature.id,
                  phase: phase.index,
                  error: unexpectedFailure.result.error,
                  errorTier: unexpectedFailure.classified.tier
                }
              });
              return unexpectedFailure.result;
            } finally {
              if (tmuxSlot !== null) {
                await appendTmuxSlotLine(
                  context,
                  tmuxSlot,
                  `Execution slot released for ${feature.id}.`
                );
                availableTmuxSlots.push(tmuxSlot);
                availableTmuxSlots.sort((left, right) => left - right);
              }
            }
          },
          {
            id: phaseFeature.id,
            priority: Math.round((scoreById.get(phaseFeature.id)?.smoothedPriority ?? 0) * 1000)
          }
        )
      );

      const settled = await Promise.allSettled(promises);
      await queue.onIdle();

      const results: ExecutionAttemptResult[] = [];
      for (const [index, settledFeature] of settled.entries()) {
        if (settledFeature.status === 'fulfilled') {
          results.push(settledFeature.value);
          continue;
        }

        const featureId = phase.features[index]?.id;
        if (!featureId) {
          await appendAudit(context.config, {
            level: 'error',
            event: 'feature.execution.failed',
            message: `A queued execution task rejected without a matching feature in phase ${phase.index}.`,
            data: {
              phase: phase.index,
              error: classifyError(settledFeature.reason).reason
            }
          });
          continue;
        }

        const feature = checkpoint.features[featureId];
        if (!feature) {
          await appendAudit(context.config, {
            level: 'error',
            event: 'feature.execution.failed',
            message: `Execution task for feature ${featureId} rejected before the checkpoint entry could be loaded.`,
            data: {
              featureId,
              phase: phase.index,
              error: classifyError(settledFeature.reason).reason
            }
          });
          continue;
        }

        const unexpectedFailure = createUnexpectedExecutionFailure(
          context.config,
          feature,
          settledFeature.reason
        );
        await appendAudit(context.config, {
          level: unexpectedFailure.result.status === 'fatal' ? 'error' : 'warn',
          event: 'feature.execution.failed',
          message: `Feature ${featureId} rejected after leaving the execution queue callback.`,
          data: {
            featureId,
            phase: phase.index,
            error: unexpectedFailure.result.error,
            errorTier: unexpectedFailure.classified.tier
          }
        });
        results.push(unexpectedFailure.result);
      }

      const fatalFailure = results.find((entry) => entry.status === 'fatal');
      let terminalFailedCount = 0;

      for (const result of results) {
        const feature = checkpoint.features[result.featureId];
        const previousAttempts = checkpoint.features[result.featureId]?.attempts ?? 0;
        const nextAttempts = result.status === 'aborted' ? previousAttempts : previousAttempts + 1;
        const rerunEligible = shouldScheduleFullFeatureRerun(result, nextAttempts);
        updateFeatureCheckpoint(checkpoint, result.featureId, {
          status:
            result.status === 'completed'
              ? 'planned'
              : result.status === 'aborted'
                ? 'planned'
              : result.status === 'fatal'
                ? 'failed'
                : 'failed',
          attempts: nextAttempts,
          branchName: result.branchName,
          worktreePath: result.worktreePath,
          sessionId: result.sessionId,
          sessionScope: result.sessionId ? 'worktree' : null,
          lastError: result.status === 'aborted' ? null : (result.error ?? null),
          evolvedPlanFile: result.evolvedPlanFile,
          rerunEligible,
          mergeResolutionAttempts: 0
        });

        if (result.status !== 'completed' && result.status !== 'aborted' && feature) {
          if (rerunEligible) {
            await appendAudit(context.config, {
              level: 'info',
              event: 'feature.execution.rerun.scheduled',
              message: `Scheduling full rerun ${nextAttempts + 1}/${MAX_TOTAL_EXECUTION_PASSES} for feature ${result.featureId}.`,
              data: {
                featureId: result.featureId,
                attemptsUsed: nextAttempts,
                nextAttempt: nextAttempts + 1,
                maxAttempts: MAX_TOTAL_EXECUTION_PASSES,
                error: result.error ?? null
              }
            });
            await announceProgress(
              context,
              `Feature ${getFeatureLabel(feature)} failed${result.error ? `: ${result.error}` : '.'} Scheduling full rerun ${nextAttempts + 1}/${MAX_TOTAL_EXECUTION_PASSES} for feature ${result.featureId}.`
            );
          } else {
            terminalFailedCount += 1;
            await appendAudit(context.config, {
              level: 'warn',
              event: 'feature.execution.rerun.exhausted',
              message: `Execution rerun budget exhausted for feature ${result.featureId}.`,
              data: {
                featureId: result.featureId,
                attemptsUsed: nextAttempts,
                maxAttempts: MAX_TOTAL_EXECUTION_PASSES,
                error: result.error ?? null,
                terminalStatus: result.status
              }
            });
            await announceProgress(
              context,
              `Feature ${getFeatureLabel(feature)} failed${result.error ? `: ${result.error}` : '.'} Execution rerun budget exhausted for feature ${result.featureId}.`
            );
          }
        }
      }

      await saveCheckpointSnapshot(context.config, checkpoint);

      if (context.stopController?.isRequested) {
        checkpoint.status = 'stopped';
        checkpoint.currentState = 'stopped';
        checkpoint.currentPhase = null;
        await saveCheckpointSnapshot(context.config, checkpoint);
        return {
          checkpoint,
          mergedCount
        };
      }

      if (fatalFailure) {
        checkpoint.status = 'failed';
        checkpoint.currentState = 'idle';
        checkpoint.currentPhase = null;
        await announceProgress(context, `Phase ${phase.index} halted by a fatal agent failure.`);
        await saveCheckpointSnapshot(context.config, checkpoint);
        return {
          checkpoint,
          mergedCount
        };
      }

      if (circuitBreakerTripped(terminalFailedCount, settled.length)) {
        checkpoint.status = 'failed';
        checkpoint.currentState = 'idle';
        checkpoint.currentPhase = null;
        await announceProgress(context, `Phase ${phase.index} halted by circuit breaker.`);
        await saveCheckpointSnapshot(context.config, checkpoint);
        return {
          checkpoint,
          mergedCount
        };
      }

      checkpoint.currentState = 'merging';

      const successfulFeatureIds = settled
        .flatMap((entry) =>
          entry.status === 'fulfilled' && entry.value.status === 'completed'
            ? [entry.value.featureId]
            : []
        )
        .sort((left, right) => {
          const leftScore = scoreById.get(left)?.smoothedPriority ?? 0;
          const rightScore = scoreById.get(right)?.smoothedPriority ?? 0;
          return rightScore - leftScore;
        });

      const mergeSummaries: Array<{ featureId: string; summary: EditSummary }> = [];
      if (successfulFeatureIds.length > 0) {
        checkpoint.pendingMergeSummaries = [];
        await appendMergePhaseOrderAudit(context, phase.index, successfulFeatureIds, scoreById);
      }

      for (const featureId of successfulFeatureIds) {
        const feature = checkpoint.features[featureId];
        if (!feature?.branchName) {
          continue;
        }

        const merged = await mergeBranchIntoCurrent(context.config.repoRoot, feature.branchName);
        if (merged.status === 'conflict') {
          const initialConflictFiles = merged.conflicts.map((conflict) => conflict.file);
          if (feature.worktreePath) {
            let lastConflictFiles = initialConflictFiles;
            let lastFailureStage:
              | 'conflict-resolution-approval'
              | 'conflict-resolution-turn'
              | 'post-resolution-retry'
              | null = null;
            let lastFailureReason: string | null = null;
            let mergeResolved = false;
            let terminalMergeFailure = false;

            for (let round = 1; round <= MAX_MERGE_RESOLUTION_ROUNDS; round += 1) {
              await abortMerge(feature.worktreePath).catch(() => {});
              if (round > 1) {
                await resetWorktreeToHead(feature.worktreePath);
              }
              updateFeatureCheckpoint(checkpoint, featureId, {
                mergeResolutionAttempts: round
              });
              await saveCheckpointSnapshot(context.config, checkpoint);

              const mergeIntoWorktree = await mergeBranchIntoWorktree(feature.worktreePath, baseBranch);
              if (mergeIntoWorktree.status === 'conflict') {
                const conflictFiles = mergeIntoWorktree.conflicts.map((conflict) => conflict.file);
                updateFeatureCheckpoint(checkpoint, featureId, {
                  status: 'failed',
                  lastError: conflictFiles.join(', '),
                  rerunEligible: false,
                  mergeResolutionAttempts: round
                });
                await saveCheckpointSnapshot(context.config, checkpoint);
                await appendMergeFeatureResultAudit(context, {
                  phaseIndex: phase.index,
                  feature,
                  result: 'failed',
                  failureStage: 'merge-into-worktree',
                  conflictFiles
                });
                await announceProgress(
                  context,
                  `Feature ${getFeatureLabel(feature)} failed while merging main into its worktree.`
                );
                terminalMergeFailure = true;
                break;
              }

              const conflictResolutionFiles =
                mergeIntoWorktree.status === 'conflicted'
                  ? mergeIntoWorktree.conflicts.map((conflict) => conflict.file)
                  : initialConflictFiles;

              let conflictResolution: AdapterTurnResult;
              try {
                const worktreePlanFile = feature.planFile
                  ? buildWorktreePlanFilePath(feature.planFile, feature.worktreePath)
                  : null;
                const worktreePlanContent = worktreePlanFile
                  ? await readTextFileIfExists(worktreePlanFile)
                  : null;
                const conflictResolutionPrompt = buildConflictResolutionPrompt({
                  instruction:
                    round === 1
                      ? 'The latest changes from main have been merged into your branch. Resolve all conflict markers, preserve both sides, then commit.'
                      : [
                          `This is merge conflict resolution round ${round}/${MAX_MERGE_RESOLUTION_ROUNDS}.`,
                          `The previous round failed during ${lastFailureStage ?? 'merge processing'}.`,
                          lastFailureReason ? `Failure summary: ${lastFailureReason}` : null,
                          lastConflictFiles.length > 0
                            ? `Conflicting files from the previous round: ${lastConflictFiles.join(', ')}.`
                            : null,
                          'Start fresh from the current conflict markers. Resolve all conflict markers, preserve both sides, then commit.'
                        ]
                          .filter((line): line is string => Boolean(line))
                          .join('\n'),
                  planFilePath: worktreePlanContent ? worktreePlanFile : feature.planFile,
                  planContent:
                    worktreePlanContent ??
                    (feature.planFile ? await readTextFileWithRetry(feature.planFile) : null)
                });
                conflictResolution = await runTurnAndRecord(
                  context,
                  checkpoint,
                  buildConflictResolutionRequest(
                    context,
                    featureId,
                    feature.worktreePath,
                    conflictResolutionPrompt,
                    resolveReusableSessionId(checkpoint.features[featureId] ?? feature, 'worktree')
                  )
                );
              } catch (error) {
                if (error instanceof TurnApprovalError) {
                  if (context.stopController?.isRequested) {
                    checkpoint.status = 'stopped';
                    checkpoint.currentState = 'stopped';
                    checkpoint.currentPhase = null;
                    await saveCheckpointSnapshot(context.config, checkpoint);
                    return {
                      checkpoint,
                      mergedCount
                    };
                  }
                  await abortMerge(feature.worktreePath).catch(() => {});
                  lastConflictFiles = conflictResolutionFiles;
                  lastFailureStage = 'conflict-resolution-approval';
                  lastFailureReason = error.message;

                  if (round < MAX_MERGE_RESOLUTION_ROUNDS) {
                    updateFeatureCheckpoint(checkpoint, featureId, {
                      lastError: error.message,
                      mergeResolutionAttempts: round
                    });
                    await saveCheckpointSnapshot(context.config, checkpoint);
                    await appendAudit(context.config, {
                      level: 'warn',
                      event: 'merge.conflict-resolution.retry-scheduled',
                      message: `Retrying merge conflict resolution round ${round + 1}/${MAX_MERGE_RESOLUTION_ROUNDS} for feature ${featureId}.`,
                      data: {
                        featureId,
                        phaseIndex: phase.index,
                        round,
                        nextRound: round + 1,
                        failureStage: lastFailureStage,
                        error: error.message,
                        conflictFiles: conflictResolutionFiles
                      }
                    });
                    await announceProgress(
                      context,
                      `Retrying merge conflict resolution round ${round + 1}/${MAX_MERGE_RESOLUTION_ROUNDS} for feature ${getFeatureLabel(feature)} after approval failure: ${error.message}`
                    );
                    continue;
                  }

                  updateFeatureCheckpoint(checkpoint, featureId, {
                    status: 'failed',
                    lastError: error.message,
                    rerunEligible: false,
                    mergeResolutionAttempts: round
                  });
                  await saveCheckpointSnapshot(context.config, checkpoint);
                  await appendMergeFeatureResultAudit(context, {
                    phaseIndex: phase.index,
                    feature,
                    result: 'failed',
                    failureStage: 'conflict-resolution-approval',
                    conflictFiles: conflictResolutionFiles,
                    error: error.message
                  });
                  await announceProgress(
                    context,
                    `Feature ${getFeatureLabel(feature)} failed during merge conflict resolution: ${error.message}`
                  );
                  terminalMergeFailure = true;
                  break;
                }
                throw error;
              }

              updateFeatureCheckpoint(checkpoint, featureId, {
                sessionId: conflictResolution.sessionId,
                sessionScope: conflictResolution.sessionId ? 'worktree' : null
              });

              if (!conflictResolution.ok) {
                await abortMerge(feature.worktreePath).catch(() => {});
                lastConflictFiles = conflictResolutionFiles;
                lastFailureStage = 'conflict-resolution-turn';
                lastFailureReason = conflictResolution.error ?? 'Conflict resolution failed.';

                if (round < MAX_MERGE_RESOLUTION_ROUNDS) {
                  updateFeatureCheckpoint(checkpoint, featureId, {
                    sessionId: conflictResolution.sessionId,
                    sessionScope: conflictResolution.sessionId ? 'worktree' : null,
                    lastError: conflictResolution.error,
                    mergeResolutionAttempts: round
                  });
                  await saveCheckpointSnapshot(context.config, checkpoint);
                  await appendAudit(context.config, {
                    level: 'warn',
                    event: 'merge.conflict-resolution.retry-scheduled',
                    message: `Retrying merge conflict resolution round ${round + 1}/${MAX_MERGE_RESOLUTION_ROUNDS} for feature ${featureId}.`,
                    data: {
                      featureId,
                      phaseIndex: phase.index,
                      round,
                      nextRound: round + 1,
                      failureStage: lastFailureStage,
                      error: conflictResolution.error ?? null,
                      conflictFiles: conflictResolutionFiles
                    }
                  });
                  await announceProgress(
                    context,
                    `Retrying merge conflict resolution round ${round + 1}/${MAX_MERGE_RESOLUTION_ROUNDS} for feature ${getFeatureLabel(feature)}${conflictResolution.error ? ` after failure: ${conflictResolution.error}` : '.'}`
                  );
                  continue;
                }

                updateFeatureCheckpoint(checkpoint, featureId, {
                  status: 'failed',
                  sessionId: conflictResolution.sessionId,
                  sessionScope: conflictResolution.sessionId ? 'worktree' : null,
                  lastError: conflictResolution.error,
                  rerunEligible: false,
                  mergeResolutionAttempts: round
                });
                await saveCheckpointSnapshot(context.config, checkpoint);
                await appendMergeFeatureResultAudit(context, {
                  phaseIndex: phase.index,
                  feature,
                  result: 'failed',
                  failureStage: 'conflict-resolution-turn',
                  conflictFiles: conflictResolutionFiles,
                  error: conflictResolution.error ?? null
                });
                await announceProgress(
                  context,
                  `Feature ${getFeatureLabel(feature)} failed during merge conflict resolution${conflictResolution.error ? `: ${conflictResolution.error}` : '.'}`
                );
                terminalMergeFailure = true;
                break;
              }

              await commitAllChanges(
                feature.worktreePath,
                `openweft: resolve merge conflict for feature ${featureId}`
              );
              if (feature.planFile) {
                await stagePlanFileFromWorktree(
                  context.config,
                  featureId,
                  buildWorktreePlanFilePath(feature.planFile, feature.worktreePath)
                );
              }

              const retryMerge = await mergeBranchIntoCurrent(context.config.repoRoot, feature.branchName);
              if (retryMerge.status !== 'merged') {
                const conflictFiles = retryMerge.conflicts.map((conflict) => conflict.file);
                lastConflictFiles = conflictFiles;
                lastFailureStage = 'post-resolution-retry';
                lastFailureReason = conflictFiles.join(', ');

                if (round < MAX_MERGE_RESOLUTION_ROUNDS) {
                  updateFeatureCheckpoint(checkpoint, featureId, {
                    lastError: lastFailureReason,
                    mergeResolutionAttempts: round
                  });
                  await saveCheckpointSnapshot(context.config, checkpoint);
                  await appendAudit(context.config, {
                    level: 'warn',
                    event: 'merge.conflict-resolution.retry-scheduled',
                    message: `Retrying merge conflict resolution round ${round + 1}/${MAX_MERGE_RESOLUTION_ROUNDS} for feature ${featureId}.`,
                    data: {
                      featureId,
                      phaseIndex: phase.index,
                      round,
                      nextRound: round + 1,
                      failureStage: lastFailureStage,
                      conflictFiles
                    }
                  });
                  await announceProgress(
                    context,
                    `Retrying merge conflict resolution round ${round + 1}/${MAX_MERGE_RESOLUTION_ROUNDS} for feature ${getFeatureLabel(feature)} after merge retry still conflicted.`
                  );
                  continue;
                }

                updateFeatureCheckpoint(checkpoint, featureId, {
                  status: 'failed',
                  lastError: conflictFiles.join(', '),
                  rerunEligible: false,
                  mergeResolutionAttempts: round
                });
                await saveCheckpointSnapshot(context.config, checkpoint);
                await appendMergeFeatureResultAudit(context, {
                  phaseIndex: phase.index,
                  feature,
                  result: 'failed',
                  failureStage: 'post-resolution-retry',
                  conflictFiles
                });
                await announceProgress(
                  context,
                  `Feature ${getFeatureLabel(feature)} still conflicts after ${MAX_MERGE_RESOLUTION_ROUNDS} conflict-resolution rounds.`
                );
                terminalMergeFailure = true;
                break;
              }

              const pendingMergeSummary = {
                featureId,
                summary: retryMerge.editSummary
              };
              mergeSummaries.push(pendingMergeSummary);
              checkpoint.pendingMergeSummaries = [
                ...checkpoint.pendingMergeSummaries,
                pendingMergeSummary
              ];
              mergedCount += 1;
              if (feature.planFile) {
                await promoteStagedPlan(context.config, featureId, feature.planFile);
              }
              updateFeatureCheckpoint(checkpoint, featureId, {
                status: 'completed',
                mergeCommit: retryMerge.mergeCommit,
                lastError: null,
                evolvedPlanFile: null,
                rerunEligible: false,
                mergeResolutionAttempts: 0
              });
              await saveCheckpointSnapshot(context.config, checkpoint);
              await appendMergeFeatureResultAudit(context, {
                phaseIndex: phase.index,
                feature,
                result: 'merged-after-conflict-resolution',
                conflictFiles: conflictResolutionFiles,
                editSummary: retryMerge.editSummary
              });
              await announceProgress(context, `Feature ${getFeatureLabel(feature)} complete.`);
              await removeWorktree({
                repoRoot: context.config.repoRoot,
                worktreePath: feature.worktreePath,
                branchName: feature.branchName,
                force: true
              });
              updateFeatureCheckpoint(checkpoint, featureId, {
                branchName: null,
                worktreePath: null
              });
              mergeResolved = true;
              break;
            }

            if (mergeResolved || terminalMergeFailure) {
              continue;
            }
          }

          updateFeatureCheckpoint(checkpoint, featureId, {
            status: 'failed',
            lastError: initialConflictFiles.join(', '),
            rerunEligible: false
          });
          await appendMergeFeatureResultAudit(context, {
            phaseIndex: phase.index,
            feature,
            result: 'failed',
            failureStage: 'merge-into-current',
            conflictFiles: initialConflictFiles
          });
          await announceProgress(
            context,
            `Feature ${getFeatureLabel(feature)} failed during merge conflict resolution.`
          );
          continue;
        }

        const pendingMergeSummary = {
          featureId,
          summary: merged.editSummary
        };
        mergeSummaries.push(pendingMergeSummary);
        checkpoint.pendingMergeSummaries = [
          ...checkpoint.pendingMergeSummaries,
          pendingMergeSummary
        ];
        mergedCount += 1;
        if (feature.planFile) {
          await promoteStagedPlan(context.config, featureId, feature.planFile);
        }
        updateFeatureCheckpoint(checkpoint, featureId, {
          status: 'completed',
          mergeCommit: merged.mergeCommit,
          lastError: null,
          evolvedPlanFile: null,
          rerunEligible: false,
          mergeResolutionAttempts: 0
        });
        await saveCheckpointSnapshot(context.config, checkpoint);
        await appendMergeFeatureResultAudit(context, {
          phaseIndex: phase.index,
          feature,
          result: 'merged',
          editSummary: merged.editSummary
        });
        await announceProgress(context, `Feature ${getFeatureLabel(feature)} complete.`);

        if (feature.worktreePath) {
          await removeWorktree({
            repoRoot: context.config.repoRoot,
            worktreePath: feature.worktreePath,
            branchName: feature.branchName,
            force: true
          });
          updateFeatureCheckpoint(checkpoint, featureId, {
            branchName: null,
            worktreePath: null
          });
        }
      }

      checkpoint.currentState = 're-analysis';
      emitOrchestratorEvent(context, {
        type: 'phase:re-analyzing',
        phase: phase.index,
        total: phases.length
      });
      await announceProgress(context, `Phase ${phase.index} complete. Re-planning remaining work.`);

      if ((await runPendingReanalysis(context, checkpoint, phase.index, mergeSummaries)) === 'stopped') {
        return {
          checkpoint,
          mergedCount
        };
      }

      if (shouldPauseForBudget(context.config, checkpoint)) {
        checkpoint.status = 'paused';
        checkpoint.currentState = 'idle';
        checkpoint.currentPhase = null;
        await announceProgress(context, 'Budget threshold reached. OpenWeft paused after the current phase.');
        await saveCheckpointSnapshot(context.config, checkpoint);
        return {
          checkpoint,
          mergedCount
        };
      }

      if (context.stopController?.isRequested) {
        checkpoint.status = 'stopped';
        checkpoint.currentState = 'stopped';
        checkpoint.currentPhase = null;
        await saveCheckpointSnapshot(context.config, checkpoint);
        return {
          checkpoint,
          mergedCount
        };
      }

      emitOrchestratorEvent(context, {
        type: 'phase:completed',
        phase: phase.index
      });

      checkpoint.currentPhase = null;
      checkpoint.currentState = 'queue-management';
      await saveCheckpointSnapshot(context.config, checkpoint);
    }

    checkpoint.currentState = 'idle';
    checkpoint.currentPhase = null;

    return {
      checkpoint,
      mergedCount
    };
  } finally {
    if (gcDisabled) {
      await restoreAutoGc(context.config.repoRoot, previousGc);
    }
    await rm(gcBreadcrumbFile, { force: true });
  }
};

const runRealWorkflow = async (
  input: RealRunInput
): Promise<OrchestratorOutput> => {
  const { checkpoint, recoveredExecutions, resumeReanalysisPhaseIndex } = await loadOrCreateCheckpoint(input);
  let context: RealRunContext = {
    ...input,
    checkpoint,
    mergedCount: 0,
    plannedCount: 0,
    error: null,
    recoveredExecutions,
    resumeReanalysisPhaseIndex,
    approvalState: {
      firstApprovalSatisfied: checkpoint.approvalState.firstApprovalSatisfied,
      approvedFeatureIds: new Set<string>(checkpoint.approvalState.approvedFeatureIds),
      firstApprovalPending: null,
      featureApprovalPending: new Map<string, Promise<void>>()
    }
  };

  while (true) {
    const planning = await planPendingRequests(context);
    context = {
      ...context,
      checkpoint: planning.checkpoint,
      plannedCount: context.plannedCount + planning.plannedCount
    };

    if (context.checkpoint.status === 'stopped') {
      await saveCheckpointSnapshot(context.config, context.checkpoint);
      return {
        checkpoint: context.checkpoint,
        mergedCount: context.mergedCount,
        plannedCount: context.plannedCount
      };
    }

    if (planning.plannedCount > 0) {
      await saveCheckpointSnapshot(context.config, context.checkpoint);
    }

    if (context.checkpoint.pendingMergeSummaries.length > 0) {
      context.checkpoint.currentState = 're-analysis';
      await announceProgress(
        context,
        `Resuming deferred re-analysis${context.resumeReanalysisPhaseIndex !== null ? ` from phase ${context.resumeReanalysisPhaseIndex}` : ''}.`
      );
      const replayStatus = await runPendingReanalysis(
        context,
        context.checkpoint,
        context.resumeReanalysisPhaseIndex ?? 0,
        context.checkpoint.pendingMergeSummaries
      );
      context = {
        ...context,
        resumeReanalysisPhaseIndex: null
      };

      if (
        replayStatus === 'stopped' ||
        context.checkpoint.status === 'failed' ||
        context.checkpoint.status === 'paused' ||
        context.checkpoint.status === 'stopped'
      ) {
        await saveCheckpointSnapshot(context.config, context.checkpoint);
        return {
          checkpoint: context.checkpoint,
          mergedCount: context.mergedCount,
          plannedCount: context.plannedCount
        };
      }
    }

    const { checkpoint: scoredCheckpoint, scores, phases } = await scoreAndPhaseCheckpoint(context);
    context = {
      ...context,
      checkpoint: scoredCheckpoint
    };

    if (scores.length === 0) {
      const unresolvedFailedFeatures = Object.values(context.checkpoint.features).filter(
        (feature) => feature.status === 'failed'
      );
      context.checkpoint.status = unresolvedFailedFeatures.length > 0 ? 'failed' : 'completed';
      context.checkpoint.currentState = 'idle';
      context.checkpoint.currentPhase = null;
      await saveCheckpointSnapshot(context.config, context.checkpoint);
      await announceProgress(
        context,
        unresolvedFailedFeatures.length > 0
          ? 'OpenWeft stopped with unresolved failed features requiring manual attention.'
          : 'Queue empty. OpenWeft has finished all queued work.'
      );
      return {
        checkpoint: context.checkpoint,
        mergedCount: context.mergedCount,
        plannedCount: context.plannedCount
      };
    }

    await saveCheckpointSnapshot(context.config, context.checkpoint);

    const execution = await executePhases(context, scores, phases);
    context = {
      ...context,
      checkpoint: execution.checkpoint,
      mergedCount: context.mergedCount + execution.mergedCount
    };

    if (
      context.checkpoint.status === 'failed' ||
      context.checkpoint.status === 'paused' ||
      context.checkpoint.status === 'stopped'
    ) {
      await saveCheckpointSnapshot(context.config, context.checkpoint);
      return {
        checkpoint: context.checkpoint,
        mergedCount: context.mergedCount,
        plannedCount: context.plannedCount
      };
    }
  }
};

export const runRealOrchestration = async (
  input: RealRunInput
): Promise<OrchestratorOutput> => {
  await ensureRuntimeDirectories(input.config.paths);
  const restoredAutoGc = await restoreAutoGcFromBreadcrumb(input.config);
  const prunedOrphans = await pruneOrphanedOpenWeftArtifactsAtStartup(input.config);
  await mkdir(path.dirname(input.config.paths.queueFile), { recursive: true });
  if (restoredAutoGc) {
    await appendAudit(input.config, {
      level: 'info',
      event: 'repo.gc.restored',
      message: 'Restored git gc.auto from a previous interrupted OpenWeft run.'
    });
  }
  if (prunedOrphans.removedWorktreePaths.length > 0 || prunedOrphans.removedBranchNames.length > 0) {
    await appendAudit(input.config, {
      level: 'info',
      event: 'repo.orphans.pruned',
      message: 'Pruned orphaned OpenWeft worktrees and branches before starting the run.',
      data: {
        removedWorktreePaths: prunedOrphans.removedWorktreePaths,
        removedBranchNames: prunedOrphans.removedBranchNames
      }
    });
  }
  await appendAudit(input.config, {
    level: 'info',
    event: 'run.start',
    message: 'OpenWeft run starting.',
    data: {
      backend: input.adapter.backend
    }
  });
  emitProgress(input, `OpenWeft run starting with backend ${input.adapter.backend}.`);
  return runRealWorkflow(input);
};

export { buildPlanAdjustmentPrompt };
