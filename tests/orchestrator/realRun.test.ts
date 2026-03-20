import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
import { createWorktree, getAutoGcSetting, listWorktrees, setAutoGc } from '../../src/git/index.js';
import type { NotificationDependencies } from '../../src/notifications/index.js';
import { ApprovalController } from '../../src/orchestrator/approval.js';
import { StopController } from '../../src/orchestrator/stop.js';
import { runRealOrchestration } from '../../src/orchestrator/realRun.js';
import { createEmptyCheckpoint, loadCheckpoint, saveCheckpoint } from '../../src/state/checkpoint.js';

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
            ? currentPlanMatch?.[1]?.trim() ?? '# Feature Plan\n\n## Manifest\n\n```json manifest\n{"create":[],"modify":[],"delete":[]}\n```'
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
        }
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

describe('runRealOrchestration', () => {
  it('injects the current plan context into adjustment prompts and emits phase progress', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters', 'add export controls']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new RecordingAdapter(new MockAgentAdapter());
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
    expect(executionRequest?.prompt).toContain(featureTwo?.promptBFile ?? '');
    expect(adjustmentRequest?.prompt).toContain('=== CURRENT PLAN START ===');
    expect(adjustmentRequest?.prompt).toContain(planContent.trim());
    expect(adjustmentRequest?.prompt).toContain('"merge_commit"');
    expect(result.checkpoint.cost.totalInputTokens).toBe(totalInputTokens);
    expect(result.checkpoint.cost.totalOutputTokens).toBe(totalOutputTokens);
    expect(result.checkpoint.cost.totalEstimatedUsd).toBe(Number.parseFloat(totalEstimatedUsd.toFixed(6)));
    expect(adjustmentAudit?.data?.returnedSessionId).toBe(true);
    expect(adjustmentAudit?.data?.command?.command).toBe('mock');
    expect(freshExecutionAudit?.data?.command?.args).toEqual(['run', 'execution']);

    expect(progressLines).toContain('OpenWeft run starting with backend mock.');
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
    expect(saved.checkpoint?.status).toBe('in-progress');
    expect(saved.checkpoint?.currentState).toBe('planning');
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

  it('persists already-planned requests when a later planning turn fails', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters', 'add export controls']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);

    await expect(
      runRealOrchestration({
        config,
        configHash,
        adapter: new PartialPlanningFailureAdapter(),
        notificationDependencies: createNotificationRecorder().dependencies,
        sleep: async () => {}
      })
    ).rejects.toThrow('simulated second planning failure');

    const saved = await loadCheckpoint({
      checkpointFile: config.paths.checkpointFile,
      checkpointBackupFile: config.paths.checkpointBackupFile
    });

    expect(saved.checkpoint?.features['001']).toMatchObject({
      id: '001',
      request: 'add dashboard filters',
      status: 'planned'
    });
    expect(saved.checkpoint?.features['002']).toBeUndefined();

    const queueContent = await readFile(config.paths.queueFile, 'utf8');
    expect(queueContent).toContain('# openweft queue format: v1');
    expect(queueContent).toContain('"type":"processed"');
    expect(queueContent).toContain('"featureId":"001"');
    expect(queueContent).toContain('"request":"add export controls"');
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
      adapter: new RecordingAdapter(new MockAgentAdapter()),
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

    expect(resumedAdjustmentAudit?.data?.command?.args).toEqual(['run', 'adjustment']);
    expect(executionAudit?.data?.resumedSession).toBe(false);
  });

  it('notifies when a feature fails after its retry budget is exhausted', async () => {
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
    expect(adapter.requests.filter((request) => request.stage === 'execution')).toHaveLength(2);
    expect(lines.some((line) => line.includes('Feature 001 add dashboard filters failed'))).toBe(true);
    expect(lines.some((line) => line.includes('Phase 1 halted by circuit breaker.'))).toBe(true);
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

      expect(executionFailureAudit?.data?.error).toBe('simulated worktree creation failure');
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
  });

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
      queueRequests: ['add feature alpha', 'add feature beta', 'add feature gamma']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);
    const adapter = new DeterministicManifestAdapter({
      '001': ['src/a.ts'],
      '002': ['src/b.ts'],
      '003': ['src/a.ts', 'src/b.ts']
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
    expect(featureThreeAdjustments).toHaveLength(1);
    expect(featureThreeAdjustments[0]?.prompt).toContain('src/a.ts');
    expect(featureThreeAdjustments[0]?.prompt).toContain('src/b.ts');
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
  });

  it('reruns execution when a matching completion commit changed files outside the manifest', async () => {
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
    expect(adapter.requests.some((request) => request.stage === 'execution')).toBe(true);
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

  it('persists a merged feature as completed before cleanup can fail', async () => {
    const repoRoot = await createTempRepo();
    await writeProjectFiles(repoRoot, {
      maxParallelAgents: 1,
      queueRequests: ['add dashboard filters']
    });

    const { config, configHash } = await loadOpenWeftConfig(repoRoot);

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

    expect(saved.checkpoint?.features['001']).toMatchObject({
      status: 'completed'
    });
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
      queueRequests: ['add dashboard filters']
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
      queueRequests: ['add dashboard filters']
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
});
