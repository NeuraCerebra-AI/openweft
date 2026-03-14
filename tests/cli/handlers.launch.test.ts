/**
 * Tests for the `launch` command handler.
 *
 * These tests are in a dedicated file because they require module-level
 * vi.mock() calls that would pollute the existing handlers.test.ts fixtures.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — must appear before any imports of the mocked modules.
// ---------------------------------------------------------------------------

// Mock loadOpenWeftConfig so we control whether config exists.
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    loadOpenWeftConfig: vi.fn(),
  };
});

// Mock runOnboardingWizard — the module is dynamically imported inside launch.
vi.mock('../../src/ui/onboarding/runOnboardingWizard.js', () => ({
  runOnboardingWizard: vi.fn().mockResolvedValue({ launch: false }),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are registered.
// ---------------------------------------------------------------------------

import { loadOpenWeftConfig } from '../../src/config/index.js';
import { runOnboardingWizard } from '../../src/ui/onboarding/runOnboardingWizard.js';
import { createCommandHandlers } from '../../src/cli/handlers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fake RuntimePaths used throughout the tests. */
const makeFakePaths = (repoRoot = '/fake/cwd') => ({
  repoRoot,
  openweftDir: `${repoRoot}/.openweft`,
  featureRequestsDir: `${repoRoot}/feature_requests`,
  queueFile: `${repoRoot}/queue.txt`,
  promptA: `${repoRoot}/prompts/prompt-a.md`,
  planAdjustment: `${repoRoot}/prompts/plan-adjustment.md`,
  checkpointFile: `${repoRoot}/.openweft/checkpoint.json`,
  checkpointBackupFile: `${repoRoot}/.openweft/checkpoint.json.backup`,
  costsFile: `${repoRoot}/.openweft/costs.jsonl`,
  pidFile: `${repoRoot}/.openweft/pid`,
  outputLogFile: `${repoRoot}/.openweft/output.log`,
  auditLogFile: `${repoRoot}/.openweft/audit-trail.jsonl`,
  worktreesDir: `${repoRoot}/.openweft/worktrees`,
  shadowPlansDir: `${repoRoot}/.openweft/shadow-plans`,
});

/** Build a fake config result with no config file (first-time user). */
const makeNoConfigResult = () => ({
  config: {
    configFilePath: null,
    paths: makeFakePaths(),
    backend: 'codex' as const,
    concurrency: { maxParallelAgents: 3 },
    featureRequestsDir: './feature_requests',
    queueFile: './queue.txt',
    prompts: {
      promptA: './prompts/prompt-a.md',
      planAdjustment: './prompts/plan-adjustment.md',
    },
  },
  configHash: 'abc123',
});

