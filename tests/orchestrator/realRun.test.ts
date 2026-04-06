import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';

import { MockAgentAdapter } from '../../src/adapters/mock.js';
import type {
  AgentAdapter,
  AdapterCommandSpec,
  AdapterTurnRequest,
  AdapterTurnResult
} from '../../src/adapters/types.js';
import { loadOpenWeftConfig } from '../../src/config/index.js';
import { createPromptBFilename } from '../../src/domain/featureIds.js';
import { createWorktree, getAutoGcSetting, listWorktrees, setAutoGc } from '../../src/git/index.js';
import type { NotificationDependencies } from '../../src/notifications/index.js';
import { ApprovalController } from '../../src/orchestrator/approval.js';
import { StopController } from '../../src/orchestrator/stop.js';
import { runRealOrchestration } from '../../src/orchestrator/realRun.js';
import type { LoadCheckpointResult } from '../../src/state/checkpoint.js';
import { createEmptyCheckpoint, loadCheckpoint, saveCheckpoint } from '../../src/state/checkpoint.js';

const TEST_LEDGER_SECTION = `## Ledger

### Constraints
- Keep the change set small.

### Assumptions
- The manifest is conservative.

### Watchpoints
- Preserve orchestrator compatibility.

### Validation
- Run targeted checks.
`;

const appendLedgerNoteToPlan = async (planPath: string, note: string): Promise<void> => {
  const currentPlan = await readFile(planPath, 'utf8');
  const updatedPlan = currentPlan.includes('- Run targeted checks.')
    ? currentPlan.replace('- Run targeted checks.', `- Run targeted checks.\n- ${note}`)
    : currentPlan.includes('- Run targeted validation before completion.')
      ? currentPlan.replace(
          '- Run targeted validation before completion.',
          `- Run targeted validation before completion.\n- ${note}`
        )
      : `${currentPlan.trimEnd()}\n- ${note}\n`;

  await writeFile(
    planPath,
    updatedPlan,
    'utf8'
  );
};

const extractExecutionPlanPath = (prompt: string): string => {
  const match = prompt.match(
    /The supporting implementation plan is also provided below and is available at ([\s\S]+?)\.\nUse Prompt B/
  );
  if (!match?.[1]) {
    throw new Error('Execution prompt did not expose the worktree plan path.');
  }

  return match[1];
};

const extractConflictPromptPlanPath = (prompt: string): string => {
  const match = prompt.match(
    /The original implementation plan is available at ([\s\S]+?) and is included below for context\./
  );
  if (!match?.[1]) {
    throw new Error('Conflict-resolution prompt did not expose the plan path.');
  }

  return match[1];
};

const buildEvolvedPlanPath = (
  config: Awaited<ReturnType<typeof loadOpenWeftConfig>>['config'],
  featureId: string
): string => {
  return path.join(config.paths.openweftDir, 'evolved-plans', `${featureId}.md`);
};

class RecordingAdapter implements AgentAdapter {
  readonly backend: AgentAdapter['backend'];

  readonly requests: AdapterTurnRequest[] = [];

  constructor(private readonly inner: AgentAdapter) {
    this.backend = inner.backend;
  }

  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec {
    return this.inner.buildCommand(request);
  }

  async runTurn(request: AdapterTurnRequest): Promise<AdapterTurnResult> {
    this.requests.push(request);
    return this.inner.runTurn(request);
  }
}

class RecordingClaudeFailureAdapter implements AgentAdapter {
  readonly backend = 'claude' as const;

  readonly requests: AdapterTurnRequest[] = [];

  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec {
    return {
      command: 'claude',
      args: ['-p'],
      cwd: request.cwd
    };
  }

  async runTurn(request: AdapterTurnRequest): Promise<AdapterTurnResult> {
    this.requests.push(request);
    return {
      ok: false,
      backend: 'claude',
      sessionId: null,
      model: request.model,
      error: 'planning stage probe',
      classified: {
        tier: 'fatal',
        reason: 'planning stage probe'
      },
      artifacts: {
        stdout: '',
        stderr: 'planning stage probe',
        exitCode: 1,
        command: this.buildCommand(request)
      }
    };
  }
}

class DeterministicScoringAdapter implements AgentAdapter {
  readonly backend = 'codex' as const;

  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec {
    return {
      command: 'codex',
      args: [request.stage],
      cwd: request.cwd
    };
  }

  async runTurn(request: AdapterTurnRequest): Promise<AdapterTurnResult> {
    if (request.stage === 'execution') {
      await mkdir(path.join(request.cwd, 'src'), { recursive: true });
      await writeFile(path.join(request.cwd, 'src', 'target.ts'), 'export const target = 1;\n', 'utf8');
    }

    const finalMessage =
      request.stage === 'planning-s1'
        ? 'Use src/target.ts for the implementation plan.'
        : request.stage === 'planning-s2'
          ? `# Feature Plan: ${request.featureId}

${TEST_LEDGER_SECTION}

## Manifest

\`\`\`json manifest
{
  "create": ["src/target.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`
          : 'Execution complete.';
    const sessionId = request.stage === 'planning-s1' ? 'deterministic-plan' : `deterministic-${request.stage}`;

    return {
      ok: true,
      backend: 'codex',
      sessionId,
      finalMessage,
      model: request.model,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalCostUsd: 0,
        raw: null
      },
      costRecord: {
        featureId: request.featureId,
        stage: request.stage,
        model: request.model,
        inputTokens: 10,
        outputTokens: 5,
        estimatedCostUsd: 0,
        timestamp: new Date().toISOString()
      },
      artifacts: {
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: this.buildCommand(request)
      }
    };
  }
}

class DeterministicManifestAdapter implements AgentAdapter {
  readonly backend = 'codex' as const;

  readonly requests: AdapterTurnRequest[] = [];

  constructor(private readonly manifestsByFeatureId: Record<string, string[]>) {}

  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec {
    return {
      command: 'codex',
      args: [request.stage],
      cwd: request.cwd
    };
  }

  async runTurn(request: AdapterTurnRequest): Promise<AdapterTurnResult> {
    this.requests.push(request);
    const manifestPaths = this.manifestsByFeatureId[request.featureId] ?? ['src/target.ts'];
    const currentPlanMatch =
      request.stage === 'adjustment'
        ? request.prompt.match(/=== CURRENT PLAN START ===\n([\s\S]*?)\n=== CURRENT PLAN END ===/)
        : null;

    if (request.stage === 'execution') {
      for (const relativePath of manifestPaths) {
        const absolutePath = path.join(request.cwd, relativePath);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(
          absolutePath,
          `export const ${path.basename(relativePath, '.ts').replace(/[^a-zA-Z0-9_]/g, '_')} = '${request.featureId}';\n`,
          'utf8'
        );
      }
    }

    const finalMessage =
      request.stage === 'planning-s1'
        ? `Use ${manifestPaths.join(', ')} for the implementation plan.`
        : request.stage === 'planning-s2'
          ? `# Feature Plan: ${request.featureId}

${TEST_LEDGER_SECTION}

## Manifest

\`\`\`json manifest
${JSON.stringify(
  {
    create: manifestPaths,
    modify: [],
    delete: []
  },
  null,
  2
)}
\`\`\`
`
          : request.stage === 'adjustment'
            ? currentPlanMatch?.[1]?.trim() ??
              `# Feature Plan

${TEST_LEDGER_SECTION}

## Manifest

\`\`\`json manifest
{"create":[],"modify":[],"delete":[]}
\`\`\`
`
          : 'Execution complete.';
    const sessionId = `deterministic-${request.featureId}-${request.stage}`;

    return {
      ok: true,
      backend: 'codex',
      sessionId,
      finalMessage,
      model: request.model,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalCostUsd: 0,
        raw: null
      },
      costRecord: {
        featureId: request.featureId,
        stage: request.stage,
        model: request.model,
        inputTokens: 10,
        outputTokens: 5,
        estimatedCostUsd: 0,
        timestamp: new Date().toISOString()
      },
      artifacts: {
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: this.buildCommand(request)
      }
    };
  }
}

class PartialPlanningFailureAdapter implements AgentAdapter {
  readonly backend = 'codex' as const;

  readonly requests: AdapterTurnRequest[] = [];

  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec {
    return {
      command: 'codex',
      args: [request.stage],
      cwd: request.cwd
    };
  }

  async runTurn(request: AdapterTurnRequest): Promise<AdapterTurnResult> {
    this.requests.push(request);

    if (request.featureId === '002' && request.stage === 'planning-s1') {
      return {
        ok: false,
        backend: 'codex',
        sessionId: null,
        model: request.model,
        error: 'simulated second planning failure',
        classified: {
          tier: 'fatal',
          reason: 'simulated second planning failure'
        },
        artifacts: {
          stdout: '',
          stderr: 'simulated second planning failure',
          exitCode: 1,
          command: this.buildCommand(request)
        }
      };
    }

    const finalMessage =
      request.stage === 'planning-s1'
        ? 'Use src/target.ts for the implementation plan.'
        : request.stage === 'planning-s2'
          ? `# Feature Plan: ${request.featureId}

${TEST_LEDGER_SECTION}

## Manifest

\`\`\`json manifest
{
  "create": ["src/target.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`
          : 'Execution complete.';

    return {
      ok: true,
      backend: 'codex',
      sessionId: `partial-${request.featureId}-${request.stage}`,
      finalMessage,
      model: request.model,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalCostUsd: 0,
        raw: null
      },
      costRecord: {
        featureId: request.featureId,
        stage: request.stage,
        model: request.model,
        inputTokens: 10,
        outputTokens: 5,
        estimatedCostUsd: 0,
        timestamp: new Date().toISOString()
      },
      artifacts: {
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: this.buildCommand(request)
      }
    };
  }
}

class StopDuringExecutionFailureAdapter implements AgentAdapter {
  readonly backend = 'codex' as const;

  executionAttempts = 0;

  constructor(private readonly stopController: StopController) {}

  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec {
    return {
      command: 'codex',
      args: [request.stage],
      cwd: request.cwd
    };
  }

  async runTurn(request: AdapterTurnRequest): Promise<AdapterTurnResult> {
    if (request.stage === 'planning-s1') {
      return {
        ok: true,
        backend: 'codex',
        sessionId: `stop-test-${request.stage}`,
        finalMessage: 'Use src/target.ts for the implementation plan.',
        model: request.model,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalCostUsd: 0,
          raw: null
        },
        costRecord: {
          featureId: request.featureId,
          stage: request.stage,
          model: request.model,
          inputTokens: 10,
          outputTokens: 5,
          estimatedCostUsd: 0,
          timestamp: new Date().toISOString()
        },
        artifacts: {
          stdout: '',
          stderr: '',
          exitCode: 0,
          command: this.buildCommand(request)
        }
      };
    }

    if (request.stage === 'planning-s2') {
      return {
        ok: true,
        backend: 'codex',
        sessionId: `stop-test-${request.stage}`,
        finalMessage: `# Feature Plan: ${request.featureId}

## Ledger

### Constraints
- Keep the change set small.

### Assumptions
- The manifest is conservative.

### Watchpoints
- Preserve orchestrator compatibility.

### Validation
- Run targeted checks.

## Manifest

\`\`\`json manifest
{
  "create": ["src/target.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`,
        model: request.model,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalCostUsd: 0,
          raw: null
        },
        costRecord: {
          featureId: request.featureId,
          stage: request.stage,
          model: request.model,
          inputTokens: 10,
          outputTokens: 5,
          estimatedCostUsd: 0,
          timestamp: new Date().toISOString()
        },
        artifacts: {
          stdout: '',
          stderr: '',
          exitCode: 0,
          command: this.buildCommand(request)
        }
      };
    }

    if (request.stage === 'execution') {
      this.executionAttempts += 1;
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          this.stopController.request('keyboard');
          resolve();
        }, 10);
      });

      return {
        ok: false,
        backend: 'codex',
        sessionId: `stop-test-${request.stage}-${this.executionAttempts}`,
        model: request.model,
        error: 'provider returned malformed patch output',
        classified: {
          tier: 'agent',
          reason: 'provider returned malformed patch output'
        },
        artifacts: {
          stdout: '',
          stderr: 'provider returned malformed patch output',
          exitCode: 1,
          command: this.buildCommand(request)
        }
      };
    }

    return {
      ok: true,
      backend: 'codex',
      sessionId: `stop-test-${request.stage}`,
      finalMessage: 'Adjustment complete.',
      model: request.model,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalCostUsd: 0,
        raw: null
      },
      costRecord: {
        featureId: request.featureId,
        stage: request.stage,
        model: request.model,
        inputTokens: 10,
        outputTokens: 5,
        estimatedCostUsd: 0,
        timestamp: new Date().toISOString()
      },
      artifacts: {
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: this.buildCommand(request)
      }
    };
  }
}

class MissingLedgerPlanningAdapter implements AgentAdapter {
  readonly backend = 'codex' as const;

  buildCommand(request: AdapterTurnRequest): AdapterCommandSpec {
    return {
      command: 'codex',
      args: [request.stage],
      cwd: request.cwd
    };
  }

  async runTurn(request: AdapterTurnRequest): Promise<AdapterTurnResult> {
    const finalMessage =
      request.stage === 'planning-s1'
        ? 'Use src/target.ts for the implementation plan.'
        : request.stage === 'planning-s2'
          ? `# Feature Plan: ${request.featureId}

## Manifest

\`\`\`json manifest
{
  "create": ["src/target.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`
          : 'Execution complete.';

    return {
      ok: true,
      backend: 'codex',
      sessionId: `missing-ledger-${request.featureId}-${request.stage}`,
      finalMessage,
      model: request.model,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalCostUsd: 0,
        raw: null
      },
      costRecord: {
        featureId: request.featureId,
        stage: request.stage,
        model: request.model,
        inputTokens: 10,
        outputTokens: 5,
        estimatedCostUsd: 0,
        timestamp: new Date().toISOString()
      },
      artifacts: {
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: this.buildCommand(request)
      }
    };
  }
}

const createTempRepo = async (): Promise<string> => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-realrun-'));
  const git = simpleGit(repoRoot);

  await git.init(['-b', 'main']);
  await git.addConfig('user.name', 'OpenWeft Test');
  await git.addConfig('user.email', 'openweft@example.com');
  await writeFile(path.join(repoRoot, 'README.md'), '# Test Repo\n', 'utf8');
  await git.add(['README.md']);
  await git.commit('initial commit');

  return repoRoot;
};

