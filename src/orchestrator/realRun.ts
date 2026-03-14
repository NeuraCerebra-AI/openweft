import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import PQueue from 'p-queue';
import { assign, createActor, fromPromise, setup } from 'xstate';
import { simpleGit } from 'simple-git';

import { buildExecutionPrompt, CODE_EDIT_SUMMARY_MARKER, injectPromptTemplate, USER_REQUEST_MARKER } from '../adapters/prompts.js';
import type { AgentAdapter, AdapterCommandSpec, AdapterTurnRequest, AdapterTurnResult } from '../adapters/types.js';
import type { OrchestratorEventHandler } from '../ui/events.js';
import type { ResolvedOpenWeftConfig } from '../config/index.js';
import { addCostRecordToTotals, type CostRecord } from '../domain/costs.js';
import { circuitBreakerTripped } from '../domain/errors.js';
import { createPlanFilename, formatFeatureId, slugifyFeatureRequest } from '../domain/featureIds.js';
import { parseManifestDocument, type Manifest, updateManifestInMarkdown } from '../domain/manifest.js';
import { buildExecutionPhases } from '../domain/phases.js';
import type { PriorityTier } from '../domain/primitives.js';
import {
  getNextFeatureIdFromQueue,
  markQueueLineProcessed,
  parseQueueFile
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
  commitAllChanges,
  createWorktree,
  getAutoGcSetting,
  getHeadCommit,
  getWorktreeStatusSummary,
  hasChangesSince,
  mergeBranchIntoCurrent,
  mergeBranchIntoWorktree,
  removeWorktree,
  resetWorktreeToHead,
  restoreAutoGc,
  setAutoGc
} from '../git/index.js';
import { sendOpenWeftNotification, type NotificationDependencies, type NotificationResult } from '../notifications/index.js';
import {
  createEmptyCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  type FeatureCheckpoint,
  type OrchestratorCheckpoint
} from '../state/checkpoint.js';
import { getTmuxSlotLogFile, type TmuxMonitor } from '../tmux/index.js';
import { appendAuditEntry } from './audit.js';
import type { StopController } from './stop.js';

const ORCHESTRATOR_VERSION = '0.1.0';
const STAGE_ONE_MIN_LENGTH = 10;

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
}

interface RealRunContext extends RealRunInput {
  checkpoint: OrchestratorCheckpoint;
  mergedCount: number;
  plannedCount: number;
  error: string | null;
}

