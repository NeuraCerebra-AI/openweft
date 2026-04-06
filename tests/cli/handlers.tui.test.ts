import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';

import { createConfigHash, loadOpenWeftConfig } from '../../src/config/index.js';
import { parseQueueFile } from '../../src/domain/queue.js';
import type { UIStore } from '../../src/ui/store.js';

type StartResult = {
  checkpoint: { status: string };
  mergedCount: number;
  plannedCount: number;
  finalizationSummary?: {
    finalHead: string | null;
    mergeDurability: {
      totalCompletedFeatures: number;
      verifiedCount: number;
      checks: readonly {
        featureId: string;
        mergeCommit: string | null;
        result: 'verified' | 'missing-merge-commit' | 'not-reachable';
      }[];
    };
    runtimeCleanup: {
      action: 'cleaned' | 'preserved' | 'nothing-to-clean' | 'cleanup-failed';
    };
  };
};

interface CapturedRuntimeInput {
  onEvent?: (event: Record<string, unknown>) => void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

interface TtyHarness {
  handlers: ReturnType<typeof import('../../src/cli/handlers.js')['createCommandHandlers']>;
  getAppProps: () => Record<string, unknown> | null;
  getStore: () => StoreApi<UIStore> | null;
  unmount: ReturnType<typeof vi.fn>;
  waitUntilExit: ReturnType<typeof vi.fn>;
}

const originalIsTTY = process.stdout.isTTY;

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error('Timed out waiting for test condition.');
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return {
    promise,
    resolve
  };
};

const createTtyHarness = async (input: {
  repoRoot: string;
  runRealOrchestration: (input: Record<string, unknown>) => Promise<StartResult>;
  sleep?: (ms: number) => Promise<void>;
  handlerOverrides?: {
    detectCodex?: () => Promise<{ installed: boolean; authenticated: boolean }>;
    detectClaude?: () => Promise<{ installed: boolean; authenticated: boolean }>;
    getEnv?: () => NodeJS.ProcessEnv;
  };
  mockFsIndex?: (
    actualFs: typeof import('../../src/fs/index.js')
  ) => Partial<typeof import('../../src/fs/index.js')>;
}): Promise<TtyHarness> => {
  vi.resetModules();

  const actualOrchestrator = await vi.importActual<typeof import('../../src/orchestrator/index.js')>(
    '../../src/orchestrator/index.js'
  );

  let appProps: Record<string, unknown> | null = null;
  const unmount = vi.fn();
  const waitUntilExit = vi.fn(async () => {});

  vi.doMock('../../src/orchestrator/index.js', () => ({
    ...actualOrchestrator,
    runRealOrchestration: input.runRealOrchestration,
  }));

  if (input.mockFsIndex) {
    const actualFs = await vi.importActual<typeof import('../../src/fs/index.js')>('../../src/fs/index.js');
    vi.doMock('../../src/fs/index.js', () => ({
      ...actualFs,
      ...input.mockFsIndex?.(actualFs)
    }));
  }

  vi.doMock('fullscreen-ink', () => ({
    withFullScreen: (node: { props: Record<string, unknown> }) => {
      appProps = node.props;
      return {
        start: async () => {},
        waitUntilExit,
        instance: {
          unmount
        }
      };
    }
  }));

  vi.doMock('../../src/ui/App.js', () => ({
    App: () => null
  }));

  vi.doMock('../../src/ui/styledOutput.js', () => ({
    renderStyledOutput: vi.fn(async () => {}),
    InfoCard: () => null,
    StatusCard: () => null,
    SuccessCard: () => null,
    WarningCard: () => null
  }));

  const { createCommandHandlers } = await import('../../src/cli/handlers.js');

  return {
    handlers: createCommandHandlers({
      getCwd: () => input.repoRoot,
      writeLine: () => {},
      sleep: input.sleep ?? (async () => {}),
      detectCodex: async () => ({ installed: true, authenticated: true }),
      detectClaude: async () => ({ installed: true, authenticated: true }),
      ...(input.handlerOverrides ?? {})
    }),
    getAppProps: () => appProps,
    getStore: () => (appProps?.store as StoreApi<UIStore> | undefined) ?? null,
    unmount,
    waitUntilExit
  };
};