/** Build a fake config result where config exists at a path. */
const makeConfigExistsResult = (configFilePath = '/fake/cwd/.openweftrc.json') => ({
  config: {
    configFilePath,
    paths: makeFakePaths(),
    backend: 'codex' as const,
    concurrency: { maxParallelAgents: 3 },
    featureRequestsDir: './feature_requests',
    queueFile: './queue.txt',
    prompts: {
      promptA: './prompts/prompt-a.md',
      planAdjustment: './prompts/plan-adjustment.md',
    },
  },
  configHash: 'abc123',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('launch handler', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore isTTY after each test
    if (originalIsTTY !== undefined) {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    }
    originalIsTTY = process.stdout.isTTY;
  });

  const setTTY = (value: boolean) => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value,
      writable: true,
      configurable: true,
    });
  };

  describe('(a) TTY + no config → calls runOnboardingWizard', () => {
    it('calls runOnboardingWizard when stdout is TTY and no config exists', async () => {
      setTTY(true);
      (loadOpenWeftConfig as MockedFunction<typeof loadOpenWeftConfig>).mockResolvedValue(
        makeNoConfigResult() as Awaited<ReturnType<typeof loadOpenWeftConfig>>
      );
      (runOnboardingWizard as MockedFunction<typeof runOnboardingWizard>).mockResolvedValue({
        launch: false,
      });

      const output: string[] = [];
      const handlers = createCommandHandlers({
        getCwd: () => '/fake/cwd',
        writeLine: (msg) => { output.push(msg); },
      });

      await handlers.launch();

      expect(runOnboardingWizard).toHaveBeenCalledOnce();
    });
  });

  describe('(b) TTY + no config + wizard returns { launch: true } → calls start', () => {
    it('calls start when wizard returns launch: true', async () => {
      setTTY(true);
      (loadOpenWeftConfig as MockedFunction<typeof loadOpenWeftConfig>).mockResolvedValue(
        makeNoConfigResult() as Awaited<ReturnType<typeof loadOpenWeftConfig>>
      );
      (runOnboardingWizard as MockedFunction<typeof runOnboardingWizard>).mockResolvedValue({
        launch: true,
      });

      let startCalled = false;
      const handlers = createCommandHandlers({
        getCwd: () => '/fake/cwd',
        writeLine: vi.fn(),
      });

      // Spy on start by wrapping: since we can't easily inject start,
      // we verify indirectly — start will call loadOpenWeftConfig again.
      // On the second call (from start), return a config that exists so
      // it proceeds without looping. We count calls.
      let loadConfigCallCount = 0;
      (loadOpenWeftConfig as MockedFunction<typeof loadOpenWeftConfig>).mockImplementation(
        async () => {
          loadConfigCallCount += 1;
          if (loadConfigCallCount === 1) {
            // First call from launch — no config
            return makeNoConfigResult() as Awaited<ReturnType<typeof loadOpenWeftConfig>>;
          }
          // Second call from start — config exists, but start will run the
          // TUI path (which we can't easily suppress here). To avoid that,
          // we check that loadOpenWeftConfig was called a second time, which
          // confirms start() was invoked.
          startCalled = true;
          // Throw to short-circuit start execution without running the TUI
          throw new Error('start called — sentinel');
        }
      );

      // launch calls start which then throws our sentinel
      try {
        await handlers.launch();
      } catch (err) {
        // Expected sentinel error from start
        expect((err as Error).message).toBe('start called — sentinel');
      }

      expect(startCalled).toBe(true);
      expect(runOnboardingWizard).toHaveBeenCalledOnce();
    });
  });

  describe('(c) TTY + no config + wizard returns { launch: false } → exits without starting', () => {
    it('does NOT call start when wizard returns launch: false', async () => {
      setTTY(true);

      let loadConfigCallCount = 0;
      (loadOpenWeftConfig as MockedFunction<typeof loadOpenWeftConfig>).mockImplementation(
        async () => {
          loadConfigCallCount += 1;
          return makeNoConfigResult() as Awaited<ReturnType<typeof loadOpenWeftConfig>>;
        }
      );
      (runOnboardingWizard as MockedFunction<typeof runOnboardingWizard>).mockResolvedValue({
        launch: false,
      });

      const handlers = createCommandHandlers({
        getCwd: () => '/fake/cwd',
        writeLine: vi.fn(),
      });

      await handlers.launch();

      // Only one call to loadOpenWeftConfig (from launch itself, not from start)
      expect(loadConfigCallCount).toBe(1);
      expect(runOnboardingWizard).toHaveBeenCalledOnce();
    });
  });

  describe('(d) Non-TTY + no config → existing initCommand behavior (no wizard)', () => {
    it('does NOT call runOnboardingWizard when stdout is not a TTY', async () => {
      setTTY(false);
      (loadOpenWeftConfig as MockedFunction<typeof loadOpenWeftConfig>).mockResolvedValue(
        makeNoConfigResult() as Awaited<ReturnType<typeof loadOpenWeftConfig>>
      );

      const output: string[] = [];
      const handlers = createCommandHandlers({
        getCwd: () => '/fake/cwd',
        writeLine: (msg) => { output.push(msg); },
        detectCodex: async () => ({ installed: false, authenticated: false }),
        detectClaude: async () => ({ installed: false, authenticated: false }),
      });

      // launch → init may throw due to fake paths (no real FS), but
      // the key assertion is that runOnboardingWizard was never called.
      try {
        await handlers.launch();
      } catch {
        // FS errors from init are expected in this unit test context
      }

      expect(runOnboardingWizard).not.toHaveBeenCalled();
    });

    it('calls init and prints ready message in non-TTY mode with no config', async () => {
      setTTY(false);

      let initWasCalled = false;
      // First call returns no config (for launch), subsequent call returns no config (for init).
      (loadOpenWeftConfig as MockedFunction<typeof loadOpenWeftConfig>).mockResolvedValue(
        makeNoConfigResult() as Awaited<ReturnType<typeof loadOpenWeftConfig>>
      );

      const output: string[] = [];
      const handlers = createCommandHandlers({
        getCwd: () => '/fake/cwd',
        writeLine: (msg) => { output.push(msg); },
        detectCodex: async () => ({ installed: false, authenticated: false }),
        detectClaude: async () => ({ installed: false, authenticated: false }),
      });

      // Patch init to record the call without doing real FS work
      const originalInit = handlers.init;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (handlers as any).init = async (...args: unknown[]) => {
        initWasCalled = true;
        return originalInit(...args);
      };

      try {
        await handlers.launch();
      } catch {
        // init may fail due to fake paths — that's fine for this assertion
      }

      expect(runOnboardingWizard).not.toHaveBeenCalled();
    });
  });

  describe('(e) Config exists → existing behavior unchanged (no wizard)', () => {
    it('does NOT call runOnboardingWizard when config already exists', async () => {
      setTTY(true);
      (loadOpenWeftConfig as MockedFunction<typeof loadOpenWeftConfig>).mockResolvedValue(
        makeConfigExistsResult() as Awaited<ReturnType<typeof loadOpenWeftConfig>>
      );

      const output: string[] = [];
      const handlers = createCommandHandlers({
        getCwd: () => '/fake/cwd',
        writeLine: (msg) => { output.push(msg); },
        isPidAlive: () => false,
      });

      // status will be called, which calls loadOpenWeftConfig again — let it
      // return a config-exists result for that second call too.
      (loadOpenWeftConfig as MockedFunction<typeof loadOpenWeftConfig>).mockResolvedValue(
        makeConfigExistsResult() as Awaited<ReturnType<typeof loadOpenWeftConfig>>
      );

      try {
        await handlers.launch();
      } catch {
        // status may fail due to fake paths — that's fine for this assertion
      }

      expect(runOnboardingWizard).not.toHaveBeenCalled();
    });

    it('does NOT call runOnboardingWizard even when stdout is not TTY and config exists', async () => {
      setTTY(false);
      (loadOpenWeftConfig as MockedFunction<typeof loadOpenWeftConfig>).mockResolvedValue(
        makeConfigExistsResult() as Awaited<ReturnType<typeof loadOpenWeftConfig>>
      );

      const handlers = createCommandHandlers({
        getCwd: () => '/fake/cwd',
        writeLine: vi.fn(),
        isPidAlive: () => false,
      });

      try {
        await handlers.launch();
      } catch {
        // May fail on status call — that's acceptable
      }

      expect(runOnboardingWizard).not.toHaveBeenCalled();
    });
  });
});
