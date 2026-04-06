import path from 'node:path';

import { getDefaultConfig } from '../../config/index.js';
import { appendRequestsToQueueContent } from '../../domain/queue.js';
import {
  buildDefaultRuntimePaths,
  ensureDirectory,
  ensureQueueFile,
  ensureRuntimeDirectories,
  ensureStarterFile,
  readTextFileIfExists,
  writeTextFileAtomic,
} from '../../fs/index.js';
import {
  DEFAULT_PLAN_ADJUSTMENT_TEMPLATE,
  DEFAULT_PROMPT_A_TEMPLATE,
} from '../../cli/handlers.js';
import type { OnboardingState, WizardCallbacks, WizardDependencies } from './types.js';

const SUPERPOWERS_REPO_URL = 'https://github.com/obra/superpowers';
const SUPERPOWERS_CODEX_INSTALL_URL =
  'https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.codex/INSTALL.md';

/**
 * Run the interactive onboarding wizard.
 *
 * Phase 1: Pre-checks (git detection, backend detection).
 * Phase 2: Build WizardCallbacks bound to dep functions.
 * Phase 3: Launch the Ink fullscreen app and await completion.
 * Phase 4: Return the wizard result.
 */
export async function runOnboardingWizard(
  deps: WizardDependencies
): Promise<{ launch: boolean }> {
  // -------------------------------------------------------------------------
  // Phase 1: Pre-checks
  // -------------------------------------------------------------------------

  const gitInstalled = await deps.detectGitInstalled();
  if (!gitInstalled) {
    deps.writeError('Git is required. Install it and try again.');
    return { launch: false };
  }

  const gitDetected = await deps.detectGitRepo();

  let hasCommits = false;
  if (gitDetected) {
    hasCommits = await deps.detectGitHasCommits();
  }

  const [codex, claude] = await Promise.all([deps.detectCodex(), deps.detectClaude()]);

  // -------------------------------------------------------------------------
  // Phase 2: Create WizardCallbacks
  // -------------------------------------------------------------------------

  const wizardCallbacks: WizardCallbacks = {
    onGitInit: async () => {
      await deps.initGitRepo();
      await deps.createInitialCommit();
    },

    onRunInit: async (selection) => {
      const cwd = deps.getCwd();
      const runtimePaths = buildDefaultRuntimePaths(cwd);

      await ensureRuntimeDirectories(runtimePaths);
      await ensureQueueFile(runtimePaths.queueFile);
      await ensureDirectory(path.dirname(runtimePaths.promptA));
      await ensureDirectory(path.dirname(runtimePaths.planAdjustment));
      await ensureStarterFile(runtimePaths.promptA, DEFAULT_PROMPT_A_TEMPLATE);
      await ensureStarterFile(runtimePaths.planAdjustment, DEFAULT_PLAN_ADJUSTMENT_TEMPLATE);

      // Write config
      const configPath = path.join(cwd, '.openweftrc.json');
      const defaultConfig = getDefaultConfig();
      const config = {
        ...defaultConfig,
        backend: selection.backend,
        models: {
          ...defaultConfig.models,
          [selection.backend]: selection.model
        },
        effort: {
          ...defaultConfig.effort,
          [selection.backend]: selection.effort
        }
      };
      await writeTextFileAtomic(configPath, JSON.stringify(config, null, 2) + '\n');

      // Handle .gitignore
      const gitignorePath = path.join(cwd, '.gitignore');
      const gitignoreContent = (await readTextFileIfExists(gitignorePath)) ?? '';
      if (!gitignoreContent.includes('.openweft/')) {
        const newContent =
          gitignoreContent.length > 0
            ? gitignoreContent.trimEnd() + '\n.openweft/\n'
            : '.openweft/\n';
        await writeTextFileAtomic(gitignorePath, newContent);
      }
    },

    onQueueRequest: async (request) => {
      const cwd = deps.getCwd();
      const runtimePaths = buildDefaultRuntimePaths(cwd);
      const existing = (await readTextFileIfExists(runtimePaths.queueFile)) ?? '';
      const updated = appendRequestsToQueueContent(existing, [request]);
      await writeTextFileAtomic(runtimePaths.queueFile, updated);
    },

    onRedetectBackends: async () => {
      const [redetectedCodex, redetectedClaude] = await Promise.all([
        deps.detectCodex(),
        deps.detectClaude(),
      ]);
      return { codex: redetectedCodex, claude: redetectedClaude };
    },

    onOpenSuperpowersRepo: async (backend) => {
      await deps.openExternalUrl(
        backend === 'codex' ? SUPERPOWERS_CODEX_INSTALL_URL : SUPERPOWERS_REPO_URL
      );
    },
  };

  // -------------------------------------------------------------------------
  // Phase 3: Launch Ink app
  // -------------------------------------------------------------------------

  const React = await import('react');
  const { withFullScreen } = await import('fullscreen-ink');
  const { OnboardingApp } = await import('./OnboardingApp.js');

  let wizardResult: { launch: boolean } = { launch: false };

  const initialState: OnboardingState = {
    currentStep: 1,
    gitDetected,
    hasCommits,
    codexStatus: codex,
    claudeStatus: claude,
    selectedBackend: null,
    selectedModel: null,
    selectedEffort: null,
    gitInitError: null,
    initialized: false,
    initError: null,
    queuedRequests: [],
    launchDecision: null,
  };

  const app = withFullScreen(
    React.default.createElement(OnboardingApp, {
      initialState,
      callbacks: wizardCallbacks,
      onComplete: (result) => {
        wizardResult = result;
        app.instance.unmount();
      },
    }),
    { exitOnCtrlC: true }
  );

  await app.start();
  await app.waitUntilExit();

  // -------------------------------------------------------------------------
  // Phase 4: Return result
  // -------------------------------------------------------------------------

  return wizardResult;
}
