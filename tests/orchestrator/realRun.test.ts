import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';

import { MockAgentAdapter } from '../../src/adapters/mock.js';
import type {
  AgentAdapter,
  AdapterCommandSpec,
  AdapterTurnRequest,
  AdapterTurnResult
} from '../../src/adapters/types.js';
import { loadOpenWeftConfig } from '../../src/config/index.js';
import type { NotificationDependencies } from '../../src/notifications/index.js';
import { ApprovalController } from '../../src/orchestrator/approval.js';
import { StopController } from '../../src/orchestrator/stop.js';
import { runRealOrchestration } from '../../src/orchestrator/realRun.js';

class RecordingAdapter implements AgentAdapter {
  readonly backend = 'mock' as const;

  readonly requests: AdapterTurnRequest[] = [];

  constructor(private readonly inner: AgentAdapter) {}

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
        backend: 'mock',
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
    expect(adjustmentRequest).toBeDefined();

    const featureTwo = result.checkpoint.features['002'];
    expect(featureTwo?.planFile).toBeDefined();
    const planContent = await readFile(featureTwo?.planFile ?? '', 'utf8');
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

  it('uses Claude default permission mode for planning stage 1 requests', async () => {
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
    expect(adapter.requests[0]?.claudePermissionMode).toBe('default');
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
});