const writeLaunchProjectFiles = async (
  repoRoot: string,
  options: {
    configOverrides?: Record<string, unknown>;
    queueContent: string;
    checkpointContent?: Record<string, unknown>;
  }
): Promise<void> => {
  await mkdir(path.join(repoRoot, 'feature_requests'), { recursive: true });
  await mkdir(path.join(repoRoot, 'prompts'), { recursive: true });
  await mkdir(path.join(repoRoot, '.openweft'), { recursive: true });

  await writeFile(
    path.join(repoRoot, '.openweftrc.json'),
    `${JSON.stringify(
      {
        backend: 'codex',
        concurrency: {
          maxParallelAgents: 1,
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
  await writeFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), options.queueContent, 'utf8');

  if (options.checkpointContent) {
    await writeFile(
      path.join(repoRoot, '.openweft', 'checkpoint.json'),
      `${JSON.stringify(options.checkpointContent, null, 2)}\n`,
      'utf8'
    );
  }
};

const createCheckpointFixture = (
  featureStatus: 'planned' | 'failed' | 'executing' = 'planned'
): Record<string, unknown> => {
  const now = '2026-03-16T12:00:00.000Z';
  return {
    schemaVersion: '1.0.0',
    orchestratorVersion: '0.1.0',
    configHash: 'fixture-config-hash',
    checkpointId: 'checkpoint-1',
    runId: 'run-1',
    createdAt: now,
    updatedAt: now,
    status: 'in-progress',
    currentState: 'executing',
    currentPhase: null,
    queue: {
      orderedFeatureIds: ['001'],
      totalCount: 1
    },
    features: {
      '001': {
        id: '001',
        title: 'Resume checkpoint work',
        request: 'Resume checkpoint work',
        status: featureStatus,
        attempts: 0,
        planFile: null,
        branchName: null,
        worktreePath: null,
        sessionId: null,
        sessionScope: null,
        backend: 'mock',
        manifest: null,
        priorityScore: null,
        priorityTier: null,
        scoringCycles: 0,
        lastError: null,
        updatedAt: now
      }
    },
    pendingRequests: [],
    cost: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalEstimatedUsd: 0,
      perFeature: {}
    }
  };
};

describe('TTY start handler', () => {
  beforeEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true
    });
  });

  it('routes App approval decisions into the orchestrator approval controller', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-tui-approval-'));
    let resolveStart: ((result: StartResult) => void) | null = null;
    let capturedInput: Record<string, unknown> | null = null;
    const releaseCompletionScreen = createDeferred<void>();

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: ''
    });

    const harness = await createTtyHarness({
      repoRoot,
      sleep: async () => {
        await releaseCompletionScreen.promise;
      },
      runRealOrchestration: async (input) => {
        capturedInput = input;
        const decision = await (input.approvalController as {
          requestApproval: (input: {
            agentId: string;
            request: { file: string; action: string; detail: string };
          }) => Promise<string>;
        }).requestApproval({
          agentId: '001',
          request: { file: 'src/index.ts', action: 'write', detail: 'Add auth import' }
        });

        expect(decision).toBe('approve');

        return await new Promise<StartResult>((resolve) => {
          resolveStart = resolve;
        });
      }
    });

    const startPromise = harness.handlers.start({});
    await waitFor(
      () =>
        harness.getAppProps() !== null &&
        capturedInput !== null &&
        (capturedInput.approvalController as { hasPendingApproval: () => boolean }).hasPendingApproval()
    );
    if (!capturedInput) {
      throw new Error('Expected orchestrator input to be captured.');
    }
    const runtimeInput = capturedInput as {
      writeLine?: unknown;
      notificationDependencies?: { writeStderr: (message: string) => void };
      approvalController: { hasPendingApproval: () => boolean }
    };
    expect(runtimeInput.writeLine).toBeUndefined();
    expect(runtimeInput.notificationDependencies).toBeDefined();

    const props = harness.getAppProps();
    expect(props).not.toBeNull();
    if (!props) {
      throw new Error('Expected App props to be captured.');
    }
    (props.onApprovalDecision as (decision: string) => void)('approve');
    await waitFor(() => resolveStart !== null);
    if (!resolveStart) {
      throw new Error('Expected orchestration resolver to be set.');
    }
    const finishRun: (result: StartResult) => void = resolveStart;

    finishRun({
      checkpoint: { status: 'completed' },
      mergedCount: 1,
      plannedCount: 1,
      finalizationSummary: {
        finalHead: 'abc123',
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
        runtimeCleanup: {
          action: 'cleaned'
        }
      }
    });

    const store = harness.getStore();
    if (!store) {
      throw new Error('Expected store to be captured.');
    }

    await waitFor(() => store.getState().completion !== null);
    expect(store.getState().completion).toEqual({
      status: 'completed',
      mergedCount: 1,
      plannedCount: 1,
      finalHead: 'abc123',
      durabilitySummary: 'verified (1/1 completed features)',
      cleanupSummary: 'codex-home cleaned'
    });
    expect(harness.unmount).not.toHaveBeenCalled();

    releaseCompletionScreen.resolve();

    await startPromise;
    expect(harness.unmount).toHaveBeenCalledTimes(1);
    expect(harness.waitUntilExit).toHaveBeenCalledTimes(1);
  });

  it('requests graceful stop from the App quit callback before unmounting the UI', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-tui-quit-'));
    let resolveStart: ((result: StartResult) => void) | null = null;
    let capturedInput: Record<string, unknown> | null = null;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: ''
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async (input) => {
        capturedInput = input;
        return await new Promise<StartResult>((resolve) => {
          resolveStart = resolve;
        });
      }
    });

    const startPromise = harness.handlers.start({});
    await waitFor(() => harness.getAppProps() !== null && capturedInput !== null);

    const props = harness.getAppProps();
    expect(props).not.toBeNull();
    if (!props || !capturedInput) {
      throw new Error('Expected App props and orchestrator input to be captured.');
    }
    const runtimeInput = capturedInput as { stopController: { isRequested: boolean } };
    (props.onQuitRequest as () => void)();

    expect(runtimeInput.stopController.isRequested).toBe(true);
    expect(harness.unmount).not.toHaveBeenCalled();
    if (!resolveStart) {
      throw new Error('Expected orchestration resolver to be set.');
    }
    const finishRun: (result: StartResult) => void = resolveStart;

    finishRun({
      checkpoint: { status: 'stopped' },
      mergedCount: 0,
      plannedCount: 1
    });

    await startPromise;
    expect(harness.unmount).toHaveBeenCalledTimes(1);
    expect(harness.waitUntilExit).toHaveBeenCalledTimes(1);
  });

  it('allows adding queued work during execution in direct start TTY mode', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-tui-inline-add-'));
    let resolveStart: ((result: StartResult) => void) | null = null;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: ''
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => await new Promise<StartResult>((resolve) => {
        resolveStart = resolve;
      })
    });

    const startPromise = harness.handlers.start({});
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    expect(store.getState().executionRequested).toBe(true);

    (props.onAddRequest as (request: string) => void)('follow-up work');
    await waitFor(() => store.getState().agents.some((agent) => agent.id === 'queued-live-1'));

    const directStartQueueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    expect(directStartQueueContent).toContain('# openweft queue format: v1');
    expect(parseQueueFile(directStartQueueContent).pending.map((entry) => entry.request)).toEqual([
      'follow-up work'
    ]);
    expect(store.getState().agents.find((agent) => agent.id === 'queued-live-1')).toMatchObject({
      name: 'follow-up work',
      status: 'queued',
      removable: false
    });

    if (!resolveStart) {
      throw new Error('Expected orchestration resolver to be set.');
    }
    const finishRun: (result: StartResult) => void = resolveStart;
    finishRun({
      checkpoint: { status: 'completed' },
      mergedCount: 0,
      plannedCount: 1
    });

    await startPromise;
  });

  it('preloads pending queue items into the direct start dashboard in queue order', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-tui-direct-start-queue-'));
    let resolveStart: ((result: StartResult) => void) | null = null;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'alpha\nbeta\ngamma\n'
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => await new Promise<StartResult>((resolve) => {
        resolveStart = resolve;
      })
    });

    const startPromise = harness.handlers.start({});
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const store = harness.getStore();
    if (!store) {
      throw new Error('Expected App store to be captured.');
    }

    expect(store.getState().executionRequested).toBe(true);
    expect(store.getState().agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      removable: agent.removable
    }))).toEqual([
      {
        id: 'queued-start-1',
        name: 'alpha',
        status: 'queued',
        removable: false
      },
      {
        id: 'queued-start-2',
        name: 'beta',
        status: 'queued',
        removable: false
      },
      {
        id: 'queued-start-3',
        name: 'gamma',
        status: 'queued',
        removable: false
      }
    ]);

    if (!resolveStart) {
      throw new Error('Expected orchestration resolver to be set.');
    }
    const finishRun: (result: StartResult) => void = resolveStart;
    finishRun({
      checkpoint: { status: 'completed' },
      mergedCount: 0,
      plannedCount: 3
    });

    await startPromise;
  });

  it('does not expose pre-start model editing in direct start TTY mode', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-tui-direct-start-no-model-edit-'));
    let resolveStart: ((result: StartResult) => void) | null = null;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: ''
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => await new Promise<StartResult>((resolve) => {
        resolveStart = resolve;
      })
    });

    const startPromise = harness.handlers.start({});
    await waitFor(() => harness.getAppProps() !== null);

    const props = harness.getAppProps();
    if (!props) {
      throw new Error('Expected App props to be captured.');
    }

    expect(props.onSaveModelSelection).toBeUndefined();

    if (!resolveStart) {
      throw new Error('Expected orchestration resolver to be set.');
    }
    const finishRun: (result: StartResult) => void = resolveStart;
    finishRun({
      checkpoint: { status: 'completed' },
      mergedCount: 0,
      plannedCount: 0
    });

    await startPromise;
  });

  it('seeds the direct start dashboard with the active backend, model, and effort', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-tui-direct-start-model-'));
    let resolveStart: ((result: StartResult) => void) | null = null;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: '',
      configOverrides: {
        backend: 'claude',
        models: {
          claude: 'claude-haiku-4-5'
        },
        effort: {
          claude: 'max'
        }
      }
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => await new Promise<StartResult>((resolve) => {
        resolveStart = resolve;
      })
    });

    const startPromise = harness.handlers.start({});
    await waitFor(() => harness.getStore() !== null);

    const store = harness.getStore();
    if (!store) {
      throw new Error('Expected App store to be captured.');
    }

    expect(store.getState().modelSelection).toEqual({
      backend: 'claude',
      model: 'claude-haiku-4-5',
      effort: 'max',
      editable: true
    });
    expect(store.getState().executionRequested).toBe(true);

    if (!resolveStart) {
      throw new Error('Expected orchestration resolver to be set.');
    }
    const finishRun: (result: StartResult) => void = resolveStart;
    finishRun({
      checkpoint: { status: 'completed' },
      mergedCount: 0,
      plannedCount: 0
    });

    await startPromise;
  });

  it('requests graceful stop on SIGINT in TTY mode', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-tui-signal-'));
    let resolveStart: ((result: StartResult) => void) | null = null;
    let capturedInput: Record<string, unknown> | null = null;
    await writeLaunchProjectFiles(repoRoot, {
      queueContent: ''
    });
    const signalHandlers = new Map<string, () => void>();
    const onSpy = vi.spyOn(process, 'on').mockImplementation(((event: NodeJS.Signals, listener: NodeJS.SignalsListener) => {
      if ((event === 'SIGINT' || event === 'SIGTERM') && typeof listener === 'function') {
        signalHandlers.set(event, listener as () => void);
      }
      return process;
    }) as typeof process.on);
    const offSpy = vi.spyOn(process, 'off').mockImplementation(((event: NodeJS.Signals) => {
      signalHandlers.delete(String(event));
      return process;
    }) as typeof process.off);

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async (input) => {
        capturedInput = input;
        return await new Promise<StartResult>((resolve) => {
          resolveStart = resolve;
        });
      }
    });

    const startPromise = harness.handlers.start({});
    await waitFor(() => capturedInput !== null);
    if (!capturedInput) {
      throw new Error('Expected orchestrator input to be captured.');
    }
    const runtimeInput = capturedInput as { stopController: { isRequested: boolean } };

    const sigintHandler = signalHandlers.get('SIGINT');
    expect(sigintHandler).toBeDefined();
    sigintHandler?.();

    expect(runtimeInput.stopController.isRequested).toBe(true);
    if (!resolveStart) {
      throw new Error('Expected orchestration resolver to be set.');
    }
    const finishRun: (result: StartResult) => void = resolveStart;

    finishRun({
      checkpoint: { status: 'stopped' },
      mergedCount: 0,
      plannedCount: 1
    });

    await startPromise;
    expect(harness.unmount).toHaveBeenCalledTimes(1);
    expect(harness.waitUntilExit).toHaveBeenCalledTimes(1);
    expect(onSpy).toHaveBeenCalled();
    expect(offSpy).toHaveBeenCalled();
  });

  it('removes only the selected duplicate queued row in gated launch mode', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-duplicates-'));
    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'alpha\nduplicate\nbravo\nduplicate\ncharlie\n'
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => ({
        checkpoint: { status: 'completed' },
        mergedCount: 0,
        plannedCount: 0
      })
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    (props.onRemoveAgent as (agentId: string) => void)('queued-4');
    await waitFor(() => !store.getState().agents.some((agent) => agent.id === 'queued-4'));

    const queueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    expect(queueContent).toContain('# openweft queue format: v1');
    expect(parseQueueFile(queueContent).pending.map((entry) => entry.request)).toEqual([
      'alpha',
      'duplicate',
      'bravo',
      'charlie'
    ]);
    expect(store.getState().agents.map((agent) => agent.id)).toEqual(['queued-1', 'queued-2', 'queued-3', 'queued-5']);

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });

  it('ignores duplicate inline adds when the request is already pending', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-duplicate-sequence-'));
    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'alpha\nduplicate\nbravo\nduplicate\ncharlie\n'
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => ({
        checkpoint: { status: 'completed' },
        mergedCount: 0,
        plannedCount: 0
      })
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    (props.onRemoveAgent as (agentId: string) => void)('queued-4');
    await waitFor(() => !store.getState().agents.some((agent) => agent.id === 'queued-4'));

    const agentIdsBeforeDuplicateAdd = store.getState().agents.map((agent) => agent.id);
    (props.onAddRequest as (request: string) => void)('duplicate');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const queueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    expect(queueContent).toContain('# openweft queue format: v1');
    expect(parseQueueFile(queueContent).pending.map((entry) => entry.request)).toEqual([
      'alpha',
      'duplicate',
      'bravo',
      'charlie'
    ]);
    expect(store.getState().agents.map((agent) => agent.id)).toEqual(agentIdsBeforeDuplicateAdd);

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });

  it('trims leading and trailing whitespace from inline add requests', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-trim-'));
    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'existing\n'
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => ({
        checkpoint: { status: 'completed' },
        mergedCount: 0,
        plannedCount: 0
      })
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    (props.onAddRequest as (request: string) => void)('  fix the bug  ');
    await waitFor(() => store.getState().agents.some((agent) => agent.name === 'fix the bug'));

    const queueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    expect(queueContent).toContain('# openweft queue format: v1');
    expect(parseQueueFile(queueContent).pending.map((entry) => entry.request)).toEqual([
      'existing',
      'fix the bug'
    ]);

    const added = store.getState().agents.find((agent) => agent.name === 'fix the bug');
    expect(added).toBeDefined();
    expect(added!.feature).toBe('fix the bug');

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });

  it('keeps a multiline inline add as one queued request in direct start TTY mode', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-multiline-add-'));
    let resolveStart: ((result: StartResult) => void) | null = null;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: ''
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => await new Promise<StartResult>((resolve) => {
        resolveStart = resolve;
      })
    });

    const startPromise = harness.handlers.start({});
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    const request = 'follow-up work\ninclude retries\nand validation';
    (props.onAddRequest as (request: string) => void)(request);
    await waitFor(() => store.getState().agents.some((agent) => agent.id === 'queued-live-1'));

    const queueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    const parsedQueue = parseQueueFile(queueContent);

    expect(parsedQueue.pending).toHaveLength(1);
    expect(parsedQueue.pending[0]?.request).toBe(request);
    expect(store.getState().agents.find((agent) => agent.id === 'queued-live-1')).toMatchObject({
      status: 'queued',
      removable: false
    });

    if (!resolveStart) {
      throw new Error('Expected orchestration resolver to be set.');
    }
    const finishRun: (result: StartResult) => void = resolveStart;
    finishRun({
      checkpoint: { status: 'completed' },
      mergedCount: 0,
      plannedCount: 1
    });

    await startPromise;
  });

  it('ignores whitespace-only inline add requests', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-empty-add-'));
    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'existing\n'
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => ({
        checkpoint: { status: 'completed' },
        mergedCount: 0,
        plannedCount: 0
      })
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    const agentCountBefore = store.getState().agents.length;
    (props.onAddRequest as (request: string) => void)('   ');
    // Give any async mutation time to settle
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.getState().agents.length).toBe(agentCountBefore);

    const queueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    expect(queueContent).toBe('existing\n');

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });

  it('keeps the ready-state row visible and shows an error notice when queue removal fails', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-remove-fail-'));
    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'alpha\nbeta\n'
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => ({
        checkpoint: { status: 'completed' },
        mergedCount: 0,
        plannedCount: 0
      }),
      mockFsIndex: (actualFs) => ({
        writeTextFileAtomic: vi.fn(async (filePath: string, content: string) => {
          if (
            filePath === path.join(repoRoot, 'feature_requests', 'queue.txt') &&
            parseQueueFile(content).pending.map((entry) => entry.request).join('\n') === 'beta'
          ) {
            throw new Error('disk full');
          }
          return actualFs.writeTextFileAtomic(filePath, content);
        })
      })
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    (props.onRemoveAgent as (agentId: string) => void)('queued-1');
    await waitFor(() => store.getState().notice !== null);

    expect(store.getState().agents.map((agent) => agent.id)).toEqual(['queued-1', 'queued-2']);
    expect(store.getState().notice).toEqual({ level: 'error', message: 'Failed to write to queue file' });
    const queueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    expect(parseQueueFile(queueContent).pending.map((entry) => entry.request)).toEqual(['alpha', 'beta']);

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });

  it('keeps resumable checkpoint rows visible when gated launch transitions into execution', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-checkpoint-'));
    let capturedOnEvent: ((event: Record<string, unknown>) => void) | null = null;
    let resolveRun: ((result: StartResult) => void) | null = null;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'new queued work\n',
      checkpointContent: createCheckpointFixture()
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async (input) => {
        capturedOnEvent = (input as CapturedRuntimeInput).onEvent ?? null;
        return await new Promise<StartResult>((resolve) => {
          resolveRun = resolve;
        });
      },
      handlerOverrides: {
        detectCodex: async () => ({ installed: true, authenticated: true }),
        detectClaude: async () => ({ installed: true, authenticated: true })
      }
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    expect(store.getState().agents.map((agent) => agent.id)).toEqual(['001', 'queued-1']);

    (props.onStartRequest as () => void)();
    await waitFor(() => capturedOnEvent !== null);

    expect(store.getState().executionRequested).toBe(true);
    expect(store.getState().agents.map((agent) => agent.id)).toEqual(['001', 'queued-1']);

    if (!capturedOnEvent) {
      throw new Error('Expected onEvent to be captured.');
    }
    const emitEvent: (event: Record<string, unknown>) => void = capturedOnEvent;
    emitEvent({
      type: 'agent:started',
      agentId: '001',
      name: '001 Resume checkpoint work',
      feature: 'Resume checkpoint work',
      stage: 'execution'
    });

    await waitFor(() => store.getState().agents[0]?.status === 'running');
    expect(store.getState().agents.map((agent) => agent.id)).toEqual(['001', 'queued-1']);

    if (!resolveRun) {
      throw new Error('Expected orchestration resolver to be set.');
    }
    const finishRun: (result: StartResult) => void = resolveRun;
    finishRun({
      checkpoint: { status: 'completed' },
      mergedCount: 1,
      plannedCount: 1
    });

    await launchPromise;
  });

  it('keeps queued placeholder rows visible until planning starts', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-queue-placeholder-'));
    let capturedOnEvent: ((event: Record<string, unknown>) => void) | null = null;
    let resolveRun: ((result: StartResult) => void) | null = null;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'alpha\n'
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async (input) => {
        capturedOnEvent = (input as CapturedRuntimeInput).onEvent ?? null;
        return await new Promise<StartResult>((resolve) => {
          resolveRun = resolve;
        });
      },
      handlerOverrides: {
        detectCodex: async () => ({ installed: true, authenticated: true }),
        detectClaude: async () => ({ installed: true, authenticated: true })
      }
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    expect(store.getState().agents.map((agent) => agent.id)).toEqual(['queued-1']);

    (props.onStartRequest as () => void)();
    await waitFor(() => capturedOnEvent !== null);

    expect(store.getState().executionRequested).toBe(true);
    expect(store.getState().agents).toHaveLength(1);
    expect(store.getState().agents[0]).toMatchObject({
      id: 'queued-1',
      status: 'queued',
      removable: true
    });

    if (!capturedOnEvent) {
      throw new Error('Expected onEvent to be captured.');
    }

    const emitEvent: (event: Record<string, unknown>) => void = capturedOnEvent;
    emitEvent({
      type: 'agent:started',
      agentId: '001',
      name: '001 Alpha',
      feature: 'Alpha',
      stage: 'planning-s1'
    });

    await waitFor(() => store.getState().agents[0]?.id === '001');
    expect(store.getState().agents[0]).toMatchObject({
      id: '001',
      name: '001 Alpha',
      feature: 'alpha',
      status: 'running',
      removable: false
    });

    if (!resolveRun) {
      throw new Error('Expected orchestration resolver to be set.');
    }

    const finishRun: (result: StartResult) => void = resolveRun;
    finishRun({
      checkpoint: { status: 'completed' },
      mergedCount: 1,
      plannedCount: 1
    });

    await launchPromise;
  });

  it('shows a demo-mode start notice when execution is requested from the ready dashboard', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-demo-notice-'));
    let resolveRun: ((result: StartResult) => void) | null = null;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'alpha\n',
      configOverrides: {
        backend: 'claude'
      }
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => {
        return await new Promise<StartResult>((resolve) => {
          resolveRun = resolve;
        });
      },
      handlerOverrides: {
        getEnv: () => ({
          ...process.env,
          OPENWEFT_DEMO_MODE: '1'
        }),
        detectCodex: async () => ({
          installed: false,
          authenticated: false
        }),
        detectClaude: async () => ({
          installed: true,
          authenticated: true
        })
      }
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    (props.onStartRequest as () => void)();
    await waitFor(() => store.getState().executionRequested);

    expect(store.getState().notice).toEqual({
      level: 'info',
      message: 'Starting orchestration…'
    });

    if (!resolveRun) {
      throw new Error('Expected orchestration resolver to be set.');
    }

    const finishRun: (result: StartResult) => void = resolveRun;
    finishRun({
      checkpoint: { status: 'completed' },
      mergedCount: 1,
      plannedCount: 1
    });

    await launchPromise;
  });

  it('opens the ready-state TUI for failed-only checkpoint work', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-failed-checkpoint-'));

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: '',
      checkpointContent: createCheckpointFixture('failed')
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => ({
        checkpoint: { status: 'completed' },
        mergedCount: 0,
        plannedCount: 0
      })
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    expect(store.getState().agents.map((agent) => agent.id)).toEqual(['001']);
    expect(store.getState().agents[0]?.removable).toBe(false);

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });

  it('drains queue removal before starting orchestration from the ready state', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-drain-before-start-'));
    const queueFilePath = path.join(repoRoot, 'feature_requests', 'queue.txt');
    const releaseRemovalWrite = createDeferred<void>();
    let queueContentAtStart: string | null = null;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'alpha\nbeta\n'
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => {
        queueContentAtStart = await readFile(queueFilePath, 'utf8');
        return {
          checkpoint: { status: 'completed' },
          mergedCount: 0,
          plannedCount: 0
        };
      },
      mockFsIndex: (actualFs) => ({
        writeTextFileAtomic: vi.fn(async (filePath: string, content: string) => {
          if (
            filePath === queueFilePath &&
            parseQueueFile(content).pending.map((entry) => entry.request).join('\n') === 'beta'
          ) {
            await releaseRemovalWrite.promise;
          }
          return actualFs.writeTextFileAtomic(filePath, content);
        })
      }),
      handlerOverrides: {
        detectCodex: async () => ({ installed: true, authenticated: true }),
        detectClaude: async () => ({ installed: true, authenticated: true })
      }
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    if (!props) {
      throw new Error('Expected App props to be captured.');
    }

    (props.onRemoveAgent as (agentId: string) => void)('queued-1');
    (props.onStartRequest as () => void)();

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });

    expect(queueContentAtStart).toBeNull();

    releaseRemovalWrite.resolve();

    await waitFor(() => queueContentAtStart !== null);
    expect(queueContentAtStart).toContain('# openweft queue format: v1');
    expect(parseQueueFile(queueContentAtStart ?? '').pending.map((entry) => entry.request)).toEqual(['beta']);

    await launchPromise;
  });

  it('keeps the ready-state dashboard open and shows an error when the configured backend is not ready', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-backend-preflight-'));
    let runCount = 0;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'alpha\n'
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => {
        runCount += 1;
        return {
          checkpoint: { status: 'completed' },
          mergedCount: 0,
          plannedCount: 0
        };
      },
      handlerOverrides: {
        detectCodex: async () => ({
          installed: false,
          authenticated: false
        }),
        detectClaude: async () => ({
          installed: true,
          authenticated: true
        })
      }
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    (props.onStartRequest as () => void)();
    await waitFor(() => store.getState().notice !== null);

    expect(runCount).toBe(0);
    expect(store.getState().executionRequested).toBe(false);
    expect(store.getState().notice?.level).toBe('error');
    expect(store.getState().notice?.message).toMatch(/backend "codex".*not installed/i);

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });

  it('keeps the dashboard idle when start is requested with no actionable work left', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-empty-start-'));
    let runCount = 0;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'alpha\n'
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => {
        runCount += 1;
        return {
          checkpoint: { status: 'completed' },
          mergedCount: 0,
          plannedCount: 0
        };
      }
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    (props.onRemoveAgent as (agentId: string) => void)('queued-1');
    await waitFor(() => store.getState().agents.length === 0);

    (props.onStartRequest as () => void)();
    await waitFor(() => store.getState().notice !== null || runCount > 0);

    expect(runCount).toBe(0);
    expect(store.getState().executionRequested).toBe(false);
    expect(store.getState().notice).toEqual({
      level: 'info',
      message: 'No queued or resumable work to start.'
    });

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });

  it('opens the ready-state dashboard even when there is no queued or resumable work yet', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-empty-dashboard-'));

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: ''
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => ({
        checkpoint: { status: 'completed' },
        mergedCount: 0,
        plannedCount: 0
      })
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    expect(store.getState().agents).toEqual([]);
    expect(store.getState().executionRequested).toBe(false);

    (props.onAddRequest as (request: string) => void)('new work item');
    await waitFor(() => store.getState().agents.some((agent) => agent.name === 'new work item'));

    const queueContent = await readFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), 'utf8');
    expect(parseQueueFile(queueContent).pending.map((entry) => entry.request)).toEqual(['new work item']);

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });

  it('seeds the gated ready-state dashboard with the active backend, model, and effort', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-model-'));

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: '',
      configOverrides: {
        backend: 'claude',
        models: {
          claude: 'claude-opus-4-6'
        },
        effort: {
          claude: 'high'
        }
      }
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => ({
        checkpoint: { status: 'completed' },
        mergedCount: 0,
        plannedCount: 0
      })
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getStore() !== null);

    const store = harness.getStore();
    if (!store) {
      throw new Error('Expected App store to be captured.');
    }

    expect(store.getState().modelSelection).toEqual({
      backend: 'claude',
      model: 'claude-opus-4-6',
      effort: 'high',
      editable: true
    });
    expect(store.getState().executionRequested).toBe(false);

    const props = harness.getAppProps();
    if (!props) {
      throw new Error('Expected App props to be captured.');
    }

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });

  it('marks package.json-backed config as non-editable in the ready-state dashboard', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-package-json-model-'));

    await mkdir(path.join(repoRoot, 'feature_requests'), { recursive: true });
    await mkdir(path.join(repoRoot, 'prompts'), { recursive: true });
    await mkdir(path.join(repoRoot, '.openweft'), { recursive: true });

    await writeFile(
      path.join(repoRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'openweft-fixture',
          private: true,
          openweft: {
            backend: 'claude',
            models: {
              claude: 'claude-sonnet-4-5'
            },
            effort: {
              claude: 'high'
            }
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
    await writeFile(path.join(repoRoot, 'feature_requests', 'queue.txt'), '', 'utf8');

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => ({
        checkpoint: { status: 'completed' },
        mergedCount: 0,
        plannedCount: 0
      })
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getStore() !== null);

    const store = harness.getStore();
    if (!store) {
      throw new Error('Expected App store to be captured.');
    }

    expect(store.getState().modelSelection).toEqual({
      backend: 'claude',
      model: 'claude-sonnet-4-5',
      effort: 'high',
      editable: false
    });

    const props = harness.getAppProps();
    if (!props) {
      throw new Error('Expected App props to be captured.');
    }

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });

  it('persists pre-start model changes and starts with refreshed config and hash', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-model-save-'));
    let capturedInput: Record<string, unknown> | null = null;

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'alpha\n'
    });

    const beforeSave = await loadOpenWeftConfig(repoRoot);

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async (input) => {
        capturedInput = input;
        return {
          checkpoint: { status: 'completed' },
          mergedCount: 0,
          plannedCount: 1
        };
      },
      handlerOverrides: {
        detectCodex: async () => ({ installed: true, authenticated: true }),
        detectClaude: async () => ({ installed: true, authenticated: true })
      }
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    expect(typeof props.onSaveModelSelection).toBe('function');

    await (props.onSaveModelSelection as (selection: { model: string; effort: 'high' }) => Promise<void>)({
      model: 'gpt-5.4',
      effort: 'high'
    });

    await waitFor(() =>
      store.getState().modelSelection?.model === 'gpt-5.4' &&
      store.getState().modelSelection?.effort === 'high'
    );

    const configText = await readFile(path.join(repoRoot, '.openweftrc.json'), 'utf8');
    expect(configText).toContain('"codex": "gpt-5.4"');
    expect(configText).toContain('"codex": "high"');

    (props.onStartRequest as () => void)();
    await waitFor(() => capturedInput !== null);

    const runtimeInput = capturedInput as unknown as {
      config: Awaited<ReturnType<typeof loadOpenWeftConfig>>['config'];
      configHash: string;
    };

    expect(runtimeInput.config.models.codex).toBe('gpt-5.4');
    expect(runtimeInput.config.effort.codex).toBe('high');
    expect(runtimeInput.configHash).not.toBe(beforeSave.configHash);
    expect(runtimeInput.configHash).toBe(createConfigHash(runtimeInput.config));

    await launchPromise;
  });

  it('serializes overlapping remove and add mutations so both changes persist', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-launch-serialized-mutations-'));
    const queueFilePath = path.join(repoRoot, 'feature_requests', 'queue.txt');
    const releaseRemovalWrite = createDeferred<void>();

    await writeLaunchProjectFiles(repoRoot, {
      queueContent: 'alpha\nduplicate\nbravo\nduplicate\n'
    });

    const harness = await createTtyHarness({
      repoRoot,
      runRealOrchestration: async () => ({
        checkpoint: { status: 'completed' },
        mergedCount: 0,
        plannedCount: 0
      }),
      mockFsIndex: (actualFs) => ({
        writeTextFileAtomic: vi.fn(async (filePath: string, content: string) => {
          if (
            filePath === queueFilePath &&
            parseQueueFile(content).pending.map((entry) => entry.request).join('\n') === 'alpha\nbravo\nduplicate'
          ) {
            await releaseRemovalWrite.promise;
          }
          return actualFs.writeTextFileAtomic(filePath, content);
        })
      })
    });

    const launchPromise = harness.handlers.launch();
    await waitFor(() => harness.getAppProps() !== null && harness.getStore() !== null);

    const props = harness.getAppProps();
    const store = harness.getStore();
    if (!props || !store) {
      throw new Error('Expected App props and store to be captured.');
    }

    (props.onRemoveAgent as (agentId: string) => void)('queued-2');
    (props.onAddRequest as (request: string) => void)('charlie');

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });

    releaseRemovalWrite.resolve();

    await waitFor(() => store.getState().agents.some((agent) => agent.name === 'charlie'));

    const queueContent = await readFile(queueFilePath, 'utf8');
    expect(queueContent).toContain('# openweft queue format: v1');
    expect(parseQueueFile(queueContent).pending.map((entry) => entry.request)).toEqual([
      'alpha',
      'bravo',
      'duplicate',
      'charlie'
    ]);

    (props.onQuitRequest as () => void)();
    await launchPromise;
  });
});
