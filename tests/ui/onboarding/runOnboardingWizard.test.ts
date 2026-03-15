import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';

// ---------------------------------------------------------------------------
// Mock all heavy dependencies before importing the module under test
// ---------------------------------------------------------------------------

// Mock fs helpers
vi.mock('../../../src/fs/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/fs/index.js')>();
  return {
    ...actual,
    ensureDirectory: vi.fn().mockResolvedValue(undefined),
    ensureRuntimeDirectories: vi.fn().mockResolvedValue(undefined),
    readTextFileIfExists: vi.fn().mockResolvedValue(null),
    writeTextFileAtomic: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(false),
    ensureQueueFile: vi.fn().mockResolvedValue(undefined),
    ensureStarterFile: vi.fn().mockResolvedValue(false),
  };
});

// Mock domain/queue
vi.mock('../../../src/domain/queue.js', () => ({
  appendRequestsToQueueContent: vi.fn((_existing: string, requests: string[]) =>
    requests.join('\n') + '\n'
  ),
}));

// Mock config
vi.mock('../../../src/config/index.js', () => ({
  getDefaultConfig: vi.fn(() => ({
    featureRequestsDir: './feature_requests',
    queueFile: './queue.txt',
    prompts: {
      promptA: './prompts/prompt-a.md',
      planAdjustment: './prompts/plan-adjustment.md',
    },
    backend: 'codex',
  })),
}));

// Mock fs/paths
vi.mock('../../../src/fs/paths.js', () => ({
  buildRuntimePaths: vi.fn(() => ({
    repoRoot: '/fake/cwd',
    openweftDir: '/fake/cwd/.openweft',
    featureRequestsDir: '/fake/cwd/feature_requests',
    queueFile: '/fake/cwd/queue.txt',
    promptA: '/fake/cwd/prompts/prompt-a.md',
    planAdjustment: '/fake/cwd/prompts/plan-adjustment.md',
    checkpointFile: '/fake/cwd/.openweft/checkpoint.json',
    checkpointBackupFile: '/fake/cwd/.openweft/checkpoint.json.backup',
    costsFile: '/fake/cwd/.openweft/costs.jsonl',
    pidFile: '/fake/cwd/.openweft/pid',
    outputLogFile: '/fake/cwd/.openweft/output.log',
    auditLogFile: '/fake/cwd/.openweft/audit-trail.jsonl',
    worktreesDir: '/fake/cwd/.openweft/worktrees',
    shadowPlansDir: '/fake/cwd/.openweft/shadow-plans',
  })),
}));

// Mock handlers (for DEFAULT_PROMPT_A_TEMPLATE and DEFAULT_PLAN_ADJUSTMENT_TEMPLATE)
vi.mock('../../../src/cli/handlers.js', () => ({
  DEFAULT_PROMPT_A_TEMPLATE: 'prompt-a template content {{USER_REQUEST}}',
  DEFAULT_PLAN_ADJUSTMENT_TEMPLATE: 'plan-adjustment template content',
}));

// Mock fullscreen-ink — key mock that controls the Ink app lifecycle.
// The initial factory is a placeholder; beforeEach reconfigures it.
vi.mock('fullscreen-ink', () => ({
  withFullScreen: vi.fn(),
}));

