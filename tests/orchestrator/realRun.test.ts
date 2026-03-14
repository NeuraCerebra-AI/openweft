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

    const result = await runRealOrchestration({
      config,
      configHash,
      adapter,
      notificationDependencies: dependencies,
      writeLine: (message) => {
        progressLines.push(message);
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
});