const timestamp = (): string => new Date().toISOString();

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
    orchestratorVersion: ORCHESTRATOR_VERSION,
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
    `The plan file to inspect and update is at ${input.planFilePath}.`,
    'Review the current repository state, determine whether the merged edits interfere with this plan, and update both the plan steps and manifest in place if needed.',
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
): Promise<OrchestratorCheckpoint> => {
  const existing = await loadCheckpoint({
    checkpointFile: input.config.paths.checkpointFile,
    checkpointBackupFile: input.config.paths.checkpointBackupFile
  });

  if (!existing.checkpoint) {
    return createFreshCheckpoint(input.configHash);
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
  checkpoint.currentPhase = null;
  checkpoint.currentState = 'idle';

  for (const feature of Object.values(checkpoint.features)) {
    if (feature.status === 'executing') {
      feature.status = 'planned';
      feature.sessionId = null;
      feature.sessionScope = null;
      feature.updatedAt = timestamp();
    }
  }

  return checkpoint;
};

const collectScoringPaths = async (
  repoRoot: string,
  paths: string[]
): Promise<RepoRiskContext> => {
  const uniquePaths = [...new Set(paths)];
  const sourceFiles: string[] = [];
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
        sourceFiles.push(entryPath);
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
    const relativeSource = path.relative(repoRoot, sourceFile).replace(/\\/g, '/');
    const content = await readFile(sourceFile, 'utf8').catch(() => '');

    for (const target of normalizedNeedles) {
      if (relativeSource === target.path) {
        continue;
      }

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

const syncPlanFileToWorktree = async (
  config: ResolvedOpenWeftConfig,
  planFile: string,
  worktreePath: string
): Promise<string> => {
  const targetPlanPath = path.join(
    worktreePath,
    '.openweft',
    'feature-plans',
    path.basename(planFile)
  );
  const content = await readTextFileWithRetry(planFile);
  await writeTextFileAtomic(targetPlanPath, content);
  return targetPlanPath;
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
  ...(input.adapter.backend === 'codex'
    ? {
        sandboxMode: 'workspace-write' as const,
        isolatedHomeDir: buildCodexHomeDir(input.config, featureId, 'planning-s2')
      }
    : {}),
  ...(input.adapter.backend === 'claude'
    ? {
        claudePermissionMode: 'bypassPermissions' as const
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
  ...(input.adapter.backend === 'codex'
    ? {
        sandboxMode: 'workspace-write' as const,
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
  ...(input.adapter.backend === 'codex'
    ? {
        sandboxMode: 'workspace-write' as const,
        isolatedHomeDir: buildCodexHomeDir(input.config, featureId, 'session')
      }
    : {}),
  ...(input.adapter.backend === 'claude'
    ? {
        claudePermissionMode: 'acceptEdits' as const
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
  ...(input.adapter.backend === 'codex'
    ? {
        sandboxMode: 'workspace-write' as const,
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
  input: RealRunInput,
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

const repairPlanMarkdownIfNeeded = async (
  input: RealRunInput,
  checkpoint: OrchestratorCheckpoint,
  featureId: string,
  request: string,
  initialMarkdown: string,
  shadowMarkdown: string | null
): Promise<{ markdown: string; manifest: Manifest; sessionId: string | null }> => {
  try {
    const parsed = parseManifestDocument(initialMarkdown, {
      ...(shadowMarkdown
        ? {
            lastKnownGood: parseManifestDocument(shadowMarkdown).manifest
          }
        : {})
    });

    return {
      markdown: updateManifestInMarkdown(initialMarkdown, parsed.manifest),
      manifest: parsed.manifest,
      sessionId: null
    };
  } catch (error) {
    const repairPrompt = [
      `Your previous plan output for feature ${featureId} was invalid.`,
      `Feature request: ${request}`,
      `Validation error: ${error instanceof Error ? error.message : String(error)}`,
      'Rewrite the full plan and include a valid ## Manifest block with strict JSON.'
    ].join('\n\n');

    const repairResult = await runTurnAndRecord(
      input,
      checkpoint,
      buildPlanningStageTwoRequest(input, featureId, repairPrompt)
    );

    if (!repairResult.ok) {
      throw new Error(repairResult.error);
    }

    const repaired = parseManifestDocument(repairResult.finalMessage, {
      ...(shadowMarkdown
        ? {
            lastKnownGood: parseManifestDocument(shadowMarkdown).manifest
          }
        : {})
    });

    return {
      markdown: updateManifestInMarkdown(repairResult.finalMessage, repaired.manifest),
      manifest: repaired.manifest,
      sessionId: repairResult.sessionId
    };
  }
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

  checkpoint.status = 'in-progress';
  checkpoint.currentState = 'planning';

  for (const pending of parsedQueue.pending) {
    const featureId = formatFeatureId(nextFeatureId);
    nextFeatureId += 1;

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

    const stageTwo = await runTurnAndRecord(
      context,
      checkpoint,
      buildPlanningStageTwoRequest(context, featureId, stageOne.finalMessage.trim())
    );

    if (!stageTwo.ok) {
      throw new Error(stageTwo.error);
    }

    const shadowMarkdown = await maybeReadShadowPlan(context.config, featureId);
    const repairedPlan = await repairPlanMarkdownIfNeeded(
      context,
      checkpoint,
      featureId,
      pending.request,
      stageTwo.finalMessage,
      shadowMarkdown
    );

    const planFilename = createPlanFilename(Number.parseInt(featureId, 10), pending.request, usedPlanFiles);
    usedPlanFiles.add(planFilename);
    const planFilePath = path.join(context.config.paths.featureRequestsDir, planFilename);

    await writeTextFileAtomic(planFilePath, repairedPlan.markdown);
    await writeShadowPlan(context.config, featureId, repairedPlan.markdown);

    updatedQueueContent = markQueueLineProcessed(updatedQueueContent, pending.lineIndex, featureId, pending.request);

    checkpoint.features[featureId] = {
      id: featureId,
      title: pending.request,
      request: pending.request,
      status: 'planned',
      attempts: 0,
      planFile: planFilePath,
      branchName: null,
      worktreePath: null,
      sessionId: repairedPlan.sessionId,
      sessionScope: repairedPlan.sessionId ? 'repo' : null,
      backend: context.adapter.backend,
      manifest: repairedPlan.manifest,
      priorityScore: null,
      priorityTier: null,
      scoringCycles: 0,
      updatedAt: timestamp()
    };
  }

  await writeTextFileAtomic(
    context.config.paths.queueFile,
    updatedQueueContent || '# OpenWeft feature queue\n'
  );

  checkpoint.pendingRequests = [];

  return {
    checkpoint,
    plannedCount: parsedQueue.pending.length
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
  const executableFeatures = Object.values(checkpoint.features).filter((feature) =>
    feature.status === 'planned' || feature.status === 'failed'
  );

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

const runFeatureExecutionAttempt = async (
  context: RealRunContext,
  checkpoint: OrchestratorCheckpoint,
  feature: FeatureCheckpoint,
  baseBranch: string
): Promise<{
  featureId: string;
  status: 'completed' | 'failed' | 'fatal';
  branchName: string | null;
  worktreePath: string | null;
  sessionId: string | null;
  baselineCommit: string | null;
  error?: string;
}> => {
  const worktreeState = await createOrResetFeatureWorktree(context, feature, baseBranch);
  const worktreePlanFile = feature.planFile
    ? await syncPlanFileToWorktree(context.config, feature.planFile, worktreeState.worktreePath)
    : null;

  if (!feature.planFile || !worktreePlanFile) {
    return {
      featureId: feature.id,
      status: 'fatal',
      branchName: worktreeState.branchName,
      worktreePath: worktreeState.worktreePath,
      sessionId: null,
      baselineCommit: worktreeState.baselineCommit,
      error: 'Feature plan file is missing.'
    };
  }

  const planContent = await readTextFileWithRetry(feature.planFile);
  const executionPrompt = buildExecutionPrompt({
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
    const result = await runTurnAndRecord(
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
          branchName: worktreeState.branchName,
          worktreePath: worktreeState.worktreePath,
          sessionId,
          baselineCommit: worktreeState.baselineCommit,
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
          branchName: worktreeState.branchName,
          worktreePath: worktreeState.worktreePath,
          sessionId,
          baselineCommit: worktreeState.baselineCommit,
          error: 'Agent produced changes, but OpenWeft could not create a feature commit.'
        };
      }

      return {
        featureId: feature.id,
        status: 'completed',
        branchName: worktreeState.branchName,
        worktreePath: worktreeState.worktreePath,
        sessionId,
        baselineCommit: worktreeState.baselineCommit
      };
    }

    if (result.classified.tier === 'fatal') {
      return {
        featureId: feature.id,
        status: 'fatal',
        branchName: worktreeState.branchName,
        worktreePath: worktreeState.worktreePath,
        sessionId: result.sessionId,
        baselineCommit: worktreeState.baselineCommit,
        error: result.error
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
      const retryResult = await runTurnAndRecord(
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
            branchName: worktreeState.branchName,
            worktreePath: worktreeState.worktreePath,
            sessionId,
            baselineCommit: worktreeState.baselineCommit,
            error: 'Agent retry completed without a committable result.'
          };
        }

        return {
          featureId: feature.id,
          status: 'completed',
          branchName: worktreeState.branchName,
          worktreePath: worktreeState.worktreePath,
          sessionId,
          baselineCommit: worktreeState.baselineCommit
        };
      }

      return {
        featureId: feature.id,
        status: retryResult.classified.tier === 'fatal' ? 'fatal' : 'failed',
        branchName: worktreeState.branchName,
        worktreePath: worktreeState.worktreePath,
        sessionId: retryResult.sessionId,
        baselineCommit: worktreeState.baselineCommit,
        error: retryResult.error
      };
    }

    return {
      featureId: feature.id,
      status: 'failed',
      branchName: worktreeState.branchName,
      worktreePath: worktreeState.worktreePath,
      sessionId: result.sessionId,
      baselineCommit: worktreeState.baselineCommit,
      error: result.error
    };
  }
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
  await setAutoGc(context.config.repoRoot, '0');

  try {
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

      const fatalFailure = settled.find(
        (entry) => entry.status === 'fulfilled' && entry.value.status === 'fatal'
      );
      const failedCount = settled.filter(
        (entry) => entry.status === 'rejected' || (entry.status === 'fulfilled' && entry.value.status !== 'completed')
      ).length;

      for (const settledFeature of settled) {
        if (settledFeature.status === 'rejected') {
          continue;
        }

        const result = settledFeature.value;
        const feature = checkpoint.features[result.featureId];
        updateFeatureCheckpoint(checkpoint, result.featureId, {
          status:
            result.status === 'completed'
              ? 'planned'
              : result.status === 'fatal'
                ? 'failed'
                : 'failed',
          attempts: (checkpoint.features[result.featureId]?.attempts ?? 0) + 1,
          branchName: result.branchName,
          worktreePath: result.worktreePath,
          sessionId: result.sessionId,
          sessionScope: result.sessionId ? 'worktree' : null,
          lastError: result.error ?? null
        });

        if (result.status !== 'completed' && feature) {
          await announceProgress(
            context,
            `Feature ${getFeatureLabel(feature)} failed${result.error ? `: ${result.error}` : '.'}`
          );
        }
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

      if (circuitBreakerTripped(failedCount, settled.length)) {
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
        .filter(
          (entry): entry is PromiseFulfilledResult<Awaited<ReturnType<typeof runFeatureExecutionAttempt>>> =>
            entry.status === 'fulfilled' && entry.value.status === 'completed'
        )
        .map((entry) => entry.value.featureId)
        .sort((left, right) => {
          const leftScore = scoreById.get(left)?.smoothedPriority ?? 0;
          const rightScore = scoreById.get(right)?.smoothedPriority ?? 0;
          return rightScore - leftScore;
        });

      const mergeSummaries: Array<{ featureId: string; summary: Record<string, unknown> }> = [];

      for (const featureId of successfulFeatureIds) {
        const feature = checkpoint.features[featureId];
        if (!feature?.branchName) {
          continue;
        }

        const merged = await mergeBranchIntoCurrent(context.config.repoRoot, feature.branchName);
        if (merged.status === 'conflict') {
          if (
            feature.worktreePath &&
            resolveReusableSessionId(feature, 'worktree')
          ) {
            const mergeIntoWorktree = await mergeBranchIntoWorktree(feature.worktreePath, baseBranch);
            if (mergeIntoWorktree.status === 'conflict') {
              updateFeatureCheckpoint(checkpoint, featureId, {
                status: 'failed',
                lastError: mergeIntoWorktree.conflicts.map((conflict) => conflict.file).join(', ')
              });
              await announceProgress(
                context,
                `Feature ${getFeatureLabel(feature)} failed while merging main into its worktree.`
              );
              continue;
            }

            const conflictResolution = await runTurnAndRecord(
              context,
              checkpoint,
              buildConflictResolutionRequest(
                context,
                featureId,
                feature.worktreePath,
                'The latest changes from main have been merged into your branch. Resolve all conflict markers, preserve both sides, then commit.',
                resolveReusableSessionId(feature, 'worktree')
              )
            );

            if (!conflictResolution.ok) {
              updateFeatureCheckpoint(checkpoint, featureId, {
                status: 'failed',
                sessionId: conflictResolution.sessionId,
                sessionScope: conflictResolution.sessionId ? 'worktree' : null,
                lastError: conflictResolution.error
              });
              await announceProgress(
                context,
                `Feature ${getFeatureLabel(feature)} failed during merge conflict resolution${conflictResolution.error ? `: ${conflictResolution.error}` : '.'}`
              );
              continue;
            }

            updateFeatureCheckpoint(checkpoint, featureId, {
              sessionId: conflictResolution.sessionId,
              sessionScope: conflictResolution.sessionId ? 'worktree' : null
            });

            await commitAllChanges(
              feature.worktreePath,
              `openweft: resolve merge conflict for feature ${featureId}`
            );

            const retryMerge = await mergeBranchIntoCurrent(context.config.repoRoot, feature.branchName);
            if (retryMerge.status !== 'merged') {
              updateFeatureCheckpoint(checkpoint, featureId, {
                status: 'failed',
                lastError: retryMerge.conflicts.map((conflict) => conflict.file).join(', ')
              });
              await announceProgress(
                context,
                `Feature ${getFeatureLabel(feature)} still conflicts after agent conflict resolution.`
              );
              continue;
            }

            mergeSummaries.push({
              featureId,
              summary: retryMerge.editSummary as unknown as Record<string, unknown>
            });
            mergedCount += 1;
            updateFeatureCheckpoint(checkpoint, featureId, {
              status: 'completed',
              lastError: null
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
            continue;
          }

          updateFeatureCheckpoint(checkpoint, featureId, {
            status: 'failed',
            lastError: merged.conflicts.map((conflict) => conflict.file).join(', ')
          });
          await announceProgress(
            context,
            `Feature ${getFeatureLabel(feature)} failed during merge conflict resolution.`
          );
          continue;
        }

        mergeSummaries.push({
          featureId,
          summary: merged.editSummary as unknown as Record<string, unknown>
        });
        mergedCount += 1;
        updateFeatureCheckpoint(checkpoint, featureId, {
          status: 'completed',
          lastError: null
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
      await announceProgress(context, `Phase ${phase.index} complete. Re-planning remaining work.`);

      for (const mergedSummary of mergeSummaries) {
        const remaining = Object.values(checkpoint.features).filter((feature) =>
          feature.status === 'planned' || feature.status === 'failed'
        );

        if (remaining.length === 0) {
          break;
        }

        const template = await readTextFileWithRetry(context.config.paths.planAdjustment);
        for (const feature of remaining) {
          if (!feature.planFile) {
            continue;
          }

          const planFile = feature.planFile;
          const currentPlan = await readTextFileWithRetry(planFile);
          await writeShadowPlan(context.config, feature.id, currentPlan);

          const prompt = buildPlanAdjustmentPrompt({
            template,
            planFilePath: planFile,
            planContent: currentPlan,
            codeEditSummaryJson: JSON.stringify(mergedSummary.summary, null, 2)
          });
          const adjustment = await runTurnAndRecord(
            context,
            checkpoint,
            buildAdjustmentRequest(
              context,
              feature.id,
              prompt,
              resolveReusableSessionId(feature, 'repo')
            )
          );

          if (!adjustment.ok) {
            updateFeatureCheckpoint(checkpoint, feature.id, {
              lastError: adjustment.error
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
            continue;
          }

          const adjustedPlan = await readTextFileWithRetry(planFile);
          const shadowPlan = await maybeReadShadowPlan(context.config, feature.id);
          const parsed = parseManifestDocument(adjustedPlan, {
            ...(shadowPlan
              ? {
                  lastKnownGood: parseManifestDocument(shadowPlan).manifest
                }
              : {})
          });
          await writeTextFileAtomic(planFile, updateManifestInMarkdown(adjustedPlan, parsed.manifest));
          updateFeatureCheckpoint(checkpoint, feature.id, {
            manifest: parsed.manifest,
            sessionId: adjustment.sessionId,
            sessionScope: adjustment.sessionId ? 'repo' : null,
            lastError: null
          });
        }
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
    await restoreAutoGc(context.config.repoRoot, previousGc);
  }
};

const runRealWorkflow = async (
  input: RealRunInput
): Promise<OrchestratorOutput> => {
  const checkpoint = await loadOrCreateCheckpoint(input);
  let context: RealRunContext = {
    ...input,
    checkpoint,
    mergedCount: 0,
    plannedCount: 0,
    error: null
  };

  while (true) {
    const planning = await planPendingRequests(context);
    context = {
      ...context,
      checkpoint: planning.checkpoint,
      plannedCount: context.plannedCount + planning.plannedCount
    };

    const { checkpoint: scoredCheckpoint, scores, phases } = await scoreAndPhaseCheckpoint(context);
    context = {
      ...context,
      checkpoint: scoredCheckpoint
    };

    if (scores.length === 0) {
      context.checkpoint.status = 'completed';
      context.checkpoint.currentState = 'idle';
      context.checkpoint.currentPhase = null;
      await saveCheckpointSnapshot(context.config, context.checkpoint);
      await announceProgress(context, 'Queue empty. OpenWeft has finished all queued work.');
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

const machine = setup({
  types: {
    input: {} as RealRunInput,
    context: {} as RealRunContext
  },
  actors: {
    runWorkflow: fromPromise<OrchestratorOutput, RealRunContext>(async ({ input }) => runRealWorkflow(input))
  }
}).createMachine({
  id: 'openweftRealRun',
  initial: 'running',
  context: ({ input }) => ({
    ...input,
    checkpoint: createFreshCheckpoint(input.configHash),
    mergedCount: 0,
    plannedCount: 0,
    error: null
  }),
  states: {
    running: {
      invoke: {
        src: 'runWorkflow',
        input: ({ context }) => context,
        onDone: {
          target: 'completed',
          actions: assign(({ context, event }) => ({
            ...context,
            checkpoint: event.output.checkpoint,
            mergedCount: event.output.mergedCount,
            plannedCount: event.output.plannedCount,
            error: null
          }))
        },
        onError: {
          target: 'failed',
          actions: assign(({ context, event }) => ({
            ...context,
            error: event.error instanceof Error ? event.error.message : String(event.error)
          }))
        }
      }
    },
    completed: {
      type: 'final'
    },
    failed: {
      type: 'final'
    }
  },
  output: ({ context }) => ({
    checkpoint: context.checkpoint,
    mergedCount: context.mergedCount,
    plannedCount: context.plannedCount
  })
});

export const runRealOrchestration = async (
  input: RealRunInput
): Promise<OrchestratorOutput> => {
  await ensureRuntimeDirectories(input.config.paths);
  await mkdir(path.dirname(input.config.paths.queueFile), { recursive: true });
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