const writeProjectFiles = async (
  repoRoot: string,
  options: {
    configOverrides?: Record<string, unknown>;
    maxParallelAgents?: number;
    queueRequests: string[];
  }
): Promise<void> => {
  await mkdir(path.join(repoRoot, 'prompts'), { recursive: true });
  await mkdir(path.join(repoRoot, 'feature_requests'), { recursive: true });

  await writeFile(
    path.join(repoRoot, '.openweftrc.json'),
    `${JSON.stringify(
      {
        backend: 'codex',
        concurrency: {
          maxParallelAgents: options.maxParallelAgents ?? 1,
          staggerDelayMs: 0
        },
        ...options.configOverrides
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  await writeFile(path.join(repoRoot, 'prompts', 'prompt-a.md'), 'Plan {{USER_REQUEST}}.', 'utf8');
  await writeFile(
    path.join(repoRoot, 'prompts', 'plan-adjustment.md'),
    'Review {{CODE_EDIT_SUMMARY}} and update the plan if needed.',
    'utf8'
  );
  await writeFile(
    path.join(repoRoot, 'feature_requests', 'queue.txt'),
    `${options.queueRequests.join('\n')}\n`,
    'utf8'
  );
};

const createAutoApproveController = (events: string[]): ApprovalController => {
  let controller: ApprovalController;

  controller = new ApprovalController((event) => {
    events.push(event.type);

    if (event.type === 'agent:approval') {
      queueMicrotask(() => {
        controller.resolveCurrent('approve');
      });
    }
  });

  return controller;
};

const createDelayedApproveController = (
  events: string[],
  delayMs: number
): ApprovalController => {
  let controller: ApprovalController;

  controller = new ApprovalController((event) => {
    events.push(event.type);

    if (event.type === 'agent:approval') {
      setTimeout(() => {
        controller.resolveCurrent('approve');
      }, delayMs);
    }
  });

  return controller;
};


const seedInterruptedExecutionFeature = async (input: {
  repoRoot: string;
  config: Awaited<ReturnType<typeof loadOpenWeftConfig>>['config'];
  featureId?: string;
  request?: string;
  status?: 'planned' | 'executing';
  commitMessage?: string;
  leaveDirty?: boolean;
  includeOffManifestFile?: boolean;
}): Promise<void> => {
  const featureId = input.featureId ?? '001';
  const request = input.request ?? 'add dashboard filters';
  const status = input.status ?? 'executing';
  const branchName = `openweft-${featureId}-resume-test`;
  const worktreePath = path.join(input.config.paths.worktreesDir, featureId);
  const planFile = path.join(input.config.paths.featureRequestsDir, `${featureId}.plan.md`);
  const promptBFile = path.join(input.config.paths.promptBArtifactsDir, `${featureId}.prompt-b.md`);
  const now = new Date().toISOString();

  await mkdir(input.config.paths.worktreesDir, { recursive: true });
  await mkdir(input.config.paths.featureRequestsDir, { recursive: true });
  await mkdir(input.config.paths.promptBArtifactsDir, { recursive: true });

  await writeFile(
    planFile,
    `# Feature Plan: ${featureId}

## Manifest

\`\`\`json manifest
{
  "create": ["src/target.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`,
    'utf8'
  );
  await writeFile(promptBFile, `Prompt B for ${request}.\n`, 'utf8');

  await createWorktree({
    repoRoot: input.repoRoot,
    worktreePath,
    branchName
  });

  const worktreeGit = simpleGit(worktreePath);
  await mkdir(path.join(worktreePath, 'src'), { recursive: true });
  await writeFile(path.join(worktreePath, 'src', 'target.ts'), `export const target = '${featureId}';\n`, 'utf8');
  if (input.includeOffManifestFile) {
    await writeFile(path.join(worktreePath, 'src', 'extra.ts'), `export const extra = '${featureId}';\n`, 'utf8');
  }
  await worktreeGit.add(input.includeOffManifestFile ? ['src/target.ts', 'src/extra.ts'] : ['src/target.ts']);
  await worktreeGit.commit(input.commitMessage ?? `openweft: complete feature ${featureId}`);

  if (input.leaveDirty) {
    await writeFile(path.join(worktreePath, 'src', 'target.ts'), `export const target = '${featureId}-dirty';\n`, 'utf8');
  }

  const checkpoint = createEmptyCheckpoint({
    orchestratorVersion: 'test',
    configHash: 'test-config-hash',
    runId: 'test-run',
    checkpointId: 'test-checkpoint',
    createdAt: now
  });
  checkpoint.configHash = 'test-config-hash';
  checkpoint.status = 'in-progress';
  checkpoint.currentState = 'executing';
  checkpoint.currentPhase = {
    index: 1,
    name: 'Phase 1',
    featureIds: [featureId],
    startedAt: now
  };
  checkpoint.features[featureId] = {
    id: featureId,
    request,
    status,
    attempts: 0,
    planFile,
    evolvedPlanFile: null,
    promptBFile,
    branchName,
    worktreePath,
    sessionId: 'resume-session',
    sessionScope: 'worktree',
    manifest: {
      create: ['src/target.ts'],
      modify: [],
      delete: []
    },
    rerunEligible: false,
    mergeResolutionAttempts: 0,
    updatedAt: now
  };
  checkpoint.queue = {
    orderedFeatureIds: [featureId],
    totalCount: 1
  };

  await saveCheckpoint({
    checkpoint,
    checkpointFile: input.config.paths.checkpointFile,
    checkpointBackupFile: input.config.paths.checkpointBackupFile
  });
};

const seedPlannedPromptBRecoveryFeature = async (input: {
  config: Awaited<ReturnType<typeof loadOpenWeftConfig>>['config'];
  configHash: string;
  featureId?: string;
  request?: string;
  promptBFile?: string | null;
  writeCanonicalPromptB?: boolean;
}): Promise<{ planFile: string; canonicalPromptBFile: string }> => {
  const featureId = input.featureId ?? '001';
  const request = input.request ?? 'add dashboard filters';
  const now = new Date().toISOString();
  const planFile = path.join(input.config.paths.featureRequestsDir, `${featureId}.plan.md`);
  const canonicalPromptBFile = path.join(
    input.config.paths.promptBArtifactsDir,
    createPromptBFilename(Number.parseInt(featureId, 10), request)
  );

  await mkdir(input.config.paths.featureRequestsDir, { recursive: true });
  await mkdir(input.config.paths.promptBArtifactsDir, { recursive: true });
  await writeFile(
    planFile,
    `# Feature Plan: ${featureId}

## Ledger

### Constraints
- Keep the change set small.

### Assumptions
- Prompt B recovery should be deterministic.

### Watchpoints
- Preserve orchestrator state.

### Validation
- Run targeted checks.

## Manifest

\`\`\`json manifest
{
  "create": ["src/target.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`,
    'utf8'
  );

  if (input.writeCanonicalPromptB ?? true) {
    await writeFile(canonicalPromptBFile, `Prompt B for ${request}.\n`, 'utf8');
  }

  const checkpoint = createEmptyCheckpoint({
    orchestratorVersion: 'test',
    configHash: input.configHash,
    runId: 'test-run',
    checkpointId: 'test-checkpoint',
    createdAt: now
  });
  checkpoint.configHash = input.configHash;
  checkpoint.status = 'in-progress';
  checkpoint.currentState = 'planning';
  checkpoint.features[featureId] = {
    id: featureId,
    request,
    status: 'planned',
    attempts: 0,
    planFile,
    evolvedPlanFile: null,
    promptBFile: input.promptBFile ?? null,
    branchName: null,
    worktreePath: null,
    sessionId: null,
    sessionScope: null,
    manifest: {
      create: ['src/target.ts'],
      modify: [],
      delete: []
    },
    rerunEligible: true,
    mergeResolutionAttempts: 0,
    updatedAt: now
  };
  checkpoint.queue = {
    orderedFeatureIds: [featureId],
    totalCount: 1
  };

  await saveCheckpoint({
    checkpoint,
    checkpointFile: input.config.paths.checkpointFile,
    checkpointBackupFile: input.config.paths.checkpointBackupFile
  });

  return {
    planFile,
    canonicalPromptBFile
  };
};

const createNotificationRecorder = () => {
  const lines: string[] = [];
  const dependencies: NotificationDependencies = {
    isInteractiveTerminal: () => false,
    notifyNative: async () => {},
    writeOsc9: () => {},
    writeBell: () => {},
    writeStderr: (message) => {
      lines.push(message);
    }
  };

  return {
    lines,
    dependencies
  };
};

const readAuditEntries = async (
  auditLogFile: string
): Promise<Array<{ event: string; data?: Record<string, unknown> }>> => {
  return (await readFile(auditLogFile, 'utf8'))
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { event: string; data?: Record<string, unknown> });
};

