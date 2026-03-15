import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StartResult = {
  checkpoint: { status: string };
  mergedCount: number;
  plannedCount: number;
};

interface TtyHarness {
  handlers: ReturnType<typeof import('../../src/cli/handlers.js')['createCommandHandlers']>;
  getAppProps: () => Record<string, unknown> | null;
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

const createTtyHarness = async (input: {
  repoRoot: string;
  runRealOrchestration: (input: Record<string, unknown>) => Promise<StartResult>;
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

  const { createCommandHandlers } = await import('../../src/cli/handlers.js');

  return {
    handlers: createCommandHandlers({
      getCwd: () => input.repoRoot,
      writeLine: () => {},
      sleep: async () => {}
    }),
    getAppProps: () => appProps,
    unmount,
    waitUntilExit
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

    const harness = await createTtyHarness({
      repoRoot,
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
      plannedCount: 1
    });

    await startPromise;
    expect(harness.unmount).toHaveBeenCalledTimes(1);
    expect(harness.waitUntilExit).toHaveBeenCalledTimes(1);
  });

  it('requests graceful stop from the App quit callback before unmounting the UI', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-tui-quit-'));
    let resolveStart: ((result: StartResult) => void) | null = null;
    let capturedInput: Record<string, unknown> | null = null;

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

  it('requests graceful stop on SIGINT in TTY mode', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'openweft-cli-tui-signal-'));
    let resolveStart: ((result: StartResult) => void) | null = null;
    let capturedInput: Record<string, unknown> | null = null;
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
});
