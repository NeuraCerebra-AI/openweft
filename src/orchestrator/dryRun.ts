import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { assign, createActor, fromPromise, setup } from 'xstate';

import { buildExecutionPrompt } from '../adapters/prompts.js';
import type { AgentAdapter } from '../adapters/types.js';
import { createPlanFilename, createPromptBFilename, formatFeatureId } from '../domain/featureIds.js';
import { addCostRecordToTotals } from '../domain/costs.js';
import type { Manifest } from '../domain/primitives.js';
import { assertLedgerSection, parseManifestDocument } from '../domain/manifest.js';
import {
  getNextFeatureIdFromQueue,
  markQueueLineProcessed,
  parseQueueFile,
  summarizeQueueRequest
} from '../domain/queue.js';
import { buildExecutionPhases } from '../domain/phases.js';
import {
  appendJsonLine,
  ensureDirectory,
  ensureRuntimeDirectories,
  readTextFileIfExists,
  writeTextFileAtomic
} from '../fs/index.js';
import type { ResolvedOpenWeftConfig } from '../config/index.js';
import {
  createEmptyCheckpoint,
  saveCheckpoint,
  type FeatureCheckpoint,
  type OrchestratorCheckpoint
} from '../state/checkpoint.js';
import { OPENWEFT_VERSION } from '../version.js';

const DRY_RUN_MODEL = 'mock-model';
interface PlannedFeature {
  id: string;
  request: string;
  lineIndex: number;
  planFilePath: string;
  manifest: Manifest;
  priorityScore: number;
}

interface DryRunMachineInput {
  config: ResolvedOpenWeftConfig;
  configHash: string;
  adapter: AgentAdapter;
}

interface DryRunMachineContext extends DryRunMachineInput {
  checkpoint: OrchestratorCheckpoint;
  plannedFeatures: PlannedFeature[];
  phases: ReturnType<typeof buildExecutionPhases>;
  error: string | null;
}

interface PlanningOutput {
  checkpoint: OrchestratorCheckpoint;
  plannedFeatures: PlannedFeature[];
  phases: ReturnType<typeof buildExecutionPhases>;
}

interface ExecutionOutput {
  checkpoint: OrchestratorCheckpoint;
}

export interface DryRunResult {
  checkpoint: OrchestratorCheckpoint;
  plannedCount: number;
  completedCount: number;
}

const timestamp = (): string => new Date().toISOString();

const createDryRunCheckpoint = (configHash: string): OrchestratorCheckpoint => {
  const createdAt = timestamp();

  return createEmptyCheckpoint({
    orchestratorVersion: OPENWEFT_VERSION,
    configHash,
    runId: randomUUID(),
    checkpointId: randomUUID(),
    createdAt
  });
};

const listExistingPlanFiles = async (featureRequestsDir: string): Promise<string[]> => {
  try {
    const entries = await readdir(featureRequestsDir);
    return entries.filter((entry) => entry.endsWith('.md'));
  } catch {
    return [];
  }
};