describe('runRealOrchestration', () => {
  it('injects the current plan context into adjustment prompts and emits phase progress', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters', 'add export controls']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(
      new DeterministicManifestAdapter({
        '001': ['src/shared.ts'],
        '002': ['src/shared.ts']
      })
    );
    const { lines, dependencies } = createNotificationRecorder();
    const progressLines: string[] = [];
    const events: string[] = [];

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: dependencies,
      writeLine: (message) => {
        progressLines.push(message);
      },
      onEvent: (event) => {
        events.push(event.type);
      },
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.mergedCount).toBe(2);

    const adjustmentRequest = adapter.requests.find((request) => request.stage === 'adjustment');
    const executionRequest = adapter.requests.find(
      (request) => request.stage === 'execution' && request.featureId === '002'
    );
    expect(adjustmentRequest).toBeDefined();
    expect(executionRequest).toBeDefined();

    const featureTwo = result.checkpoint.features['002'];
    expect(featureTwo?.planFile).toBeDefined();
    expect(featureTwo?.promptBFile).toBeDefined();
    const planContent = await readFile(featureTwo?.planFile ?? '', 'utf8');
    const promptBContent = await readFile(featureTwo?.promptBFile ?? '', 'utf8');
    const costRecords = (await readFile(path.join(repoRoot, '.openweft', 'costs.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
      });
    const auditEntries = (await readFile(path.join(repoRoot, '.openweft', 'audit-trail.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) =>
        JSON.parse(line) as {
          event: string;
          data?: {
            featureId?: string;
            stage?: string;
            resumedSession?: boolean;
            returnedSessionId?: boolean;
            command?: {
              command?: string;
              args?: string[];
            };
          };
        }
      );
    const totalInputTokens = costRecords.reduce((sum, record) => sum + record.inputTokens, 0);
    const totalOutputTokens = costRecords.reduce((sum, record) => sum + record.outputTokens, 0);
    const totalEstimatedUsd = costRecords.reduce((sum, record) => sum + record.estimatedCostUsd, 0);
    const adjustmentAudit = auditEntries.find(
      (entry) =>
        entry.event === 'agent.turn.completed' &&
        entry.data?.featureId === '002' &&
        entry.data.stage === 'adjustment'
    );
    const freshExecutionAudit = auditEntries.find(
      (entry) =>
        entry.event === 'agent.turn.start' &&
        entry.data?.featureId === '002' &&
        entry.data.stage === 'execution' &&
        entry.data.resumedSession === false
    );

    expect(adjustmentRequest?.prompt).toContain(featureTwo?.planFile ?? '');
    expect(executionRequest?.prompt).toContain('=== PROMPT B START ===');
    expect(executionRequest?.prompt).toContain(promptBContent.trim());
    expect(executionRequest?.prompt).toContain(path.basename(featureTwo?.promptBFile ?? ''));
    expect(executionRequest?.prompt).toContain('.openweft/prompt-b-briefs');
    expect(adjustmentRequest?.prompt).toContain('=== CURRENT PLAN START ===');
    expect(adjustmentRequest?.prompt).toContain(planContent.trim());
    expect(adjustmentRequest?.prompt).toContain('"merge_commit"');
    expect(result.checkpoint.cost.totalInputTokens).toBe(totalInputTokens);
    expect(result.checkpoint.cost.totalOutputTokens).toBe(totalOutputTokens);
    expect(result.checkpoint.cost.totalEstimatedUsd).toBe(Number.parseFloat(totalEstimatedUsd.toFixed(6)));
    expect(adjustmentAudit?.data?.returnedSessionId).toBe(true);
    expect(adjustmentAudit?.data?.command?.command).toBe('codex');
    expect(freshExecutionAudit?.data?.command?.args).toEqual(['execution']);

    expect(progressLines).toContain('OpenWeft run starting with backend codex.');
    expect(progressLines.some((line) => line.includes('Phase 1 starting'))).toBe(true);
    expect(progressLines.some((line) => line.includes('Feature 001 add dashboard filters complete.'))).toBe(true);
    expect(progressLines.some((line) => line.includes('Phase 1 complete. Re-planning remaining work.'))).toBe(true);
    expect(lines.some((line) => line.includes('OpenWeft: Phase 2 starting'))).toBe(true);
    expect(lines.some((line) => line.includes('OpenWeft: Queue empty. OpenWeft has finished all queued work.'))).toBe(true);
    expect(events).toContain('phase:started');
    expect(events).toContain('phase:completed');
    expect(events).toContain('agent:started');
    expect(events).toContain('agent:text');
    expect(events).toContain('agent:completed');
    expect(events).toContain('session:cost-update');
  });

  it('copies back an evolved worktree plan ledger after successful execution', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new DeterministicScoringAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);
    const ledgerNote = 'Execution verified the copied ledger path.';

    adapter.runTurn = async (request) => {
      if (request.stage === 'execution') {
        await appendLedgerNoteToPlan(extractExecutionPlanPath(request.prompt), ledgerNote);
      }

      return originalRunTurn(request);
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    const planFile = result.checkpoint.features['001']?.planFile;
    expect(planFile).toBeDefined();
    expect(result.checkpoint.features['001']?.evolvedPlanFile).toBeNull();
    await expect(readFile(buildEvolvedPlanPath(config, '001'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });
    expect(await readFile(planFile ?? '', 'utf8')).toContain(ledgerNote);
    expect(await readFile(path.join(config.paths.shadowPlansDir, '001.md'), 'utf8')).toContain(ledgerNote);
  });

  it('keeps evolved ledger changes staged without rerunning execution when merge never succeeds', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new DeterministicScoringAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);
    const ledgerNote = 'Execution found a note that should stay staged until merge succeeds.';
    const stopController = new StopController();
    let executionAttempts = 0;

    adapter.runTurn = async (request) => {
      if (request.stage === 'execution') {
        executionAttempts += 1;
        if (executionAttempts === 2) {
          stopController.request('unexpected execution rerun');
        }
        await appendLedgerNoteToPlan(extractExecutionPlanPath(request.prompt), ledgerNote);
      }

      return originalRunTurn(request);
    };

    vi.resetModules();
    vi.doMock('../../src/git/index.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/git/index.js')>(
        '../../src/git/index.js'
      );

      return {
        ...actual,
        mergeBranchIntoCurrent: vi.fn(async (_repoRoot: string, branch: string) => ({
          status: 'conflict' as const,
          branch,
          preMergeCommit: 'pre-merge-commit',
          conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
        })),
        mergeBranchIntoWorktree: vi.fn(async (_worktreePath: string, branch: string) => ({
          status: 'conflict' as const,
          branch,
          preMergeCommit: 'pre-merge-commit',
          conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
        }))
      };
    });

    try {
      const { runRealOrchestration: runWithFailedMergeProbe } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runWithFailedMergeProbe({
        config,
        configHash,
        adapter,
        stopController,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('failed');
      expect(executionAttempts).toBe(1);
      expect(result.checkpoint.features['001']?.status).toBe('failed');
      expect(result.checkpoint.features['001']?.rerunEligible).toBe(false);
      expect(result.checkpoint.features['001']?.evolvedPlanFile).toBe(buildEvolvedPlanPath(config, '001'));
      const planFile = result.checkpoint.features['001']?.planFile;
      expect(planFile).toBeDefined();
      expect(await readFile(planFile ?? '', 'utf8')).not.toContain(ledgerNote);
      expect(await readFile(path.join(config.paths.shadowPlansDir, '001.md'), 'utf8')).not.toContain(
        ledgerNote
      );
      expect(await readFile(buildEvolvedPlanPath(config, '001'), 'utf8')).toContain(ledgerNote);
    } finally {
      vi.doUnmock('../../src/git/index.js');
      vi.resetModules();
    }
  });

  it('uses Claude plan permission mode for repo-scoped planning requests', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const configPath = path.join(repoRoot, '.openweftrc.json');
    const configJson = JSON.parse(await readFile(configPath, 'utf8')) as {
      backend: string;
    };
    configJson.backend = 'claude';
    await writeFile(configPath, `${JSON.stringify(configJson, null, 2)}\n`, 'utf8');

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingClaudeFailureAdapter();
    const residueFile = path.join(config.paths.codexHomeDir, 'state.sqlite');
    await mkdir(config.paths.codexHomeDir, { recursive: true });
    await writeFile(residueFile, 'test\n', 'utf8');

    await expect(
      runRealOrchestration({
        config,
        configHash,
        adapter,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      })
    ).rejects.toThrow('planning stage probe');

    expect(adapter.requests[0]?.stage).toBe('planning-s1');
    expect(adapter.requests[0]?.claudePermissionMode).toBe('plan');
    await expect(access(residueFile)).resolves.toBeUndefined();

    const auditEntries = await readAuditEntries(config.paths.auditLogFile);
    const terminalAudit = auditEntries.find((entry) => entry.event === 'run.failed');

    expect(terminalAudit?.data).toEqual(expect.objectContaining({
      status: 'failed',
      runtimeCleanup: expect.objectContaining({
        action: 'preserved'
      })
    }));
  });

  it('uses read-only repo-scoped turns for Codex planning and adjustment stages', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 2,
      queueRequests: ['add feature alpha', 'add feature beta', 'add feature gamma']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(
      new DeterministicManifestAdapter({
        '001': ['src/a.ts'],
        '002': ['src/b.ts'],
        '003': ['src/a.ts', 'src/b.ts']
      })
    );

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');

    const repoScopedTurns = adapter.requests.filter(
      (request) =>
        request.stage === 'planning-s1' ||
        request.stage === 'planning-s2' ||
        request.stage === 'adjustment'
    );
    expect(repoScopedTurns.length).toBeGreaterThan(0);
    expect(repoScopedTurns.every((request) => request.cwd === repoRoot)).toBe(true);
    expect(
      repoScopedTurns.map((request) => ({
        stage: request.stage,
        sandboxMode: request.sandboxMode ?? null
      }))
    ).not.toContainEqual({
      stage: 'planning-s1',
      sandboxMode: 'danger-full-access'
    });
    expect(
      repoScopedTurns.map((request) => ({
        stage: request.stage,
        sandboxMode: request.sandboxMode ?? null
      }))
    ).not.toContainEqual({
      stage: 'planning-s2',
      sandboxMode: 'danger-full-access'
    });
    expect(
      repoScopedTurns.map((request) => ({
        stage: request.stage,
        sandboxMode: request.sandboxMode ?? null
      }))
    ).not.toContainEqual({
      stage: 'adjustment',
      sandboxMode: 'danger-full-access'
    });
    expect(repoScopedTurns.every((request) => request.sandboxMode === 'read-only')).toBe(true);
  });

  it('saves planned features to the checkpoint before scoring starts', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    vi.resetModules();
    vi.doMock('../../src/domain/scoring.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/domain/scoring.js')>(
        '../../src/domain/scoring.js'
      );

      return {
        ...actual,
        scoreQueue: vi.fn(() => {
          throw new Error('scoring stage probe');
        })
      };
    });

    try {
      const { runRealOrchestration: runRealOrchestrationWithScoringProbe } = await import(
        '../../src/orchestrator/realRun.js'
      );

      await expect(
        runRealOrchestrationWithScoringProbe({
          config,
          configHash,
          adapter,
          notificationDependencies: createNotificationRecorder().dependencies,
          sleep: async () => {}
        })
      ).rejects.toThrow('scoring stage probe');
    } finally {
      vi.doUnmock('../../src/domain/scoring.js');
      vi.resetModules();
    }

    expect(adapter.requests.map((request) => request.stage)).toEqual(['planning-s1', 'planning-s2']);

    const saved = await loadCheckpoint({
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });
    const savedFeature = saved.checkpoint?.features['001'];

    expect(saved.source).toBe('primary');
    expect(saved.checkpoint?.status).toBe('failed');
    expect(saved.checkpoint?.currentState).toBe('idle');
    expect(savedFeature).toMatchObject({
      id: '001',
      request: 'add dashboard filters',
      status: 'planned',
      attempts: 0,
      backend: 'mock'
    });
    expect(savedFeature?.promptBFile).toBeTruthy();
    await expect(readFile(savedFeature?.promptBFile ?? '', 'utf8')).resolves.toContain('Runtime-generated Prompt B');
    expect(savedFeature?.planFile).toBeTruthy();
    await expect(readFile(savedFeature?.planFile ?? '', 'utf8')).resolves.toContain('## Manifest');
    await expect(readFile(savedFeature?.planFile ?? '', 'utf8')).resolves.toContain('## Ledger');
  });

  it('persists planned features before the post-planning checkpoint save returns', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    vi.resetModules();
    vi.doMock('../../src/domain/scoring.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/domain/scoring.js')>(
        '../../src/domain/scoring.js'
      );

      return {
        ...actual,
        scoreQueue: vi.fn(() => {
          throw new Error('scoring stage probe');
        })
      };
    });
    vi.doMock('../../src/state/checkpoint.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/state/checkpoint.js')>(
        '../../src/state/checkpoint.js'
      );

      let saveCount = 0;

      return {
        ...actual,
        saveCheckpoint: vi.fn(async (...args: Parameters<typeof actual.saveCheckpoint>) => {
          saveCount += 1;
          await actual.saveCheckpoint(...args);
          if (saveCount === 2) {
            throw new Error('post-planning save probe');
          }
        })
      };
    });

    try {
      const { runRealOrchestration: runRealOrchestrationWithSaveProbe } = await import(
        '../../src/orchestrator/realRun.js'
      );

      await expect(
        runRealOrchestrationWithSaveProbe({
          config,
          configHash,
          adapter,
          notificationDependencies: createNotificationRecorder().dependencies,
          sleep: async () => {}
        })
      ).rejects.toThrow('post-planning save probe');
    } finally {
      vi.doUnmock('../../src/domain/scoring.js');
      vi.doUnmock('../../src/state/checkpoint.js');
      vi.resetModules();
    }

    const saved = await loadCheckpoint({
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });

    expect(saved.checkpoint?.features['001']).toMatchObject({
      id: '001',
      request: 'add dashboard filters',
      status: 'planned'
    });
  });

  it('persists planning state before the first stage-one turn starts', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);
    let checkpointDuringStageOne: LoadCheckpointResult | null = null;

    adapter.runTurn = async (request) => {
      if (request.stage === 'planning-s1' && checkpointDuringStageOne === null) {
        checkpointDuringStageOne = await loadCheckpoint({
          checkpointFile: config.paths.checkpointFile,
          checkpointBackupFile: config.paths.checkpointBackupFile
        });
      }

      return originalRunTurn(request);
    };

    await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    const capturedCheckpointDuringStageOne = checkpointDuringStageOne as LoadCheckpointResult | null;

    expect(capturedCheckpointDuringStageOne).not.toBeNull();
    if (!capturedCheckpointDuringStageOne) {
      throw new Error('Expected to capture a checkpoint snapshot during planning stage one.');
    }

    expect(capturedCheckpointDuringStageOne.source).toBe('primary');
    expect(capturedCheckpointDuringStageOne.checkpoint).toMatchObject({
      status: 'in-progress',
      currentState: 'planning',
      currentPhase: null,
      pendingRequests: [expect.objectContaining({ request: 'add dashboard filters' })]
    });
    expect(capturedCheckpointDuringStageOne.checkpoint?.features).toEqual({});
  });

  it('sanitizes fenced markdown from contaminated stage-one Prompt B output before persisting it', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);

    adapter.runTurn = async (request) => {
      if (request.stage === 'planning-s1') {
        return {
          ok: true,
          backend: 'codex',
          sessionId: 'contaminated-prompt-b',
          finalMessage: `Could not save due read-only sandbox (\`operation not permitted\` on write to \`prompts/...\`).\n\n\`\`\`md\n# Role\nSanitized prompt body.\n\`\`\`\n`,
          model: request.model,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            totalCostUsd: 0,
            raw: null
          },
          costRecord: {
            featureId: request.featureId,
            stage: request.stage,
            model: request.model,
            inputTokens: 10,
            outputTokens: 5,
            estimatedCostUsd: 0,
            timestamp: new Date().toISOString()
          },
          artifacts: {
            stdout: '',
            stderr: '',
            exitCode: 0,
            command: adapter.buildCommand(request)
          }
        };
      }

      return originalRunTurn(request);
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    const promptBFile = result.checkpoint.features['001']?.promptBFile;
    expect(promptBFile).toBeTruthy();
    await expect(readFile(promptBFile ?? '', 'utf8')).resolves.toBe('# Role\nSanitized prompt body.\n');
  });

  it('sanitizes read-only save preambles that wrap a fenced Prompt B brief', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['improve the not found flow']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);

    adapter.runTurn = async (request) => {
      if (request.stage === 'planning-s1') {
        return {
          ok: true,
          backend: 'codex',
          sessionId: 'contaminated-read-only-prompt-b',
          finalMessage: `I could not save the file because this workspace is read-only (\`operation not permitted\` when writing to \`prompts/example.md\`).\n\nIntended path: [prompts/example.md](/tmp/prompts/example.md)\n\n\`\`\`md\n# Role\nRecovered prompt body.\n\`\`\`\n`,
          model: request.model,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            totalCostUsd: 0,
            raw: null
          },
          costRecord: {
            featureId: request.featureId,
            stage: request.stage,
            model: request.model,
            inputTokens: 10,
            outputTokens: 5,
            estimatedCostUsd: 0,
            timestamp: new Date().toISOString()
          },
          artifacts: {
            stdout: '',
            stderr: '',
            exitCode: 0,
            command: adapter.buildCommand(request)
          }
        };
      }

      return originalRunTurn(request);
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    const promptBFile = result.checkpoint.features['001']?.promptBFile;
    expect(promptBFile).toBeTruthy();
    await expect(readFile(promptBFile ?? '', 'utf8')).resolves.toBe('# Role\nRecovered prompt body.\n');
  });

  it('sanitizes read-only write preambles that point to an intended file path', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['document the checkout flow']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);

    adapter.runTurn = async (request) => {
      if (request.stage === 'planning-s1') {
        return {
          ok: true,
          backend: 'codex',
          sessionId: 'contaminated-write-prompt-b',
          finalMessage: `I couldn't write this into the repo because the workspace is read-only in this session.\nIntended file path: [prompts/example.md](/tmp/prompts/example.md)\n\n\`\`\`md\n## Role\nRecovered write prompt body.\n\`\`\`\n`,
          model: request.model,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            totalCostUsd: 0,
            raw: null
          },
          costRecord: {
            featureId: request.featureId,
            stage: request.stage,
            model: request.model,
            inputTokens: 10,
            outputTokens: 5,
            estimatedCostUsd: 0,
            timestamp: new Date().toISOString()
          },
          artifacts: {
            stdout: '',
            stderr: '',
            exitCode: 0,
            command: adapter.buildCommand(request)
          }
        };
      }

      return originalRunTurn(request);
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    const promptBFile = result.checkpoint.features['001']?.promptBFile;
    expect(promptBFile).toBeTruthy();
    await expect(readFile(promptBFile ?? '', 'utf8')).resolves.toBe(
      '## Role\nRecovered write prompt body.\n'
    );
  });

  it('retries complaint-only stage-one output once and continues when the follow-up returns Prompt B content', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['build the simulation engine']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);
    let stageOneAttempts = 0;

    adapter.runTurn = async (request) => {
      if (request.stage === 'planning-s1') {
        stageOneAttempts += 1;
        if (stageOneAttempts === 2) {
          return {
            ok: true,
            backend: 'codex',
            sessionId: 'recovered-prompt-b',
            finalMessage: '## Role\nRecovered Prompt B body.\n',
            model: request.model,
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              cachedInputTokens: 0,
              cacheCreationInputTokens: 0,
              cacheReadInputTokens: 0,
              totalCostUsd: 0,
              raw: null
            },
            costRecord: {
              featureId: request.featureId,
              stage: request.stage,
              model: request.model,
              inputTokens: 10,
              outputTokens: 5,
              estimatedCostUsd: 0,
              timestamp: new Date().toISOString()
            },
            artifacts: {
              stdout: '',
              stderr: '',
              exitCode: 0,
              command: adapter.buildCommand(request)
            }
          };
        }

        return {
          ok: true,
          backend: 'codex',
          sessionId: 'complaint-only-prompt-b',
          finalMessage:
            'I drafted the full prompt and grounded it in the repo contract and live implementation, ' +
            'but I could not save it because this session is running with a read-only filesystem. ' +
            'Two `apply_patch` attempts to create `prompts/example.md` were rejected by the environment.\n\n' +
            'Next options:\n' +
            '1. If you switch this session to allow writes, I can save the `.md` file directly in `./prompts`.\n' +
            '2. If you want to keep this session as-is, I can paste the full markdown body in my next reply.',
          model: request.model,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            totalCostUsd: 0,
            raw: null
          },
          costRecord: {
            featureId: request.featureId,
            stage: request.stage,
            model: request.model,
            inputTokens: 10,
            outputTokens: 5,
            estimatedCostUsd: 0,
            timestamp: new Date().toISOString()
          },
          artifacts: {
            stdout: '',
            stderr: '',
            exitCode: 0,
            command: adapter.buildCommand(request)
          }
        };
      }

      return originalRunTurn(request);
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    const feature = result.checkpoint.features['001'];
    expect(stageOneAttempts).toBe(2);
    expect(feature?.status).toBe('completed');
    const promptBFile = feature?.promptBFile;
    expect(promptBFile).toBeTruthy();
    await expect(readFile(promptBFile ?? '', 'utf8')).resolves.toBe(
      '## Role\nRecovered Prompt B body.\n'
    );
  });

  it('skips a malformed stage-two planning result and keeps the rest of the queue moving', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters', 'add export controls']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);

    adapter.runTurn = async (request) => {
      if (request.featureId === '002' && request.stage === 'planning-s2') {
        return {
          ok: false,
          backend: 'codex',
          sessionId: null,
          model: request.model,
          error: 'Claude output did not include a result string.',
          classified: {
            tier: 'fatal',
            reason: 'Claude output did not include a result string.'
          },
          artifacts: {
            stdout: '',
            stderr: 'Claude output did not include a result string.',
            exitCode: 1,
            command: adapter.buildCommand(request)
          }
        };
      }

      return originalRunTurn(request);
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    const saved = await loadCheckpoint({
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(saved.checkpoint?.features['001']).toMatchObject({
      id: '001',
      request: 'add dashboard filters',
      status: 'completed'
    });
    expect(saved.checkpoint?.features['002']).toMatchObject({
      id: '002',
      request: 'add export controls',
      status: 'skipped',
      planFile: null,
      lastError: 'Claude output did not include a result string.'
    });

    const queueContent = await readFile(config.paths.queueFile, 'utf8');
    expect(queueContent).toContain('# openweft queue format: v1');
    expect(queueContent).toContain('"type":"processed"');
    expect(queueContent).toContain('"featureId":"001"');
    expect(queueContent).toContain('"featureId":"002"');
    expect(queueContent).toContain('"request":"add export controls"');
  });

  it('records invalid planning repair attempts and preserves the latest invalid markdown before skipping', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add export controls']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);
    let planningStageTwoAttempts = 0;

    const invalidPlan = (label: string): string => `# ${label}

## Manifest

\`\`\`json manifest
{
  "create": ["src/${label.toLowerCase().replace(/\s+/g, '-')}.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`;

    adapter.runTurn = async (request) => {
      if (request.stage === 'planning-s2') {
        planningStageTwoAttempts += 1;
        return {
          ok: true,
          backend: 'codex',
          sessionId: `invalid-planning-s2-${planningStageTwoAttempts}`,
          finalMessage: invalidPlan(`Repair Attempt ${planningStageTwoAttempts}`),
          model: request.model,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            totalCostUsd: 0,
            raw: null
          },
          costRecord: {
            featureId: request.featureId,
            stage: request.stage,
            model: request.model,
            inputTokens: 10,
            outputTokens: 5,
            estimatedCostUsd: 0,
            timestamp: new Date().toISOString()
          },
          artifacts: {
            stdout: '',
            stderr: '',
            exitCode: 0,
            command: adapter.buildCommand(request)
          }
        };
      }

      return originalRunTurn(request);
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(planningStageTwoAttempts).toBe(3);
    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'skipped'
    });
    expect(result.checkpoint.features['001']?.lastError).toContain(
      'Failed to extract manifest for feature 001 after 2 repair attempts.'
    );
    expect(result.checkpoint.features['001']?.lastError).toContain(
      'Repair attempt 2: No ledger section found under a "## Ledger" heading.'
    );

    await expect(readFile(path.join(config.paths.shadowPlansDir, '001.md'), 'utf8')).resolves.toContain(
      '# Repair Attempt 3'
    );

    const auditEntries = (await readFile(config.paths.auditLogFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) =>
        JSON.parse(line) as {
          event: string;
          data?: {
            attempt?: number;
            error?: string;
            featureId?: string;
            shadowPlanFile?: string;
          };
        }
      );

    const repairAuditEntries = auditEntries.filter(
      (entry) => entry.event === 'feature.planning.repair.rejected'
    );
    expect(repairAuditEntries).toHaveLength(3);
    expect(repairAuditEntries.map((entry) => entry.data?.attempt)).toEqual([0, 1, 2]);
    expect(repairAuditEntries.every((entry) => entry.data?.featureId === '001')).toBe(true);
    expect(repairAuditEntries.every((entry) => entry.data?.shadowPlanFile?.endsWith('/001.md'))).toBe(
      true
    );
    expect(repairAuditEntries[2]?.data?.error).toContain(
      'No ledger section found under a "## Ledger" heading.'
    );
  });

  it('recovers planned work after a crash that happens after queue rewrite but before the planning checkpoint is saved', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters', 'add export controls']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);

    vi.resetModules();
    vi.doMock('../../src/fs/files.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/fs/files.js')>(
        '../../src/fs/files.js'
      );

      return {
        ...actual,
        writeTextFileAtomic: vi.fn(async (filePath: string, content: string) => {
          await actual.writeTextFileAtomic(filePath, content);
          if (
            filePath === config.paths.queueFile &&
            content.includes('"type":"processed"') &&
            content.includes('"featureId":"001"')
          ) {
            throw new Error('post-queue-write crash probe');
          }
        })
      };
    });

    try {
      const { runRealOrchestration: runWithQueueCrashProbe } = await import(
        '../../src/orchestrator/realRun.js'
      );

      await expect(
        runWithQueueCrashProbe({
          config,
          configHash,
          adapter: new RecordingAdapter(new MockAgentAdapter()),
          notificationDependencies: createNotificationRecorder().dependencies,
          sleep: async () => {}
        })
      ).rejects.toThrow('post-queue-write crash probe');
    } finally {
      vi.doUnmock('../../src/fs/files.js');
      vi.resetModules();
    }

    const restartResult = await runRealOrchestration({
      config,
      configHash,
      adapter: new RecordingAdapter(new MockAgentAdapter()),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(restartResult.mergedCount).toBe(2);
    expect(Object.keys(restartResult.checkpoint.features).sort()).toEqual(['001', '002']);
    expect(restartResult.checkpoint.features['001']?.request).toBe('add dashboard filters');
    expect(restartResult.checkpoint.features['002']?.request).toBe('add export controls');
  });

  it('repairs a missing promptBFile from the canonical artifact before execution resumes', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const { canonicalPromptBFile } = await seedPlannedPromptBRecoveryFeature({
      config,
      configHash,
      promptBFile: null,
      writeCanonicalPromptB: true
    });

    vi.resetModules();
    vi.doMock('../../src/domain/scoring.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/domain/scoring.js')>(
        '../../src/domain/scoring.js'
      );

      return {
        ...actual,
        scoreQueue: vi.fn(() => {
          throw new Error('scoring stage probe');
        })
      };
    });

    try {
      const { runRealOrchestration: runWithScoringProbe } = await import(
        '../../src/orchestrator/realRun.js'
      );

      await expect(
        runWithScoringProbe({
          config,
          configHash,
          adapter: new RecordingAdapter(new MockAgentAdapter()),
          notificationDependencies: createNotificationRecorder().dependencies,
          sleep: async () => {}
        })
      ).rejects.toThrow('scoring stage probe');
    } finally {
      vi.doUnmock('../../src/domain/scoring.js');
      vi.resetModules();
    }

    const saved = await loadCheckpoint({
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });

    expect(saved.checkpoint?.features['001']?.promptBFile).toBe(canonicalPromptBFile);
  });

  it('fails closed when an actionable feature has no usable Prompt B artifact to recover', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    await seedPlannedPromptBRecoveryFeature({
      config,
      configHash,
      promptBFile: null,
      writeCanonicalPromptB: false
    });

    await expect(
      runRealOrchestration({
        config,
        configHash,
        adapter: new RecordingAdapter(new MockAgentAdapter()),
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      })
    ).rejects.toThrow(/Prompt B artifact/i);
  });

  it('persists earlier Prompt B repairs before failing on a later missing artifact', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const { canonicalPromptBFile } = await seedPlannedPromptBRecoveryFeature({
      config,
      configHash,
      featureId: '001',
      request: 'add dashboard filters',
      promptBFile: null,
      writeCanonicalPromptB: true
    });

    const secondPlanFile = path.join(config.paths.featureRequestsDir, '002.plan.md');
    await writeFile(
      secondPlanFile,
      `# Feature Plan: 002

## Ledger

### Constraints
- Keep the change set small.

### Assumptions
- Prompt B recovery should be deterministic.

### Watchpoints
- Preserve orchestrator state.

### Validation
- Run targeted checks.

## Manifest

\`\`\`json manifest
{
  "create": ["src/secondary.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`,
      'utf8'
    );

    const savedBefore = await loadCheckpoint({
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });
    if (!savedBefore.checkpoint) {
      throw new Error('Expected seeded checkpoint to exist.');
    }

    savedBefore.checkpoint.features['002'] = {
      id: '002',
      request: 'add export controls',
      status: 'planned',
      attempts: 0,
      planFile: secondPlanFile,
      evolvedPlanFile: null,
      promptBFile: null,
      branchName: null,
      worktreePath: null,
      sessionId: null,
      sessionScope: null,
      manifest: {
        create: ['src/secondary.ts'],
        modify: [],
        delete: []
      },
      rerunEligible: true,
      mergeResolutionAttempts: 0,
      updatedAt: new Date().toISOString()
    };
    savedBefore.checkpoint.queue = {
      orderedFeatureIds: ['001', '002'],
      totalCount: 2
    };

    await saveCheckpoint({
      checkpoint: savedBefore.checkpoint,
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });

    await expect(
      runRealOrchestration({
        config,
        configHash,
        adapter: new RecordingAdapter(new MockAgentAdapter()),
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      })
    ).rejects.toThrow(/Prompt B artifact/i);

    const savedAfter = await loadCheckpoint({
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });

    expect(savedAfter.checkpoint?.features['001']?.promptBFile).toBe(canonicalPromptBFile);
  });

  it('recovers a reusable interrupted execution even if its Prompt B artifact is missing', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config,
      status: 'planned'
    });

    const savedBefore = await loadCheckpoint({
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });
    if (!savedBefore.checkpoint) {
      throw new Error('Expected seeded checkpoint to exist.');
    }

    await writeFile(config.paths.queueFile, '', 'utf8');
    savedBefore.checkpoint.configHash = configHash;
    savedBefore.checkpoint.features['001']!.promptBFile = null;
    await saveCheckpoint({
      checkpoint: savedBefore.checkpoint,
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new RecordingAdapter(new MockAgentAdapter()),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.checkpoint.features['001']?.status).toBe('completed');
  });

  it('fails planning when the agent never returns the required ledger section', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new MissingLedgerPlanningAdapter(),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'skipped'
    });
    expect(result.checkpoint.features['001']?.lastError).toMatch(/Ledger/i);
  });

  it('fails adjustment when the agent drops the required ledger section', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 2,
      queueRequests: ['first change', 'second change', 'third change']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(
      new DeterministicManifestAdapter({
        '001': ['src/shared.ts'],
        '002': ['src/shared.ts'],
        '003': ['src/other.ts']
      })
    );
    const originalRunTurn = adapter.runTurn.bind(adapter);

    adapter.runTurn = async (request) => {
      if (request.stage === 'adjustment' && request.featureId === '002') {
        return {
          ok: true,
          backend: 'codex',
          sessionId: 'missing-adjustment-ledger',
          finalMessage: `# Feature Plan: ${request.featureId}

## Manifest

\`\`\`json manifest
{
  "create": ["src/shared.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`,
          model: request.model,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            totalCostUsd: 0,
            raw: null
          },
          costRecord: {
            featureId: request.featureId,
            stage: request.stage,
            model: request.model,
            inputTokens: 10,
            outputTokens: 5,
            estimatedCostUsd: 0,
            timestamp: new Date().toISOString()
          },
          artifacts: {
            stdout: '',
            stderr: '',
            exitCode: 0,
            command: adapter.buildCommand(request)
          }
        };
      }

      return originalRunTurn(request);
    };

    await expect(
      runRealOrchestration({
        config,
        configHash,
        adapter,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      })
    ).rejects.toThrow(/Ledger/i);
  });

  it('persists pending merge summaries in checkpoint when re-analysis aborts after a merge', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['first change', 'second change']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(
      new DeterministicManifestAdapter({
        '001': ['src/shared.ts'],
        '002': ['src/shared.ts']
      })
    );
    const originalRunTurn = adapter.runTurn.bind(adapter);

    adapter.runTurn = async (request) => {
      if (request.stage === 'adjustment' && request.featureId === '002') {
        return {
          ok: true,
          backend: 'codex',
          sessionId: 'missing-adjustment-ledger',
          finalMessage: `# Feature Plan: ${request.featureId}

## Manifest

\`\`\`json manifest
{
  "create": ["src/shared.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`,
          model: request.model,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            totalCostUsd: 0,
            raw: null
          },
          costRecord: {
            featureId: request.featureId,
            stage: request.stage,
            model: request.model,
            inputTokens: 10,
            outputTokens: 5,
            estimatedCostUsd: 0,
            timestamp: new Date().toISOString()
          },
          artifacts: {
            stdout: '',
            stderr: '',
            exitCode: 0,
            command: adapter.buildCommand(request)
          }
        };
      }

      return originalRunTurn(request);
    };

    await expect(
      runRealOrchestration({
        config,
        configHash,
        adapter,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      })
    ).rejects.toThrow(/Ledger/i);

    const loaded = await loadCheckpoint(config.paths.checkpointFile, config.paths.checkpointBackupFile);
    expect(loaded.source).toBe('primary');
    expect(loaded.checkpoint?.pendingMergeSummaries).toEqual([
      expect.objectContaining({
        featureId: '001',
        summary: expect.objectContaining({
          files: expect.arrayContaining([expect.objectContaining({ path: 'src/shared.ts' })])
        })
      })
    ]);
  });

  it('replays pending merge summaries before restart execution resumes', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['first change', 'second change']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const crashAdapter = new RecordingAdapter(
      new DeterministicManifestAdapter({
        '001': ['src/shared.ts'],
        '002': ['src/shared.ts']
      })
    );
    const originalCrashRunTurn = crashAdapter.runTurn.bind(crashAdapter);

    crashAdapter.runTurn = async (request) => {
      if (request.stage === 'adjustment' && request.featureId === '002') {
        return {
          ok: true,
          backend: 'codex',
          sessionId: 'missing-adjustment-ledger',
          finalMessage: `# Feature Plan: ${request.featureId}

## Manifest

\`\`\`json manifest
{
  "create": ["src/shared.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`,
          model: request.model,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            totalCostUsd: 0,
            raw: null
          },
          costRecord: {
            featureId: request.featureId,
            stage: request.stage,
            model: request.model,
            inputTokens: 10,
            outputTokens: 5,
            estimatedCostUsd: 0,
            timestamp: new Date().toISOString()
          },
          artifacts: {
            stdout: '',
            stderr: '',
            exitCode: 0,
            command: crashAdapter.buildCommand(request)
          }
        };
      }

      return originalCrashRunTurn(request);
    };

    await expect(
      runRealOrchestration({
        config,
        configHash,
        adapter: crashAdapter,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      })
    ).rejects.toThrow(/Ledger/i);

    const restartAdapter = new RecordingAdapter(
      new DeterministicManifestAdapter({
        '001': ['src/shared.ts'],
        '002': ['src/shared.ts']
      })
    );

    const restartResult = await runRealOrchestration({
      config,
      configHash,
      adapter: restartAdapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    const adjustmentIndex = restartAdapter.requests.findIndex(
      (request) => request.featureId === '002' && request.stage === 'adjustment'
    );
    const executionIndex = restartAdapter.requests.findIndex(
      (request) => request.featureId === '002' && request.stage === 'execution'
    );

    expect(restartResult.checkpoint.status).toBe('completed');
    expect(adjustmentIndex).toBeGreaterThanOrEqual(0);
    expect(executionIndex).toBeGreaterThan(adjustmentIndex);
    expect(restartResult.checkpoint.pendingMergeSummaries).toEqual([]);
  });

  it('resumes repo-scoped adjustment sessions across phases without reusing them for worktree execution', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['first change', 'second change', 'third change']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new RecordingAdapter(
        new DeterministicManifestAdapter({
          '001': ['src/a.ts'],
          '002': ['src/b.ts'],
          '003': ['src/a.ts', 'src/b.ts']
        })
      ),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');

    const auditEntries = (await readFile(path.join(repoRoot, '.openweft', 'audit-trail.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) =>
        JSON.parse(line) as {
          event: string;
          data?: {
            featureId?: string;
            stage?: string;
            resumedSession?: boolean;
            command?: {
              args?: string[];
            };
          };
        }
      );

    const resumedAdjustmentAudit = auditEntries.find(
      (entry) =>
        entry.event === 'agent.turn.start' &&
        entry.data?.featureId === '003' &&
        entry.data.stage === 'adjustment' &&
        entry.data.resumedSession === true
    );
    const executionAudit = auditEntries.find(
      (entry) =>
        entry.event === 'agent.turn.start' &&
        entry.data?.featureId === '003' &&
        entry.data.stage === 'execution'
    );

    expect(resumedAdjustmentAudit?.data?.command?.args).toEqual(['adjustment']);
    expect(executionAudit?.data?.resumedSession).toBe(false);
  });

  it('reruns a failed feature from a fresh top-level pass and succeeds on the first full rerun', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const inner = new MockAgentAdapter();
    const adapter = new RecordingAdapter(inner);
    const innerRunTurn = inner.runTurn.bind(inner);
    const { lines, dependencies } = createNotificationRecorder();
    let executionAttempts = 0;

    adapter.runTurn = async (request) => {
      adapter.requests.push(request);
      if (request.stage === 'execution') {
        executionAttempts += 1;
        if (executionAttempts <= 2) {
          return {
            ok: false,
            backend: 'mock',
            sessionId: `failed-execution-${executionAttempts}`,
            model: request.model,
            error: 'bad output from agent',
            classified: { tier: 'agent', reason: 'bad output from agent' },
            artifacts: {
              stdout: '',
              stderr: 'bad output from agent',
              exitCode: 1,
              command: adapter.buildCommand(request)
            }
          };
        }
      }

      return innerRunTurn(request);
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'completed',
      attempts: 2,
      rerunEligible: false
    });
    expect(adapter.requests.filter((request) => request.stage === 'execution')).toHaveLength(3);
    expect(lines.some((line) => line.includes('Scheduling full rerun 2/3 for feature 001'))).toBe(true);
  });

  it('reruns a failed feature twice and succeeds on the second full rerun', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const inner = new MockAgentAdapter();
    const adapter = new RecordingAdapter(inner);
    const innerRunTurn = inner.runTurn.bind(inner);
    let executionAttempts = 0;

    adapter.runTurn = async (request) => {
      adapter.requests.push(request);
      if (request.stage === 'execution') {
        executionAttempts += 1;
        if (executionAttempts <= 4) {
          return {
            ok: false,
            backend: 'mock',
            sessionId: `failed-execution-${executionAttempts}`,
            model: request.model,
            error: 'bad output from agent',
            classified: { tier: 'agent', reason: 'bad output from agent' },
            artifacts: {
              stdout: '',
              stderr: 'bad output from agent',
              exitCode: 1,
              command: adapter.buildCommand(request)
            }
          };
        }
      }

      return innerRunTurn(request);
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'completed',
      attempts: 3,
      rerunEligible: false
    });
    expect(adapter.requests.filter((request) => request.stage === 'execution')).toHaveLength(5);
  });

  it('notifies when a feature fails after its full rerun budget is exhausted', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(
      new MockAgentAdapter({
        fixtures: {
          execution: {
            error: 'bad output from agent'
          }
        }
      })
    );
    const { lines, dependencies } = createNotificationRecorder();

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('failed');
    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'failed',
      attempts: 3,
      rerunEligible: false
    });
    expect(adapter.requests.filter((request) => request.stage === 'execution')).toHaveLength(6);
    expect(lines.some((line) => line.includes('Feature 001 add dashboard filters failed'))).toBe(true);
    expect(lines.some((line) => line.includes('Execution rerun budget exhausted for feature 001'))).toBe(
      true
    );
  });

  it('does not schedule a full rerun after a fatal execution failure', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const inner = new MockAgentAdapter();
    const adapter = new RecordingAdapter(inner);

    adapter.runTurn = async (request) => {
      adapter.requests.push(request);
      if (request.stage === 'execution') {
        return {
          ok: false,
          backend: 'mock',
          sessionId: 'fatal-execution',
          model: request.model,
          error: 'authentication failed',
          classified: { tier: 'fatal', reason: 'authentication failed' },
          artifacts: {
            stdout: '',
            stderr: 'authentication failed',
            exitCode: 1,
            command: adapter.buildCommand(request)
          }
        };
      }

      return inner.runTurn(request);
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('failed');
    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'failed',
      attempts: 1,
      rerunEligible: false,
      lastError: 'authentication failed'
    });
    expect(adapter.requests.filter((request) => request.stage === 'execution')).toHaveLength(1);
  });

  it('marks a feature failed when execution setup throws before a typed result is returned', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    vi.resetModules();
    vi.doMock('../../src/git/index.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/git/index.js')>(
        '../../src/git/index.js'
      );

      return {
        ...actual,
        createWorktree: vi.fn(async () => {
          throw new Error('simulated worktree creation failure');
        })
      };
    });

    try {
      const { runRealOrchestration: runRealOrchestrationWithWorktreeProbe } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runRealOrchestrationWithWorktreeProbe({
        config,
        configHash,
        adapter,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('failed');
      expect(result.checkpoint.features['001']).toMatchObject({
        status: 'failed',
        attempts: 1,
        lastError: 'simulated worktree creation failure'
      });

      const auditEntries = (await readFile(path.join(repoRoot, '.openweft', 'audit-trail.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) =>
          JSON.parse(line) as {
            event: string;
            message: string;
            data?: {
              featureId?: string;
              error?: string;
            };
          }
        );
      const executionFailureAudit = auditEntries.find(
        (entry) =>
          entry.event === 'feature.execution.failed' &&
          entry.data?.featureId === '001'
      );
      const terminalAudit = auditEntries.find((entry) => entry.event === 'run.failed');

      expect(executionFailureAudit?.data?.error).toBe('simulated worktree creation failure');
      expect(terminalAudit?.data).toEqual(expect.objectContaining({
        status: 'failed',
        finalHead: expect.any(String),
        mergeDurability: expect.any(Object),
        runtimeCleanup: expect.any(Object)
      }));
    } finally {
      vi.doUnmock('../../src/git/index.js');
      vi.resetModules();
    }
  });

  it('preserves cost totals when concurrent executions interleave their cost-file appends', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 2,
      queueRequests: ['add dashboard filters', 'add export controls']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    vi.resetModules();
    vi.doMock('../../src/fs/index.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/fs/index.js')>(
        '../../src/fs/index.js'
      );

      let releaseFirstAppend: (() => void) | null = null;
      let delayedCostAppends = 0;

      return {
        ...actual,
        appendJsonLine: vi.fn(async (filePath: string, payload: unknown) => {
          const stage =
            typeof payload === 'object' &&
            payload !== null &&
            'stage' in payload &&
            typeof payload.stage === 'string'
              ? payload.stage
              : null;

          if (filePath.endsWith('costs.jsonl') && stage === 'execution') {
            delayedCostAppends += 1;
            if (delayedCostAppends === 1) {
              await new Promise<void>((resolve) => {
                releaseFirstAppend = resolve;
              });
            } else if (delayedCostAppends === 2) {
              releaseFirstAppend?.();
            }
          }

          return actual.appendJsonLine(filePath, payload);
        })
      };
    });

    try {
      const { runRealOrchestration: runRealOrchestrationWithDelayedCosts } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runRealOrchestrationWithDelayedCosts({
        config,
        configHash,
        adapter,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('completed');

      const costRecords = (await readFile(path.join(repoRoot, '.openweft', 'costs.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) =>
          JSON.parse(line) as {
            featureId: string;
            inputTokens: number;
            outputTokens: number;
            estimatedCostUsd: number;
          }
        );

      const totalInputTokens = costRecords.reduce((sum, record) => sum + record.inputTokens, 0);
      const totalOutputTokens = costRecords.reduce((sum, record) => sum + record.outputTokens, 0);
      const totalEstimatedUsd = Number.parseFloat(
        costRecords.reduce((sum, record) => sum + record.estimatedCostUsd, 0).toFixed(6)
      );

      expect(result.checkpoint.cost.totalInputTokens).toBe(totalInputTokens);
      expect(result.checkpoint.cost.totalOutputTokens).toBe(totalOutputTokens);
      expect(result.checkpoint.cost.totalEstimatedUsd).toBe(totalEstimatedUsd);
      expect(Object.keys(result.checkpoint.cost.perFeature).sort()).toEqual(['001', '002']);
    } finally {
      vi.doUnmock('../../src/fs/index.js');
      vi.resetModules();
    }
  }, 60_000);

  it('restores git gc.auto from a stale breadcrumb before starting a new run', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const gcBreadcrumbFile = path.join(config.paths.openweftDir, 'gc-auto-previous.json');

    await mkdir(config.paths.openweftDir, { recursive: true });
    await setAutoGc(repoRoot, '17');
    await writeFile(
      gcBreadcrumbFile,
      `${JSON.stringify({ previousValue: '17', savedAt: new Date().toISOString() })}\n`,
      'utf8'
    );
    await setAutoGc(repoRoot, '0');

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new RecordingAdapter(new MockAgentAdapter()),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(await getAutoGcSetting(repoRoot)).toBe('17');
    await expect(readFile(gcBreadcrumbFile, 'utf8')).rejects.toThrow();
  });

  it('fails closed before pruning startup artifacts when the checkpoint is corrupted', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const orphanBranchName = 'openweft-999-orphan';
    const orphanWorktreePath = path.join(config.paths.worktreesDir, '999');

    await mkdir(config.paths.worktreesDir, { recursive: true });
    await createWorktree({
      repoRoot,
      worktreePath: orphanWorktreePath,
      branchName: orphanBranchName
    });
    await writeFile(config.paths.checkpointFile, '{not valid json', 'utf8');

    await expect(
      runRealOrchestration({
        config,
        configHash,
        adapter: new RecordingAdapter(new MockAgentAdapter()),
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      })
    ).rejects.toThrow(/checkpoint/i);

    await expect(readFile(path.join(orphanWorktreePath, '.git'), 'utf8')).resolves.toContain(
      '.git/worktrees'
    );
    const branches = await simpleGit(repoRoot).branchLocal();
    expect(branches.all).toContain(orphanBranchName);
  });

  it('prunes orphaned OpenWeft worktrees and branches before starting a new run', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const orphanBranchName = 'openweft-999-orphan';
    const orphanWorktreePath = path.join(config.paths.worktreesDir, '999');

    await mkdir(config.paths.worktreesDir, { recursive: true });
    await createWorktree({
      repoRoot,
      worktreePath: orphanWorktreePath,
      branchName: orphanBranchName
    });

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new RecordingAdapter(new MockAgentAdapter()),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    const listed = await listWorktrees(repoRoot);
    expect(listed.some((entry) => entry.path === orphanWorktreePath)).toBe(false);

    const branches = await simpleGit(repoRoot).branchLocal();
    expect(branches.all).not.toContain(orphanBranchName);

    const auditEntries = (await readFile(path.join(repoRoot, '.openweft', 'audit-trail.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) =>
        JSON.parse(line) as {
          event: string;
          data?: {
            removedWorktreePaths?: string[];
            removedBranchNames?: string[];
          };
        }
      );
    const pruneAudit = auditEntries.find((entry) => entry.event === 'repo.orphans.pruned');

    expect(
      pruneAudit?.data?.removedWorktreePaths?.some((removedPath) =>
        removedPath.endsWith(`${path.sep}999`)
      )
    ).toBe(true);
    expect(pruneAudit?.data?.removedBranchNames).toContain(orphanBranchName);
  });

  it('skips oversized and binary-like files during scoring scans', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const largeFile = path.join(repoRoot, 'docs', 'large-reference.ts');
    const binaryFile = path.join(repoRoot, 'assets', 'diagram.png');
    await mkdir(path.dirname(largeFile), { recursive: true });
    await mkdir(path.dirname(binaryFile), { recursive: true });
    await writeFile(largeFile, `src/target.ts\n${'x'.repeat(600_000)}`, 'utf8');
    await writeFile(binaryFile, 'src/target.ts', 'utf8');

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    let largeFileReads = 0;
    let binaryFileReads = 0;

    vi.resetModules();
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

      return {
        ...actual,
        readFile: vi.fn(async (filePath: string | URL | number, options?: BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null) => {
          const resolvedPath = typeof filePath === 'string' ? filePath : String(filePath);
          if (resolvedPath === largeFile) {
            largeFileReads += 1;
          }
          if (resolvedPath === binaryFile) {
            binaryFileReads += 1;
          }

          return actual.readFile(filePath as never, options as never);
        })
      };
    });

    try {
      const { runRealOrchestration: runRealOrchestrationWithReadSpy } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runRealOrchestrationWithReadSpy({
        config,
        configHash,
        adapter: new DeterministicScoringAdapter(),
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('completed');
      expect(largeFileReads).toBe(0);
      expect(binaryFileReads).toBe(0);
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }
  });

  it('batches merged summaries into one adjustment per remaining feature', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 2,
      queueRequests: ['add feature alpha', 'add feature beta', 'add feature gamma', 'add feature delta']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new DeterministicManifestAdapter({
      '001': ['src/a.ts'],
      '002': ['src/b.ts'],
      '003': ['src/a.ts', 'src/b.ts'],
      '004': ['src/c.ts']
    });

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');

    const featureThreeAdjustments = adapter.requests.filter(
      (request) => request.stage === 'adjustment' && request.featureId === '003'
    );
    const featureFourAdjustments = adapter.requests.filter(
      (request) => request.stage === 'adjustment' && request.featureId === '004'
    );
    const auditEntries = (await readFile(path.join(repoRoot, '.openweft', 'audit-trail.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) =>
        JSON.parse(line) as {
          event: string;
          data?: {
            phaseIndex?: number;
            featureId?: string;
            result?: string;
            decision?: string;
            planChanged?: boolean;
            orderedFeatures?: Array<{
              featureId: string;
              smoothedPriority: number;
            }>;
          };
        }
      );
    const mergeOrderAudit = auditEntries.find((entry) => entry.event === 'merge.phase.order');
    const phaseOneMergeResultAudits = auditEntries.filter(
      (entry) => entry.event === 'merge.feature.result' && entry.data?.phaseIndex === 1
    );
    const reanalysisDecisionAudits = auditEntries.filter(
      (entry) => entry.event === 'reanalysis.feature.decision' && entry.data?.phaseIndex === 1
    );

    expect(featureThreeAdjustments).toHaveLength(1);
    expect(featureThreeAdjustments[0]?.prompt).toContain('src/a.ts');
    expect(featureThreeAdjustments[0]?.prompt).toContain('src/b.ts');
    expect(featureFourAdjustments).toHaveLength(0);
    expect(result.checkpoint.pendingMergeSummaries).toEqual([]);
    expect(mergeOrderAudit?.data?.orderedFeatures?.map((entry) => entry.featureId).sort()).toEqual([
      '001',
      '002'
    ]);
    expect(
      mergeOrderAudit?.data?.orderedFeatures?.map((entry) => entry.smoothedPriority)
    ).toEqual(
      [...(mergeOrderAudit?.data?.orderedFeatures?.map((entry) => entry.smoothedPriority) ?? [])].sort(
        (left, right) => right - left
      )
    );
    expect(phaseOneMergeResultAudits.map((entry) => entry.data?.featureId).sort()).toEqual(['001', '002']);
    expect(phaseOneMergeResultAudits.every((entry) => entry.data?.result === 'merged')).toBe(true);
    expect(
      reanalysisDecisionAudits.some(
        (entry) =>
          entry.data?.featureId === '003' &&
          entry.data.decision === 'adjustment-attempted' &&
          typeof entry.data.planChanged === 'boolean'
      )
    ).toBe(true);
    expect(
      reanalysisDecisionAudits.some(
        (entry) => entry.data?.featureId === '004' && entry.data.decision === 'skipped-no-overlap'
      )
    ).toBe(true);
  });

  it('reuses an interrupted execution commit without rerunning execution', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config
    });

    const configHash = 'test-config-hash';
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.mergedCount).toBe(1);
    expect(adapter.requests.some((request) => request.stage === 'execution')).toBe(false);
    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'completed',
      branchName: null,
      worktreePath: null,
      sessionId: null,
      sessionScope: null
    });
  });

  it('reuses an interrupted execution commit even after a prior restart already rewrote the feature back to planned', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config,
      status: 'planned'
    });

    const configHash = 'test-config-hash';
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.mergedCount).toBe(1);
    expect(adapter.requests.some((request) => request.stage === 'execution')).toBe(false);
  });

  it('reruns execution when an interrupted worktree commit does not match the expected OpenWeft completion commit', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config,
      commitMessage: 'manual experiment commit'
    });

    const configHash = 'test-config-hash';
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.mergedCount).toBe(1);
    expect(adapter.requests.some((request) => request.stage === 'execution')).toBe(true);
  }, 60_000);

  it('reuses an interrupted execution commit when a matching completion commit changed files outside the manifest', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config,
      includeOffManifestFile: true
    });

    const configHash = 'test-config-hash';
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.mergedCount).toBe(1);
    expect(adapter.requests.some((request) => request.stage === 'execution')).toBe(false);
  });

  it('reruns execution when an interrupted worktree is still dirty', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config,
      leaveDirty: true
    });

    const configHash = 'test-config-hash';
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.mergedCount).toBe(1);
    expect(adapter.requests.some((request) => request.stage === 'execution')).toBe(true);
  });

  it('resolves merge conflicts through the orchestrator worktree retry path', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['update shared module']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);
    const ledgerNote = 'Conflict resolution preserved the updated ledger.';

    adapter.runTurn = async (request) => {
      if (request.stage === 'conflict-resolution') {
        const promptedPlanPath = extractConflictPromptPlanPath(request.prompt);
        const worktreePlanPath = promptedPlanPath.startsWith(request.cwd)
          ? promptedPlanPath
          : path.join(request.cwd, '.openweft', 'feature-plans', path.basename(promptedPlanPath));
        await appendLedgerNoteToPlan(worktreePlanPath, ledgerNote);
      }

      return originalRunTurn(request);
    };

    const mergedEditSummary = {
      merge_commit: 'merge-commit',
      branch: 'openweft-001-update-shared-module',
      pre_merge_commit: 'pre-merge-commit',
      total_files_changed: 1,
      total_lines_added: 2,
      total_lines_removed: 1,
      files: [
        {
          path: 'src/features/001-runtime-generated-prompt-b-for-001.ts',
          change_type: 'modified' as const,
          lines_added: 2,
          lines_removed: 1,
          old_path: null
        }
      ]
    };

    vi.resetModules();
    vi.doMock('../../src/git/index.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/git/index.js')>(
        '../../src/git/index.js'
      );
      let mergeAttempts = 0;

      return {
        ...actual,
        isCommitAncestor: vi.fn(async (_repoRoot: string, ancestorCommit: string) => {
          return ancestorCommit === 'merge-commit';
        }),
        mergeBranchIntoCurrent: vi.fn(async (_repoRoot: string, branch: string) => {
          mergeAttempts += 1;
          if (mergeAttempts === 1) {
            return {
              status: 'conflict' as const,
              branch,
              preMergeCommit: 'pre-merge-commit',
              conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
            };
          }

          return {
            status: 'merged' as const,
            branch,
            preMergeCommit: 'pre-merge-commit',
            mergeCommit: 'merge-commit',
            editSummary: mergedEditSummary
          };
        }),
        mergeBranchIntoWorktree: vi.fn(async (_worktreePath: string, branch: string) => ({
          status: 'conflicted' as const,
          branch,
          preMergeCommit: 'pre-merge-commit',
          mergeHeadCommit: 'merge-head-commit',
          conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
        })),
        commitAllChanges: vi.fn(async () => 'resolved-commit')
      };
    });

    try {
      const { runRealOrchestration: runRealOrchestrationWithConflictMocks } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runRealOrchestrationWithConflictMocks({
        config,
        configHash,
        adapter,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('completed');
      expect(result.mergedCount).toBe(1);
      expect(adapter.requests.some((request) => request.stage === 'conflict-resolution')).toBe(true);
      const planFile = result.checkpoint.features['001']?.planFile;
      expect(planFile).toBeDefined();
      expect(result.checkpoint.features['001']?.evolvedPlanFile).toBeNull();
      await expect(readFile(buildEvolvedPlanPath(config, '001'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT'
      });
      expect(await readFile(planFile ?? '', 'utf8')).toContain(ledgerNote);
      expect(await readFile(path.join(config.paths.shadowPlansDir, '001.md'), 'utf8')).toContain(
        ledgerNote
      );
    } finally {
      vi.doUnmock('../../src/git/index.js');
      vi.resetModules();
    }
  });

  it('retries merge conflict reconciliation until round 2 succeeds', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['update shared module']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const inner = new MockAgentAdapter();
    const adapter = new RecordingAdapter(inner);
    const innerRunTurn = inner.runTurn.bind(inner);
    const ledgerNote = 'Conflict resolution succeeded on the second round.';

    adapter.runTurn = async (request) => {
      adapter.requests.push(request);
      if (request.stage === 'conflict-resolution') {
        const promptedPlanPath = extractConflictPromptPlanPath(request.prompt);
        const worktreePlanPath = promptedPlanPath.startsWith(request.cwd)
          ? promptedPlanPath
          : path.join(request.cwd, '.openweft', 'feature-plans', path.basename(promptedPlanPath));
        await appendLedgerNoteToPlan(worktreePlanPath, ledgerNote);
      }

      return innerRunTurn(request);
    };

    const mergedEditSummary = {
      merge_commit: 'merge-commit',
      branch: 'openweft-001-update-shared-module',
      pre_merge_commit: 'pre-merge-commit',
      total_files_changed: 1,
      total_lines_added: 2,
      total_lines_removed: 1,
      files: [
        {
          path: 'src/features/001-runtime-generated-prompt-b-for-001.ts',
          change_type: 'modified' as const,
          lines_added: 2,
          lines_removed: 1,
          old_path: null
        }
      ]
    };

    vi.resetModules();
    vi.doMock('../../src/git/index.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/git/index.js')>(
        '../../src/git/index.js'
      );
      const abortMerge = vi.fn(async () => {});
      let mergeAttempts = 0;

      return {
        ...actual,
        abortMerge,
        isCommitAncestor: vi.fn(async (_repoRoot: string, ancestorCommit: string) => {
          return ancestorCommit === 'merge-commit';
        }),
        mergeBranchIntoCurrent: vi.fn(async (_repoRoot: string, branch: string) => {
          mergeAttempts += 1;
          if (mergeAttempts <= 2) {
            return {
              status: 'conflict' as const,
              branch,
              preMergeCommit: 'pre-merge-commit',
              conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
            };
          }

          return {
            status: 'merged' as const,
            branch,
            preMergeCommit: 'pre-merge-commit',
            mergeCommit: 'merge-commit',
            editSummary: mergedEditSummary
          };
        }),
        mergeBranchIntoWorktree: vi.fn(async (_worktreePath: string, branch: string) => ({
          status: 'conflicted' as const,
          branch,
          preMergeCommit: 'pre-merge-commit',
          mergeHeadCommit: 'merge-head-commit',
          conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
        }))
      };
    });

    try {
      const gitModule = await import('../../src/git/index.js');
      const abortMergeMock = vi.mocked(gitModule.abortMerge);
      const { runRealOrchestration: runRealOrchestrationWithConflictMocks } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runRealOrchestrationWithConflictMocks({
        config,
        configHash,
        adapter,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('completed');
      expect(result.checkpoint.features['001']).toMatchObject({
        status: 'completed',
        mergeResolutionAttempts: 0
      });
      expect(adapter.requests.filter((request) => request.stage === 'conflict-resolution')).toHaveLength(2);
      expect(abortMergeMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.doUnmock('../../src/git/index.js');
      vi.resetModules();
    }
  });

  it('resets the worktree to a clean baseline before retrying a later conflict-resolution round', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['update shared module']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const inner = new MockAgentAdapter();
    const adapter = new RecordingAdapter(inner);
    const innerRunTurn = inner.runTurn.bind(inner);

    adapter.runTurn = async (request) => {
      adapter.requests.push(request);
      return innerRunTurn(request);
    };

    const mergedEditSummary = {
      merge_commit: 'merge-commit',
      branch: 'openweft-001-update-shared-module',
      pre_merge_commit: 'pre-merge-commit',
      total_files_changed: 1,
      total_lines_added: 2,
      total_lines_removed: 1,
      files: [
        {
          path: 'src/features/001-runtime-generated-prompt-b-for-001.ts',
          change_type: 'modified' as const,
          lines_added: 2,
          lines_removed: 1,
          old_path: null
        }
      ]
    };

    vi.resetModules();
    vi.doMock('../../src/git/index.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/git/index.js')>(
        '../../src/git/index.js'
      );
      const abortMerge = vi.fn(async () => {});
      const resetWorktreeToHead = vi.fn(async () => {});
      let mergeAttempts = 0;

      return {
        ...actual,
        abortMerge,
        isCommitAncestor: vi.fn(async (_repoRoot: string, ancestorCommit: string) => {
          return ancestorCommit === 'merge-commit';
        }),
        resetWorktreeToHead,
        mergeBranchIntoCurrent: vi.fn(async (_repoRoot: string, branch: string) => {
          mergeAttempts += 1;
          if (mergeAttempts <= 2) {
            return {
              status: 'conflict' as const,
              branch,
              preMergeCommit: 'pre-merge-commit',
              conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
            };
          }

          return {
            status: 'merged' as const,
            branch,
            preMergeCommit: 'pre-merge-commit',
            mergeCommit: 'merge-commit',
            editSummary: mergedEditSummary
          };
        }),
        mergeBranchIntoWorktree: vi.fn(async (_worktreePath: string, branch: string) => ({
          status: 'conflicted' as const,
          branch,
          preMergeCommit: 'pre-merge-commit',
          mergeHeadCommit: 'merge-head-commit',
          conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
        }))
      };
    });

    try {
      const gitModule = await import('../../src/git/index.js');
      const resetWorktreeToHeadMock = vi.mocked(gitModule.resetWorktreeToHead);
      const { runRealOrchestration: runRealOrchestrationWithConflictMocks } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runRealOrchestrationWithConflictMocks({
        config,
        configHash,
        adapter,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('completed');
      expect(resetWorktreeToHeadMock).toHaveBeenCalledWith(
        result.checkpoint.features['001']?.worktreePath ?? expect.any(String)
      );
    } finally {
      vi.doUnmock('../../src/git/index.js');
      vi.resetModules();
    }
  });

  it('fails truthfully after exhausting all merge conflict reconciliation rounds', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['update shared module']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const inner = new MockAgentAdapter();
    const adapter = new RecordingAdapter(inner);
    const innerRunTurn = inner.runTurn.bind(inner);

    adapter.runTurn = async (request) => {
      adapter.requests.push(request);
      if (request.stage === 'conflict-resolution') {
        return innerRunTurn(request);
      }

      return innerRunTurn(request);
    };

    vi.resetModules();
    vi.doMock('../../src/git/index.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/git/index.js')>(
        '../../src/git/index.js'
      );
      const abortMerge = vi.fn(async () => {});

      return {
        ...actual,
        abortMerge,
        mergeBranchIntoCurrent: vi.fn(async (_repoRoot: string, branch: string) => ({
          status: 'conflict' as const,
          branch,
          preMergeCommit: 'pre-merge-commit',
          conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
        })),
        mergeBranchIntoWorktree: vi.fn(async (_worktreePath: string, branch: string) => ({
          status: 'conflicted' as const,
          branch,
          preMergeCommit: 'pre-merge-commit',
          mergeHeadCommit: 'merge-head-commit',
          conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
        }))
      };
    });

    try {
      const gitModule = await import('../../src/git/index.js');
      const abortMergeMock = vi.mocked(gitModule.abortMerge);
      const { runRealOrchestration: runRealOrchestrationWithConflictMocks } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runRealOrchestrationWithConflictMocks({
        config,
        configHash,
        adapter,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('failed');
      expect(result.checkpoint.features['001']).toMatchObject({
        status: 'failed',
        rerunEligible: false,
        mergeResolutionAttempts: 3
      });
      expect(adapter.requests.filter((request) => request.stage === 'conflict-resolution')).toHaveLength(3);
      expect(abortMergeMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      vi.doUnmock('../../src/git/index.js');
      vi.resetModules();
    }
  });

  it('aborts preserved merge state when conflict resolution fails after a merge-into-worktree conflict', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['update shared module']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);

    adapter.runTurn = async (request) => {
      adapter.requests.push(request);
      if (request.stage === 'conflict-resolution') {
        return {
          ok: false,
          backend: 'mock',
          sessionId: 'conflict-session',
          model: request.model,
          error: 'resolution failed',
          classified: { tier: 'agent', reason: 'resolution failed' },
          artifacts: {
            stdout: '',
            stderr: 'resolution failed',
            exitCode: 1,
            command: adapter.buildCommand(request)
          }
        };
      }

      return originalRunTurn(request);
    };

    vi.resetModules();
    vi.doMock('../../src/git/index.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/git/index.js')>(
        '../../src/git/index.js'
      );
      const abortMerge = vi.fn(async () => {});

      return {
        ...actual,
        abortMerge,
        mergeBranchIntoCurrent: vi.fn(async (_repoRoot: string, branch: string) => ({
          status: 'conflict' as const,
          branch,
          preMergeCommit: 'pre-merge-commit',
          conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
        })),
        mergeBranchIntoWorktree: vi.fn(async (_worktreePath: string, branch: string) => ({
          status: 'conflicted' as const,
          branch,
          preMergeCommit: 'pre-merge-commit',
          mergeHeadCommit: 'merge-head-commit',
          conflicts: [{ file: 'src/conflicted.ts', reason: 'content' }]
        }))
      };
    });

    try {
      const gitModule = await import('../../src/git/index.js');
      const abortMergeMock = vi.mocked(gitModule.abortMerge);
      const { runRealOrchestration: runRealOrchestrationWithConflictMocks } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runRealOrchestrationWithConflictMocks({
        config,
        configHash,
        adapter,
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('failed');
      expect(result.mergedCount).toBe(0);
      expect(result.checkpoint.features['001']).toMatchObject({
        status: 'failed',
        lastError: 'resolution failed'
      });
      expect(adapter.requests.some((request) => request.stage === 'conflict-resolution')).toBe(true);
      expect(abortMergeMock).toHaveBeenCalledWith(
        result.checkpoint.features['001']?.worktreePath ?? expect.any(String)
      );
    } finally {
      vi.doUnmock('../../src/git/index.js');
      vi.resetModules();
    }
  });

  it('persists a merged feature as completed before cleanup can fail', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const residueFile = path.join(config.paths.codexHomeDir, 'state.sqlite');
    await mkdir(config.paths.codexHomeDir, { recursive: true });
    await writeFile(residueFile, 'test\n', 'utf8');

    vi.resetModules();
    vi.doMock('../../src/git/index.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/git/index.js')>(
        '../../src/git/index.js'
      );

      return {
        ...actual,
        removeWorktree: vi.fn(async (...args: Parameters<typeof actual.removeWorktree>) => {
          throw new Error('post-merge cleanup probe');
        })
      };
    });

    try {
      const { runRealOrchestration: runRealOrchestrationWithCleanupProbe } = await import(
        '../../src/orchestrator/realRun.js'
      );

      await expect(
        runRealOrchestrationWithCleanupProbe({
          config,
          configHash,
          adapter: new DeterministicScoringAdapter(),
          notificationDependencies: createNotificationRecorder().dependencies,
          sleep: async () => {}
        })
      ).rejects.toThrow('post-merge cleanup probe');
    } finally {
      vi.doUnmock('../../src/git/index.js');
      vi.resetModules();
    }

    const saved = await loadCheckpoint({
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });

    expect(saved.checkpoint?.status).toBe('failed');
    expect(saved.checkpoint?.features['001']).toMatchObject({
      status: 'completed'
    });
    await expect(access(residueFile)).resolves.toBeUndefined();

    const auditEntries = await readAuditEntries(config.paths.auditLogFile);
    const terminalAudit = auditEntries.find((entry) => entry.event === 'run.failed');

    expect(terminalAudit?.data).toEqual(expect.objectContaining({
      status: 'failed',
      runtimeCleanup: expect.objectContaining({
        action: 'preserved'
      })
    }));
  });

  it('writes a terminal run.completed audit and cleans codex-home on success', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    await mkdir(config.paths.codexHomeDir, { recursive: true });
    await writeFile(path.join(config.paths.codexHomeDir, 'state.sqlite'), 'test\n', 'utf8');

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new DeterministicScoringAdapter(),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    await expect(access(config.paths.codexHomeDir)).rejects.toThrow();

    const auditEntries = await readAuditEntries(config.paths.auditLogFile);
    const terminalAudit = auditEntries.find((entry) => entry.event === 'run.completed');

    expect(terminalAudit?.data).toEqual(expect.objectContaining({
      status: 'completed',
      plannedCount: 1,
      mergedCount: 1,
      finalHead: expect.any(String),
      queue: expect.any(Object),
      unresolvedFailedFeatureIds: [],
      mergeDurability: expect.any(Object),
      runtimeCleanup: expect.objectContaining({
        action: 'cleaned'
      })
    }));
  });

  it('preserves codex-home on success when runtime policy is preserve', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      configOverrides: {
        runtime: {
          codexHomeRetention: 'preserve'
        }
      },
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const residueFile = path.join(config.paths.codexHomeDir, 'state.sqlite');
    await mkdir(config.paths.codexHomeDir, { recursive: true });
    await writeFile(residueFile, 'test\n', 'utf8');

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new DeterministicScoringAdapter(),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    await expect(access(residueFile)).resolves.toBeUndefined();

    const auditEntries = await readAuditEntries(config.paths.auditLogFile);
    const terminalAudit = auditEntries.find((entry) => entry.event === 'run.completed');

    expect(terminalAudit?.data).toEqual(expect.objectContaining({
      runtimeCleanup: expect.objectContaining({
        action: 'preserved'
      })
    }));
  });

  it('downgrades a completed run to failed when a completed feature has no merge commit', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);

    vi.resetModules();
    vi.doMock('../../src/status/runtimeDiagnostics.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/status/runtimeDiagnostics.js')>(
        '../../src/status/runtimeDiagnostics.js'
      );

      return {
        ...actual,
        collectRuntimeDiagnostics: vi.fn(async () => ({
          checkpointTimestamps: {
            primaryUpdatedAt: '2026-04-06T14:08:49.618Z',
            backupUpdatedAt: '2026-04-06T14:08:49.547Z'
          },
          headCommit: 'abc123',
          mergeDurability: {
            totalCompletedFeatures: 1,
            verifiedCount: 0,
            checks: [
              {
                featureId: '001',
                mergeCommit: null,
                result: 'missing-merge-commit'
              }
            ]
          },
          runtimeArtifacts: {
            codexHomePresent: false,
            residueFileCount: 0
          }
        }))
      };
    });

    try {
      const { runRealOrchestration: runRealOrchestrationWithMissingMergeCommit } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runRealOrchestrationWithMissingMergeCommit({
        config,
        configHash,
        adapter: new DeterministicScoringAdapter(),
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('failed');
      expect(result.checkpoint.features['001']).toMatchObject({
        status: 'failed',
        lastError: expect.stringContaining('missing recorded merge commit')
      });

      const auditEntries = await readAuditEntries(config.paths.auditLogFile);
      const terminalAudit = auditEntries.find((entry) => entry.event === 'run.failed');

      expect(terminalAudit?.data).toEqual(expect.objectContaining({
        status: 'failed',
        unresolvedFailedFeatureIds: ['001'],
        mergeDurability: expect.objectContaining({
          checks: expect.arrayContaining([
            expect.objectContaining({
              featureId: '001',
              result: 'missing-merge-commit'
            })
          ])
        })
      }));
    } finally {
      vi.doUnmock('../../src/status/runtimeDiagnostics.js');
      vi.resetModules();
    }
  });

  it('downgrades a completed run to failed when final head no longer contains the completed merge commit', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);

    vi.resetModules();
    vi.doMock('../../src/status/runtimeDiagnostics.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/status/runtimeDiagnostics.js')>(
        '../../src/status/runtimeDiagnostics.js'
      );

      return {
        ...actual,
        collectRuntimeDiagnostics: vi.fn(async () => ({
          checkpointTimestamps: {
            primaryUpdatedAt: '2026-04-06T14:08:49.618Z',
            backupUpdatedAt: '2026-04-06T14:08:49.547Z'
          },
          headCommit: '86059188acacb2475a5bad1e3634f6f51f9b8062',
          mergeDurability: {
            totalCompletedFeatures: 1,
            verifiedCount: 0,
            checks: [
              {
                featureId: '001',
                mergeCommit: 'ef7e12b2e42315b746794b4955a6f287e52ca1f3',
                result: 'not-reachable'
              }
            ]
          },
          runtimeArtifacts: {
            codexHomePresent: false,
            residueFileCount: 0
          }
        }))
      };
    });

    try {
      const { runRealOrchestration: runRealOrchestrationWithHeadDrift } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runRealOrchestrationWithHeadDrift({
        config,
        configHash,
        adapter: new DeterministicScoringAdapter(),
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('failed');
      expect(result.checkpoint.features['001']).toMatchObject({
        status: 'failed',
        lastError: expect.stringContaining('not reachable from final HEAD')
      });

      const auditEntries = await readAuditEntries(config.paths.auditLogFile);
      const terminalAudit = auditEntries.find((entry) => entry.event === 'run.failed');

      expect(terminalAudit?.data).toEqual(expect.objectContaining({
        status: 'failed',
        finalHead: '86059188acacb2475a5bad1e3634f6f51f9b8062',
        unresolvedFailedFeatureIds: ['001'],
        mergeDurability: expect.objectContaining({
          checks: expect.arrayContaining([
            expect.objectContaining({
              featureId: '001',
              result: 'not-reachable'
            })
          ])
        })
      }));
    } finally {
      vi.doUnmock('../../src/status/runtimeDiagnostics.js');
      vi.resetModules();
    }
  });

  it('downgrades a completed run to failed when codex-home cleanup does not stick', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    await mkdir(config.paths.codexHomeDir, { recursive: true });
    await writeFile(path.join(config.paths.codexHomeDir, 'state.sqlite'), 'test\n', 'utf8');

    vi.resetModules();
    vi.doMock('../../src/status/runtimeDiagnostics.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/status/runtimeDiagnostics.js')>(
        '../../src/status/runtimeDiagnostics.js'
      );

      return {
        ...actual,
        collectRuntimeDiagnostics: vi.fn(async () => ({
          checkpointTimestamps: {
            primaryUpdatedAt: '2026-04-06T14:08:49.618Z',
            backupUpdatedAt: '2026-04-06T14:08:49.547Z'
          },
          headCommit: 'abc123',
          mergeDurability: {
            totalCompletedFeatures: 1,
            verifiedCount: 1,
            checks: [
              {
                featureId: '001',
                mergeCommit: 'abc123',
                result: 'verified'
              }
            ]
          },
          runtimeArtifacts: {
            codexHomePresent: true,
            residueFileCount: 1
          }
        }))
      };
    });

    try {
      const { runRealOrchestration: runRealOrchestrationWithStickyCleanupProbe } = await import(
        '../../src/orchestrator/realRun.js'
      );

      const result = await runRealOrchestrationWithStickyCleanupProbe({
        config,
        configHash,
        adapter: new DeterministicScoringAdapter(),
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      });

      expect(result.checkpoint.status).toBe('failed');

      const auditEntries = await readAuditEntries(config.paths.auditLogFile);
      const terminalAudit = auditEntries.find((entry) => entry.event === 'run.failed');

      expect(terminalAudit?.data).toEqual(expect.objectContaining({
        status: 'failed',
        runtimeCleanup: expect.objectContaining({
          action: 'cleanup-failed'
        })
      }));
    } finally {
      vi.doUnmock('../../src/status/runtimeDiagnostics.js');
      vi.resetModules();
    }
  });

  it('recreates execution cleanly when a stale branch ref exists but the old worktree is gone', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config,
      status: 'planned'
    });

    const staleWorktreePath = path.join(config.paths.worktreesDir, '001');
    await simpleGit(repoRoot).raw(['worktree', 'remove', '--force', staleWorktreePath]);

    const configHash = 'test-config-hash';
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.mergedCount).toBe(1);
    expect(adapter.requests.some((request) => request.stage === 'execution')).toBe(true);
  });

  it('recreates execution cleanly when the checkpoint worktree path is missing but git still has the stale registration', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config,
      status: 'planned'
    });

    const staleWorktreePath = path.join(config.paths.worktreesDir, '001');
    await rm(staleWorktreePath, { recursive: true, force: true });

    const configHash = 'test-config-hash';
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.mergedCount).toBe(1);
    expect(adapter.requests.some((request) => request.stage === 'execution')).toBe(true);
  }, 60_000);

  it('marks a stale planned feature complete when its completion commit is already merged into main', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config,
      status: 'planned'
    });

    const staleBranchName = 'openweft-001-resume-test';
    await simpleGit(repoRoot).merge(['--no-ff', '--no-edit', staleBranchName]);

    const configHash = 'test-config-hash';
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(adapter.requests.some((request) => request.stage === 'execution')).toBe(false);
    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'completed'
    });
  });

  it('recovers a reusable completed commit even when the checkpoint already marked the feature failed', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config,
      status: 'executing'
    });

    const loaded = await loadCheckpoint({
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });
    const checkpoint = loaded.checkpoint;
    if (!checkpoint) {
      throw new Error('Expected seeded checkpoint.');
    }

    const feature001 = checkpoint.features['001'];
    if (!feature001) {
      throw new Error('Expected seeded feature 001.');
    }

    checkpoint.features['001'] = {
      ...feature001,
      status: 'failed',
      rerunEligible: true,
      lastError: 'merge cleanup probe'
    };
    checkpoint.currentState = 'idle';
    checkpoint.currentPhase = null;

    await saveCheckpoint({
      checkpoint,
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });

    const adapter = new RecordingAdapter(new MockAgentAdapter());

    const result = await runRealOrchestration({
      config,
      configHash: 'test-config-hash',
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(result.mergedCount).toBe(1);
    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'completed',
      rerunEligible: false
    });
    expect(adapter.requests.some((request) => request.stage === 'execution')).toBe(false);
  });

  it('replays deferred re-analysis after recovering an already-merged feature', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config,
      featureId: '001',
      request: 'first change',
      status: 'planned'
    });

    await simpleGit(repoRoot).merge(['--no-ff', '--no-edit', 'openweft-001-resume-test']);

    const featureTwoPlanFile = path.join(config.paths.featureRequestsDir, '002.plan.md');
    const featureTwoPromptBFile = path.join(config.paths.promptBArtifactsDir, '002.prompt-b.md');
    await mkdir(config.paths.featureRequestsDir, { recursive: true });
    await mkdir(config.paths.promptBArtifactsDir, { recursive: true });
    await writeFile(
      featureTwoPlanFile,
      `# Feature Plan: 002

${TEST_LEDGER_SECTION}

## Manifest

\`\`\`json manifest
{
  "create": ["src/target.ts"],
  "modify": [],
  "delete": []
}
\`\`\`
`,
      'utf8'
    );
    await writeFile(featureTwoPromptBFile, 'Prompt B for second change.\n', 'utf8');

    const loaded = await loadCheckpoint({
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });
    const checkpoint = loaded.checkpoint;
    if (!checkpoint) {
      throw new Error('Expected seeded checkpoint.');
    }

    checkpoint.features['002'] = {
      id: '002',
      request: 'second change',
      status: 'planned',
      attempts: 0,
      planFile: featureTwoPlanFile,
      evolvedPlanFile: null,
      promptBFile: featureTwoPromptBFile,
      branchName: null,
      worktreePath: null,
      sessionId: 'repo-session-002',
      sessionScope: 'repo',
      manifest: {
        create: ['src/target.ts'],
        modify: [],
        delete: []
      },
      rerunEligible: false,
      mergeResolutionAttempts: 0,
      updatedAt: new Date().toISOString()
    };
    checkpoint.queue = {
      orderedFeatureIds: ['001', '002'],
      totalCount: 2
    };
    checkpoint.currentState = 'idle';
    checkpoint.currentPhase = null;

    await saveCheckpoint({
      checkpoint,
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });

    const adapter = new RecordingAdapter(
      new DeterministicManifestAdapter({
        '002': ['src/target.ts']
      })
    );

    const result = await runRealOrchestration({
      config,
      configHash: 'test-config-hash',
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    const adjustmentIndex = adapter.requests.findIndex(
      (request) => request.featureId === '002' && request.stage === 'adjustment'
    );
    const executionIndex = adapter.requests.findIndex(
      (request) => request.featureId === '002' && request.stage === 'execution'
    );

    expect(result.checkpoint.status).toBe('completed');
    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'completed'
    });
    expect(adjustmentIndex).toBeGreaterThanOrEqual(0);
    expect(executionIndex).toBeGreaterThan(adjustmentIndex);
  });

  it('reuses a completed feature commit after main advances on an unrelated file', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: []
    });

    const { config } = await loadOpenWeftConfig(repoRoot);
    await seedInterruptedExecutionFeature({
      repoRoot,
      config,
      status: 'planned'
    });

    await mkdir(path.join(repoRoot, 'src'), { recursive: true });
    await writeFile(path.join(repoRoot, 'src', 'sibling.ts'), 'export const sibling = 1;\n', 'utf8');
    const repoGit = simpleGit(repoRoot);
    await repoGit.add(['src/sibling.ts']);
    await repoGit.commit('advance main on unrelated file');

    const configHash = 'test-config-hash';
    const adapter = new RecordingAdapter(new MockAgentAdapter());

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(adapter.requests.some((request) => request.stage === 'execution')).toBe(false);
    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'completed'
    });
  });

  it('resolves execution approvals through the real control channel', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters'],
      configOverrides: {
        approval: 'per-feature'
      }
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const events: string[] = [];
    const approvalController = new ApprovalController((event) => {
      events.push(event.type);
    });

    const runPromise = runRealOrchestration({
      config,
      configHash,
      adapter: new RecordingAdapter(new MockAgentAdapter()),
      notificationDependencies: createNotificationRecorder().dependencies,
      approvalController,
      onEvent: (event) => {
        events.push(event.type);
      },
      sleep: async () => {}
    });

    for (let attempt = 0; attempt < 200 && !approvalController.hasPendingApproval(); attempt += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    }

    expect(approvalController.hasPendingApproval()).toBe(true);
    expect(approvalController.resolveCurrent('skip')).toBe(true);

    const result = await runPromise;

    expect(events).toContain('agent:approval');
    expect(events).toContain('agent:approval-resolved');
    expect(events).toContain('agent:failed');
    expect(result.checkpoint.status).toBe('failed');
  });

  it('treats quit-driven approval cancellation as a stopped run instead of a failure', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters'],
      configOverrides: {
        approval: 'per-feature'
      }
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const events: string[] = [];
    const approvalController = new ApprovalController((event) => {
      events.push(event.type);
    });
    const stopController = new StopController();

    const runPromise = runRealOrchestration({
      config,
      configHash,
      adapter: new RecordingAdapter(new MockAgentAdapter()),
      approvalController,
      stopController,
      notificationDependencies: createNotificationRecorder().dependencies,
      onEvent: (event) => {
        events.push(event.type);
      },
      sleep: async () => {}
    });

    for (let attempt = 0; attempt < 200 && !approvalController.hasPendingApproval(); attempt += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
    }

    expect(approvalController.hasPendingApproval()).toBe(true);
    stopController.request('keyboard');
    expect(approvalController.resolveAll('skip')).toBe(1);

    const result = await runPromise;

    expect(result.checkpoint.status).toBe('stopped');
    expect(result.checkpoint.currentState).toBe('stopped');
    expect(result.mergedCount).toBe(0);
    expect(result.checkpoint.features['001']?.status).toBe('planned');
    expect(events).toContain('agent:approval');
    expect(events).toContain('agent:approval-resolved');
    expect(events).not.toContain('agent:failed');
  });

  it('threads configured codex effort into adapter turn requests', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      queueRequests: ['add dashboard filters'],
      configOverrides: {
        effort: {
          codex: 'high'
        }
      }
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new DeterministicManifestAdapter({ '001': ['src/target.ts'] }));

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(adapter.requests).not.toHaveLength(0);
    expect(adapter.requests.every((request) => request.effortLevel === 'high')).toBe(true);
  });

  it('threads configured claude effort into adapter turn requests', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      queueRequests: ['add dashboard filters'],
      configOverrides: {
        backend: 'claude',
        effort: {
          claude: 'max'
        }
      }
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingClaudeFailureAdapter();

    await expect(runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    })).rejects.toThrow('planning stage probe');

    expect(adapter.requests).not.toHaveLength(0);
    expect(adapter.requests.every((request) => request.effortLevel === 'max')).toBe(true);
  });

  it('fails fast when approval prompts are configured without an approval controller', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      queueRequests: ['add dashboard filters'],
      configOverrides: {
        approval: 'per-feature'
      }
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new RecordingAdapter(new MockAgentAdapter()),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('failed');
    expect(result.checkpoint.features['001']?.lastError).toMatch(
      /approval mode "per-feature" requires an approval controller/i
    );
  });

  it('prompts once per feature in per-feature approval mode', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters', 'add export controls'],
      configOverrides: {
        approval: 'per-feature'
      }
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const events: string[] = [];

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new RecordingAdapter(new MockAgentAdapter()),
      approvalController: createAutoApproveController(events),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(events.filter((event) => event === 'agent:approval')).toHaveLength(2);
  });

  it('prompts only once in first-only approval mode', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 2,
      queueRequests: ['add dashboard filters', 'add export controls'],
      configOverrides: {
        approval: 'first-only'
      }
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const events: string[] = [];

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new RecordingAdapter(new MockAgentAdapter()),
      approvalController: createDelayedApproveController(events, 25),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
    expect(events.filter((event) => event === 'agent:approval')).toHaveLength(1);
  });

  it('remembers first-only approval across checkpoint resume', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      queueRequests: ['add dashboard filters'],
      configOverrides: {
        approval: 'first-only'
      }
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const checkpoint = createEmptyCheckpoint({
      orchestratorVersion: 'test',
      configHash,
      runId: 'resume-run',
      checkpointId: 'resume-checkpoint',
      createdAt: new Date().toISOString()
    });
    checkpoint.approvalState = {
      firstApprovalSatisfied: true,
      approvedFeatureIds: ['001']
    };
    await saveCheckpoint({
      checkpoint,
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new RecordingAdapter(new MockAgentAdapter()),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('completed');
  });

  it('stops after the current planning item when a stop is requested during planning', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters', 'add export controls']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const stopController = new StopController();
    const adapter = new RecordingAdapter(new MockAgentAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);

    adapter.runTurn = async (request) => {
      const result = await originalRunTurn(request);
      if (request.stage === 'planning-s2' && request.featureId === '001') {
        stopController.request('keyboard');
      }
      return result;
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      stopController,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('stopped');
    expect(result.checkpoint.currentState).toBe('stopped');
    expect(result.plannedCount).toBe(1);
    expect(result.mergedCount).toBe(0);
    expect(result.checkpoint.features['001']?.status).toBe('planned');
    expect(result.checkpoint.features['002']).toBeUndefined();
    expect(result.checkpoint.pendingRequests).toEqual([
      {
        request: 'add export controls',
        queuedAt: result.checkpoint.createdAt
      }
    ]);

    const queueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    expect(queueContent).toContain('# openweft queue format: v1');
    expect(queueContent).toContain('"type":"processed"');
    expect(queueContent).toContain('"featureId":"001"');
    expect(queueContent).toContain('"request":"add export controls"');
  });

  it('does not start an execution retry after stop is requested during an active turn', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const stopController = new StopController();
    const adapter = new StopDuringExecutionFailureAdapter(stopController);

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      stopController,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(adapter.executionAttempts).toBe(1);
    expect(result.checkpoint.status).toBe('stopped');
    expect(result.checkpoint.currentState).toBe('stopped');
    expect(result.mergedCount).toBe(0);
    expect(result.checkpoint.features['001']).toMatchObject({
      status: 'planned',
      attempts: 0,
      lastError: null
    });
  });

  it('writes a terminal run.paused audit when the budget pause threshold is reached', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      configOverrides: {
        budget: {
          warnAtUsd: null,
          pauseAtUsd: 0,
          stopAtUsd: null
        }
      },
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter: new DeterministicScoringAdapter(),
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('paused');

    const auditEntries = await readAuditEntries(config.paths.auditLogFile);
    const terminalAudit = auditEntries.find((entry) => entry.event === 'run.paused');

    expect(terminalAudit?.data).toEqual(expect.objectContaining({
      status: 'paused',
      mergedCount: 1,
      plannedCount: 1,
      runtimeCleanup: expect.objectContaining({
        action: 'preserved'
      })
    }));
  });

  it('writes a terminal run.stopped audit and preserves codex-home on stop', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters', 'add export controls']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const stopController = new StopController();
    const adapter = new RecordingAdapter(new MockAgentAdapter());
    const originalRunTurn = adapter.runTurn.bind(adapter);
    const residueFile = path.join(config.paths.codexHomeDir, 'state.sqlite');
    await mkdir(config.paths.codexHomeDir, { recursive: true });
    await writeFile(residueFile, 'test\n', 'utf8');

    adapter.runTurn = async (request) => {
      const result = await originalRunTurn(request);
      if (request.stage === 'planning-s2' && request.featureId === '001') {
        stopController.request('keyboard');
      }
      return result;
    };

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      stopController,
      notificationDependencies: createNotificationRecorder().dependencies,
      sleep: async () => {}
    });

    expect(result.checkpoint.status).toBe('stopped');
    await expect(access(residueFile)).resolves.toBeUndefined();

    const auditEntries = await readAuditEntries(config.paths.auditLogFile);
    const terminalAudit = auditEntries.find((entry) => entry.event === 'run.stopped');

    expect(terminalAudit?.data).toEqual(expect.objectContaining({
      status: 'stopped',
      runtimeCleanup: expect.objectContaining({
        action: 'preserved'
      })
    }));
  });
});