// Mock OnboardingApp dynamic import — lightweight functional component
vi.mock('../../../src/ui/onboarding/OnboardingApp.js', () => ({
  OnboardingApp: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Import module under test (after mocks are set up)
// ---------------------------------------------------------------------------
import { runOnboardingWizard } from '../../../src/ui/onboarding/runOnboardingWizard.js';
import type { WizardCallbacks, WizardDependencies } from '../../../src/ui/onboarding/types.js';
import {
  ensureRuntimeDirectories,
  readTextFileIfExists,
  writeTextFileAtomic,
} from '../../../src/fs/index.js';
import { appendRequestsToQueueContent } from '../../../src/domain/queue.js';
import { withFullScreen } from 'fullscreen-ink';
import type { Instance } from 'ink';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeDeps = (overrides?: Partial<WizardDependencies>): WizardDependencies => ({
  getCwd: vi.fn(() => '/fake/cwd'),
  writeError: vi.fn(),
  detectGitInstalled: vi.fn().mockResolvedValue(true),
  detectGitRepo: vi.fn().mockResolvedValue(true),
  detectGitHasCommits: vi.fn().mockResolvedValue(true),
  initGitRepo: vi.fn().mockResolvedValue(undefined),
  createInitialCommit: vi.fn().mockResolvedValue(undefined),
  detectCodex: vi.fn().mockResolvedValue({ installed: true, authenticated: true }),
  detectClaude: vi.fn().mockResolvedValue({ installed: false, authenticated: false }),
  ...overrides,
});

/**
 * Create a mock Ink app object that calls onComplete with the given result
 * when start() is invoked. The `instance` field includes an unmount spy.
 */
const makeAppMock = (
  onComplete: ((result: { launch: boolean }) => void) | null,
  result: { launch: boolean }
) => {
  const unmountSpy = vi.fn();
  const instanceMock = { unmount: unmountSpy } as unknown as Instance;

  return {
    instance: instanceMock,
    start: vi.fn().mockImplementation(async () => {
      if (onComplete) onComplete(result);
    }),
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
  };
};

/** Module-level state shared between beforeEach and tests */
let mockLaunchResult: { launch: boolean } = { launch: true };

// ---------------------------------------------------------------------------
// beforeEach: reconfigure the withFullScreen mock to extract props
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockLaunchResult = { launch: true };

  // Default withFullScreen implementation: extract onComplete from element props
  // and call it immediately from start().
  (withFullScreen as MockedFunction<typeof withFullScreen>).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (element: unknown, _options: unknown): any => {
      const props = (
        element as { props?: { onComplete?: (r: { launch: boolean }) => void } }
      )?.props;
      const onComplete = props?.onComplete ?? null;
      return makeAppMock(onComplete, mockLaunchResult);
    }
  );
});