const cloneCheckpoint = (checkpoint: OrchestratorCheckpoint): OrchestratorCheckpoint => {
  return structuredClone(checkpoint);
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

const createDryRunScratchWorkspace = async (
  config: ResolvedOpenWeftConfig,
  featureId: string
): Promise<string> => {
  const scratchPath = path.join(config.paths.openweftDir, 'dry-run-workspaces', featureId);
  await rm(scratchPath, { recursive: true, force: true });
  await ensureDirectory(scratchPath);
  return scratchPath;
};

const planPendingRequests = async (
  input: DryRunMachineContext
): Promise<PlanningOutput> => {
  await ensureRuntimeDirectories(input.config.paths);

  const queueContent = (await readTextFileIfExists(input.config.paths.queueFile)) ?? '';
  const parsedQueue = parseQueueFile(queueContent);
  const existingPlanFiles = await listExistingPlanFiles(input.config.paths.featureRequestsDir);
  const checkpoint = cloneCheckpoint(input.checkpoint);

  checkpoint.status = parsedQueue.pending.length > 0 ? 'in-progress' : 'completed';
  checkpoint.currentState = 'planning';
  checkpoint.currentPhase = null;
  checkpoint.pendingRequests = parsedQueue.pending.map((line) => ({
    request: line.request,
    queuedAt: checkpoint.createdAt
  }));

  let nextId = getNextFeatureIdFromQueue(existingPlanFiles, queueContent);
  let updatedQueueContent = queueContent;
  const plannedFeatures: PlannedFeature[] = [];
  const usedPlanFiles = new Set(existingPlanFiles);
  let workingQueue = parsedQueue;

  while (workingQueue.pending.length > 0) {
    const pending = workingQueue.pending[0];
    if (!pending) {
      break;
    }

    const featureId = formatFeatureId(nextId);
    nextId += 1;

    const stageOne = await input.adapter.runTurn({
      featureId,
      stage: 'planning-s1',
      cwd: input.config.repoRoot,
      prompt: `Dry-run planning stage 1 for: ${pending.request}`,
      model: DRY_RUN_MODEL,
      auth: { method: 'subscription' }
    });
    if (!stageOne.ok) {
      throw new Error(stageOne.error);
    }

    const promptBFilename = createPromptBFilename(nextId - 1, pending.request);
    const promptBFilePath = path.join(input.config.paths.promptBArtifactsDir, promptBFilename);
    const promptBMarkdown = `${stageOne.finalMessage.trimEnd()}\n`;
    await writeTextFileAtomic(promptBFilePath, promptBMarkdown);

    const stageTwo = await input.adapter.runTurn({
      featureId,
      stage: 'planning-s2',
      cwd: input.config.repoRoot,
      prompt: [
        `IMPORTANT: Dry-run planning stage 2 for: ${pending.request}`,
        `IMPORTANT: The Prompt B artifact has been saved at ${promptBFilePath}.`,
        '=== PROMPT B START ===',
        promptBMarkdown.trim(),
        '=== PROMPT B END ==='
      ].join('\n'),
      model: DRY_RUN_MODEL,
      auth: { method: 'subscription' },
      sessionId: stageOne.sessionId
    });
    if (!stageTwo.ok) {
      throw new Error(stageTwo.error);
    }

    await appendJsonLine(input.config.paths.costsFile, stageOne.costRecord);
    await appendJsonLine(input.config.paths.costsFile, stageTwo.costRecord);
    checkpoint.cost = addCostRecordToTotals(checkpoint.cost, stageOne.costRecord);
    checkpoint.cost = addCostRecordToTotals(checkpoint.cost, stageTwo.costRecord);

    const planMarkdown = `${stageTwo.finalMessage.trimEnd()}\n`;
    assertLedgerSection(planMarkdown);
    const parsedPlan = parseManifestDocument(planMarkdown);

    const planFilename = createPlanFilename(nextId - 1, pending.request, usedPlanFiles);
    usedPlanFiles.add(planFilename);
    const planFilePath = path.join(input.config.paths.featureRequestsDir, planFilename);
    await writeTextFileAtomic(planFilePath, planMarkdown);
    updatedQueueContent = markQueueLineProcessed(
      updatedQueueContent,
      pending.lineIndex,
      featureId,
      pending.request,
      pending.request
    );

    const plannedFeature: PlannedFeature = {
      id: featureId,
      request: pending.request,
      lineIndex: pending.lineIndex,
      planFilePath,
      manifest: parsedPlan.manifest,
      priorityScore: 1
    };
    plannedFeatures.push(plannedFeature);
    checkpoint.features[featureId] = {
      id: featureId,
      title: summarizeQueueRequest(pending.request),
      request: pending.request,
      status: 'planned',
      attempts: 0,
      planFile: planFilePath,
      promptBFile: promptBFilePath,
      branchName: null,
      worktreePath: null,
      sessionId: stageTwo.sessionId,
      sessionScope: stageTwo.sessionId ? 'repo' : null,
      backend: 'mock',
      manifest: parsedPlan.manifest,
      priorityScore: 1,
      priorityTier: 'medium',
      updatedAt: timestamp()
    };
    workingQueue = parseQueueFile(updatedQueueContent);
    checkpoint.pendingRequests = workingQueue.pending.map((line) => ({
      request: line.request,
      queuedAt: checkpoint.createdAt
    }));
  }

  await writeTextFileAtomic(input.config.paths.queueFile, updatedQueueContent || '# OpenWeft feature queue\n');

  checkpoint.queue = {
    orderedFeatureIds: plannedFeatures.map((feature) => feature.id),
    totalCount: plannedFeatures.length
  };
  checkpoint.pendingRequests = workingQueue.pending.map((line) => ({
    request: line.request,
    queuedAt: checkpoint.createdAt
  }));
  if (workingQueue.pending.length === 0) {
    checkpoint.pendingRequests = [];
  }

  await saveCheckpointSnapshot(input.config, checkpoint);

  return {
    checkpoint,
    plannedFeatures,
    phases: buildExecutionPhases(
      plannedFeatures.map((feature) => ({
        id: feature.id,
        manifest: feature.manifest,
        priorityScore: feature.priorityScore
      })),
      undefined,
      input.config.concurrency.maxParallelAgents
    )
  };
};

const executePlannedFeatures = async (
  input: DryRunMachineContext
): Promise<ExecutionOutput> => {
  const checkpoint = cloneCheckpoint(input.checkpoint);

  if (input.plannedFeatures.length === 0) {
    checkpoint.status = 'completed';
    checkpoint.currentState = 'idle';
    checkpoint.currentPhase = null;
    await saveCheckpointSnapshot(input.config, checkpoint);
    return { checkpoint };
  }

  for (const phase of input.phases) {
    checkpoint.status = 'in-progress';
    checkpoint.currentState = 'executing';
    checkpoint.currentPhase = {
      index: phase.index,
      name: `Phase ${phase.index}`,
      featureIds: phase.featureIds,
      startedAt: timestamp()
    };

    for (const featureId of phase.featureIds) {
      updateFeatureCheckpoint(checkpoint, featureId, {
        status: 'executing'
      });
    }

    await saveCheckpointSnapshot(input.config, checkpoint);

    const settled = await Promise.allSettled(
      phase.features.map(async (feature) => {
        const featureCheckpoint = checkpoint.features[feature.id];
        if (!featureCheckpoint?.planFile || !featureCheckpoint?.promptBFile) {
          throw new Error(`Feature ${feature.id} does not have a plan file.`);
        }

        const promptBContent = (await readTextFileIfExists(featureCheckpoint.promptBFile)) ?? '';
        const planContent = (await readTextFileIfExists(featureCheckpoint.planFile)) ?? '';
        const executionPrompt = buildExecutionPrompt({
          promptBFilePath: featureCheckpoint.promptBFile,
          promptBContent,
          planFilePath: featureCheckpoint.planFile,
          planContent
        });

        const scratchWorkspace = await createDryRunScratchWorkspace(input.config, feature.id);
        const result = await input.adapter.runTurn({
          featureId: feature.id,
          stage: 'execution',
          cwd: scratchWorkspace,
          prompt: executionPrompt,
          model: DRY_RUN_MODEL,
          auth: { method: 'subscription' },
          sessionId:
            featureCheckpoint.sessionId && featureCheckpoint.sessionScope === 'repo'
              ? featureCheckpoint.sessionId
              : null
        });

        return {
          featureId: feature.id,
          result
        };
      })
    );

    for (const settledFeature of settled) {
      if (settledFeature.status === 'fulfilled') {
        const { featureId, result } = settledFeature.value;
        if (result.ok) {
          await appendJsonLine(input.config.paths.costsFile, result.costRecord);
          checkpoint.cost = addCostRecordToTotals(checkpoint.cost, result.costRecord);
          updateFeatureCheckpoint(checkpoint, featureId, {
            status: 'completed',
            attempts: (checkpoint.features[featureId]?.attempts ?? 0) + 1,
            sessionId: result.sessionId,
            sessionScope: result.sessionId ? 'repo' : null,
            backend: 'mock'
          });
        } else {
          updateFeatureCheckpoint(checkpoint, featureId, {
            status: 'failed',
            attempts: (checkpoint.features[featureId]?.attempts ?? 0) + 1,
            sessionId: result.sessionId,
            sessionScope: result.sessionId ? 'repo' : null,
            backend: 'mock'
          });
        }
        continue;
      }

      const featureIdMatch = /Feature (\d+)/.exec(String(settledFeature.reason));
      if (featureIdMatch?.[1] && checkpoint.features[featureIdMatch[1]]) {
        updateFeatureCheckpoint(checkpoint, featureIdMatch[1], {
          status: 'failed',
          attempts: (checkpoint.features[featureIdMatch[1]]?.attempts ?? 0) + 1
        });
      }
    }

    await saveCheckpointSnapshot(input.config, checkpoint);
  }

  checkpoint.status = 'completed';
  checkpoint.currentState = 'idle';
  checkpoint.currentPhase = null;
  await saveCheckpointSnapshot(input.config, checkpoint);

  return {
    checkpoint
  };
};

const dryRunMachine = setup({
  types: {
    input: {} as DryRunMachineInput,
    context: {} as DryRunMachineContext
  },
  actors: {
    planPendingRequests: fromPromise<PlanningOutput, DryRunMachineContext>(async ({ input }) =>
      planPendingRequests(input)
    ),
    executePlannedFeatures: fromPromise<ExecutionOutput, DryRunMachineContext>(async ({ input }) =>
      executePlannedFeatures(input)
    )
  }
}).createMachine({
  id: 'openweftDryRun',
  initial: 'planning',
  context: ({ input }) => ({
    ...input,
    checkpoint: createDryRunCheckpoint(input.configHash),
    plannedFeatures: [],
    phases: [],
    error: null
  }),
  states: {
    planning: {
      invoke: {
        src: 'planPendingRequests',
        input: ({ context }) => context,
        onDone: {
          target: 'executing',
          actions: assign(({ context, event }) => ({
            ...context,
            checkpoint: event.output.checkpoint,
            plannedFeatures: event.output.plannedFeatures,
            phases: event.output.phases,
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
    executing: {
      invoke: {
        src: 'executePlannedFeatures',
        input: ({ context }) => context,
        onDone: {
          target: 'completed',
          actions: assign(({ context, event }) => ({
            ...context,
            checkpoint: event.output.checkpoint,
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
    plannedCount: context.plannedFeatures.length,
    completedCount: Object.values(context.checkpoint.features).filter(
      (feature) => feature.status === 'completed'
    ).length
  })
});

export const runDryRunOrchestration = async (
  input: DryRunMachineInput
): Promise<DryRunResult> => {
  const actor = createActor(dryRunMachine, {
    input
  });

  return new Promise((resolve, reject) => {
    let settled = false;

    actor.subscribe((snapshot) => {
      if (settled) {
        return;
      }

      if (snapshot.status !== 'done') {
        return;
      }

      settled = true;
      if (!snapshot.output) {
        reject(new Error('Dry-run orchestration did not complete successfully.'));
        return;
      }

      resolve(snapshot.output as DryRunResult);
    });

    actor.start();
  });
};