// ---------------------------------------------------------------------------
// Helper: capture all props passed to withFullScreen
// ---------------------------------------------------------------------------
const captureWithFullScreenProps = () => {
  const captured: {
    onComplete: ((r: { launch: boolean }) => void) | null;
    callbacks: WizardCallbacks | null;
    initialState: import('../../../src/ui/onboarding/types.js').OnboardingState | null;
  } = { onComplete: null, callbacks: null, initialState: null };

  (withFullScreen as MockedFunction<typeof withFullScreen>).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (element: unknown, _options: unknown): any => {
      const props = (
        element as {
          props?: {
            onComplete?: (r: { launch: boolean }) => void;
            callbacks?: WizardCallbacks;
            initialState?: import('../../../src/ui/onboarding/types.js').OnboardingState;
          };
        }
      )?.props;
      // Mutate the captured object so the test's reference reflects the update
      captured.onComplete = props?.onComplete ?? null;
      captured.callbacks = props?.callbacks ?? null;
      captured.initialState = props?.initialState ?? null;
      return makeAppMock(props?.onComplete ?? null, mockLaunchResult);
    }
  );

  return captured;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runOnboardingWizard', () => {
  describe('(a) returns { launch: true } when user completes wizard with "Start now"', () => {
    it('returns launch: true when wizard completes with launch: true', async () => {
      mockLaunchResult = { launch: true };
      const deps = makeDeps();

      const result = await runOnboardingWizard(deps);

      expect(result).toEqual({ launch: true });
    });
  });

  describe('(b) returns { launch: false } when user selects "Exit"', () => {
    it('returns launch: false when wizard completes with launch: false', async () => {
      mockLaunchResult = { launch: false };
      const deps = makeDeps();

      const result = await runOnboardingWizard(deps);

      expect(result).toEqual({ launch: false });
    });

    it('returns launch: false when git is not installed', async () => {
      const deps = makeDeps({
        detectGitInstalled: vi.fn().mockResolvedValue(false),
      });

      const result = await runOnboardingWizard(deps);

      expect(result).toEqual({ launch: false });
    });
  });

  describe('(c) runs git detection pre-checks', () => {
    it('calls detectGitInstalled', async () => {
      const deps = makeDeps();

      await runOnboardingWizard(deps);

      expect(deps.detectGitInstalled).toHaveBeenCalledOnce();
    });

    it('calls detectGitRepo when git is installed', async () => {
      const deps = makeDeps();

      await runOnboardingWizard(deps);

      expect(deps.detectGitRepo).toHaveBeenCalledOnce();
    });

    it('does NOT call detectGitRepo when git is not installed', async () => {
      const deps = makeDeps({
        detectGitInstalled: vi.fn().mockResolvedValue(false),
      });

      await runOnboardingWizard(deps);

      expect(deps.detectGitRepo).not.toHaveBeenCalled();
    });

    it('calls detectGitHasCommits when git repo detected', async () => {
      const deps = makeDeps({
        detectGitRepo: vi.fn().mockResolvedValue(true),
      });

      await runOnboardingWizard(deps);

      expect(deps.detectGitHasCommits).toHaveBeenCalledOnce();
    });

    it('does NOT call detectGitHasCommits when no git repo', async () => {
      const deps = makeDeps({
        detectGitRepo: vi.fn().mockResolvedValue(false),
      });

      await runOnboardingWizard(deps);

      expect(deps.detectGitHasCommits).not.toHaveBeenCalled();
    });

    it('runs detectCodex and detectClaude in parallel', async () => {
      const callOrder: string[] = [];
      const deps = makeDeps({
        detectCodex: vi.fn().mockImplementation(async () => {
          callOrder.push('codex');
          return { installed: true, authenticated: true };
        }),
        detectClaude: vi.fn().mockImplementation(async () => {
          callOrder.push('claude');
          return { installed: false, authenticated: false };
        }),
      });

      await runOnboardingWizard(deps);

      expect(callOrder).toContain('codex');
      expect(callOrder).toContain('claude');
      expect(deps.detectCodex).toHaveBeenCalledOnce();
      expect(deps.detectClaude).toHaveBeenCalledOnce();
    });

    it('returns launch: false early without launching Ink if git not installed', async () => {
      const deps = makeDeps({
        detectGitInstalled: vi.fn().mockResolvedValue(false),
      });

      const result = await runOnboardingWizard(deps);

      expect(result).toEqual({ launch: false });
      expect(deps.writeError).toHaveBeenCalledWith('Git is required. Install it and try again.');
      expect(withFullScreen).not.toHaveBeenCalled();
    });
  });

  describe('(d) creates WizardCallbacks that call correct dependencies', () => {
    it('onGitInit calls initGitRepo then createInitialCommit', async () => {
      const deps = makeDeps();
      const captured = captureWithFullScreenProps();

      await runOnboardingWizard(deps);

      expect(captured.callbacks).not.toBeNull();
      await captured.callbacks!.onGitInit();

      expect(deps.initGitRepo).toHaveBeenCalledOnce();
      expect(deps.createInitialCommit).toHaveBeenCalledOnce();
    });

    it('onRunInit writes config file and ensures runtime directories', async () => {
      const deps = makeDeps();
      const captured = captureWithFullScreenProps();

      await runOnboardingWizard(deps);

      expect(captured.callbacks).not.toBeNull();
      await captured.callbacks!.onRunInit('codex');

      expect(ensureRuntimeDirectories).toHaveBeenCalled();
      expect(writeTextFileAtomic).toHaveBeenCalledWith(
        expect.stringContaining('.openweftrc.json'),
        expect.stringContaining('codex')
      );
    });

    it('onRunInit adds .openweft/ to .gitignore when not present', async () => {
      const deps = makeDeps();
      const captured = captureWithFullScreenProps();

      // Simulate .gitignore exists without .openweft/ entry
      (readTextFileIfExists as MockedFunction<typeof readTextFileIfExists>).mockImplementation(
        async (filePath: string) => {
          if (filePath.endsWith('.gitignore')) return 'node_modules/\n';
          return null;
        }
      );

      await runOnboardingWizard(deps);

      expect(captured.callbacks).not.toBeNull();
      await captured.callbacks!.onRunInit('codex');

      const gitignoreWrite = (
        writeTextFileAtomic as MockedFunction<typeof writeTextFileAtomic>
      ).mock.calls.find(([filePath]) => (filePath as string).endsWith('.gitignore'));
      expect(gitignoreWrite).toBeDefined();
      expect(gitignoreWrite![1]).toContain('.openweft/');
    });

    it('onRunInit does NOT modify .gitignore if .openweft/ is already present', async () => {
      const deps = makeDeps();
      const captured = captureWithFullScreenProps();

      (readTextFileIfExists as MockedFunction<typeof readTextFileIfExists>).mockImplementation(
        async (filePath: string) => {
          if (filePath.endsWith('.gitignore')) return 'node_modules/\n.openweft/\n';
          return null;
        }
      );

      await runOnboardingWizard(deps);

      expect(captured.callbacks).not.toBeNull();
      await captured.callbacks!.onRunInit('codex');

      const gitignoreWrite = (
        writeTextFileAtomic as MockedFunction<typeof writeTextFileAtomic>
      ).mock.calls.find(([filePath]) => (filePath as string).endsWith('.gitignore'));
      expect(gitignoreWrite).toBeUndefined();
    });

    it('onQueueRequest reads queue file and appends the request', async () => {
      const deps = makeDeps();
      const captured = captureWithFullScreenProps();

      (readTextFileIfExists as MockedFunction<typeof readTextFileIfExists>).mockImplementation(
        async (filePath: string) => {
          if (filePath.endsWith('queue.txt')) return '# existing queue\n';
          return null;
        }
      );

      await runOnboardingWizard(deps);

      expect(captured.callbacks).not.toBeNull();
      await captured.callbacks!.onQueueRequest('Add dark mode');

      expect(appendRequestsToQueueContent).toHaveBeenCalledWith('# existing queue\n', [
        'Add dark mode',
      ]);
      expect(writeTextFileAtomic).toHaveBeenCalledWith(
        expect.stringContaining('queue.txt'),
        expect.any(String)
      );
    });

    it('onRedetectBackends calls detectCodex and detectClaude and returns results', async () => {
      const deps = makeDeps({
        detectCodex: vi.fn().mockResolvedValue({ installed: true, authenticated: true }),
        detectClaude: vi.fn().mockResolvedValue({ installed: true, authenticated: false }),
      });
      const captured = captureWithFullScreenProps();

      await runOnboardingWizard(deps);

      expect(captured.callbacks).not.toBeNull();
      const redetectResult = await captured.callbacks!.onRedetectBackends();

      expect(redetectResult).toEqual({
        codex: { installed: true, authenticated: true },
        claude: { installed: true, authenticated: false },
      });
    });
  });

  describe('(e) launches and exits Ink app', () => {
    it('calls withFullScreen to create the app', async () => {
      const deps = makeDeps();

      await runOnboardingWizard(deps);

      expect(withFullScreen).toHaveBeenCalledOnce();
    });

    it('calls app.start() and app.waitUntilExit()', async () => {
      const deps = makeDeps();
      let startMock: ReturnType<typeof vi.fn> | null = null;
      let waitUntilExitMock: ReturnType<typeof vi.fn> | null = null;

      (withFullScreen as MockedFunction<typeof withFullScreen>).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (element: unknown, _options: unknown): any => {
          const props = (
            element as { props?: { onComplete?: (r: { launch: boolean }) => void } }
          )?.props;

          startMock = vi.fn().mockImplementation(async () => {
            if (props?.onComplete) props.onComplete(mockLaunchResult);
          });
          waitUntilExitMock = vi.fn().mockResolvedValue(undefined);

          return {
            instance: { unmount: vi.fn() } as unknown as Instance,
            start: startMock,
            waitUntilExit: waitUntilExitMock,
          };
        }
      );

      await runOnboardingWizard(deps);

      expect(startMock).toHaveBeenCalledOnce();
      expect(waitUntilExitMock).toHaveBeenCalledOnce();
    });

    it('passes exitOnCtrlC: true to withFullScreen', async () => {
      const deps = makeDeps();

      await runOnboardingWizard(deps);

      expect(withFullScreen).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ exitOnCtrlC: true })
      );
    });

    it('passes initialState with detected values to OnboardingApp', async () => {
      const deps = makeDeps({
        detectGitRepo: vi.fn().mockResolvedValue(false),
        detectGitHasCommits: vi.fn().mockResolvedValue(false),
        detectCodex: vi.fn().mockResolvedValue({ installed: false, authenticated: false }),
        detectClaude: vi.fn().mockResolvedValue({ installed: true, authenticated: true }),
      });
      const captured = captureWithFullScreenProps();

      await runOnboardingWizard(deps);

      expect(captured.initialState).not.toBeNull();
      expect(captured.initialState!.gitDetected).toBe(false);
      expect(captured.initialState!.hasCommits).toBe(false);
      expect(captured.initialState!.codexStatus).toEqual({ installed: false, authenticated: false });
      expect(captured.initialState!.claudeStatus).toEqual({ installed: true, authenticated: true });
    });
  });
});
