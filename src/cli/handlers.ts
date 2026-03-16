import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import type { CommandHandlers } from './buildProgram.js';
import { ClaudeCliAdapter, CodexCliAdapter, MockAgentAdapter, createExecaCommandRunner } from '../adapters/index.js';
import type { BackendDetection } from '../ui/onboarding/types.js';
import { getDefaultConfig, loadOpenWeftConfig } from '../config/index.js';
import {
  appendRequestsToQueueContent,
  collectRequestsFromInput,
  getNextFeatureIdFromQueue,
  parseQueueFile
} from '../domain/queue.js';
import {
  buildDefaultRuntimePaths,
  ensureDirectory,
  ensureQueueFile,
  ensureRuntimeDirectories,
  ensureStarterFile,
  pathExists,
  readTextFileIfExists,
  writeTextFileAtomic
} from '../fs/index.js';
import type { ResolvedOpenWeftConfig } from '../config/schema.js';
import type { UIStore } from '../ui/store.js';
import type { StoreApi } from 'zustand/vanilla';
import { ApprovalController, runDryRunOrchestration, runRealOrchestration, StopController } from '../orchestrator/index.js';
import { createDefaultNotificationDependencies } from '../notifications/index.js';
import { loadCheckpoint } from '../state/index.js';
import { renderStatusReport } from '../status/renderStatus.js';
import {
  buildTmuxSessionName,
  readTmuxMonitorEnv,
  spawnTmuxSession as spawnTmuxSessionDefault,
  type TmuxMonitor,
  type TmuxSpawnInput,
  type TmuxSpawnResult
} from '../tmux/index.js';

interface BackgroundSpawnInput {
  cwd: string;
  args: string[];
  outputLogFile: string;
}

interface CliDependencies {
  getCwd: () => string;
  writeLine: (message: string) => void;
  writeError: (message: string) => void;
  detectCodex: () => Promise<BackendDetection>;
  detectClaude: () => Promise<BackendDetection>;
  detectTmux: () => Promise<boolean>;
  detectGitInstalled: () => Promise<boolean>;
  detectGitRepo: () => Promise<boolean>;
  detectGitHasCommits: () => Promise<boolean>;
  initGitRepo: () => Promise<void>;
  createInitialCommit: () => Promise<void>;
  getProcessArgv: () => string[];
  getExecPath: () => string;
  getEnv: () => NodeJS.ProcessEnv;
  isPidAlive: (pid: number) => boolean;
  sendSignal: (pid: number, signal: NodeJS.Signals) => void;
  spawnBackground: (input: BackgroundSpawnInput) => Promise<number>;
  spawnTmuxSession: (input: TmuxSpawnInput) => Promise<TmuxSpawnResult>;
  sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_PROMPT_A_TEMPLATE = `You are preparing a planning prompt for a coding agent.

User request:
{{USER_REQUEST}}

Return a Prompt B that tells the next agent to produce a compact Markdown feature plan with:
- a short request summary
- 3-5 implementation steps
- a \`## Manifest\` section containing a strict JSON manifest code block with \`create\`, \`modify\`, and \`delete\` arrays
- targeted validation steps

Prefer the smallest safe change set.
`;

export const DEFAULT_PLAN_ADJUSTMENT_TEMPLATE = `Review these merged edits:
{{CODE_EDIT_SUMMARY}}

Investigate whether they interfere with the referenced feature plan.
If they do, update the plan file in place, including the manifest.
If they do not, leave the plan unchanged.
Do not modify source files during this adjustment step.
`;

const readCommandInput = async (argument?: string): Promise<string> => {
  if (argument && argument.trim()) {
    return argument;
  }

  if (process.stdin.isTTY) {
    throw new Error('Provide a feature request argument or pipe requests via stdin.');
  }

  let result = '';
  for await (const chunk of process.stdin) {
    result += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  }

  if (!result.trim()) {
    throw new Error('No feature request text was provided.');
  }

  return result;
};

async function detectCodex(): Promise<BackendDetection> {
  try {
    const result = await execa('codex', ['login', 'status'], { reject: false });
    return {
      installed: true,
      authenticated: result.exitCode === 0
    };
  } catch {
    return {
      installed: false,
      authenticated: false
    };
  }
}

async function detectClaude(): Promise<BackendDetection> {
  try {
    const result = await execa('claude', ['auth', 'status'], { reject: false });
    return {
      installed: true,
      authenticated: result.exitCode === 0
    };
  } catch {
    return {
      installed: false,
      authenticated: false
    };
  }
}

async function detectTmux(): Promise<boolean> {
  try {
    const result = await execa('tmux', ['-V'], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function detectGitInstalled(): Promise<boolean> {
  try {
    const result = await execa('git', ['--version'], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function detectGitRepo(): Promise<boolean> {
  try {
    const result = await execa('git', ['rev-parse', '--git-dir'], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function detectGitHasCommits(): Promise<boolean> {
  try {
    const result = await execa('git', ['rev-parse', 'HEAD'], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function initGitRepo(): Promise<void> {
  await execa('git', ['init']);
}

async function createInitialCommit(): Promise<void> {
  await execa('git', ['commit', '--allow-empty', '-m', 'Initial commit']);
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const defaultDependencies: CliDependencies = {
  getCwd: () => process.cwd(),
  writeLine: (message) => {
    console.log(message);
  },
  writeError: (message) => {
    console.error(message);
  },
  detectCodex,
  detectClaude,
  detectTmux,
  detectGitInstalled,
  detectGitRepo,
  detectGitHasCommits,
  initGitRepo,
  createInitialCommit,
  getProcessArgv: () => [...process.argv],
  getExecPath: () => process.execPath,
  getEnv: () => ({ ...process.env }),
  isPidAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  sendSignal: (pid, signal) => {
    process.kill(pid, signal);
  },
  spawnBackground: async (input) => {
    const argv = process.argv;
    const invocationPath = argv[1];
    if (!invocationPath) {
      throw new Error('Cannot determine the OpenWeft entrypoint for background execution.');
    }

    const useTsx = invocationPath.endsWith('.ts');
    const command = useTsx ? 'tsx' : process.execPath;
    const childArgs = [invocationPath, ...input.args];
    const child = execa(command, childArgs, {
      cwd: input.cwd,
      detached: true,
      cleanup: false,
      stdin: 'ignore',
      stdout: { file: input.outputLogFile, append: true },
      stderr: { file: input.outputLogFile, append: true },
      reject: false,
      env: {
        ...process.env,
        OPENWEFT_BACKGROUND_CHILD: '1'
      }
    });

    if (!child.pid) {
      throw new Error('Background child process did not expose a PID.');
    }

    child.unref();
    void child.catch(() => {});
    return child.pid;
  },
  spawnTmuxSession: (input) => spawnTmuxSessionDefault(input),
  sleep
};


const selectAdapter = (input: {
  backend: 'codex' | 'claude' | 'mock';
  streamOutput: boolean;
}) => {
  const runner = input.streamOutput
    ? createExecaCommandRunner({
        stdout: ['pipe', 'inherit'],
        stderr: ['pipe', 'inherit']
      })
    : undefined;

  switch (input.backend) {
    case 'codex':
      return new CodexCliAdapter(runner);
    case 'claude':
      return new ClaudeCliAdapter(runner);
    case 'mock':
      return new MockAgentAdapter();
    default:
      return new MockAgentAdapter();
  }
};

const readBackgroundPid = async (
  pidFile: string,
  isPidAlive: (pid: number) => boolean
): Promise<{ pid: number; alive: boolean } | null> => {
  if (!(await pathExists(pidFile))) {
    return null;
  }

  const pidText = (await readTextFileIfExists(pidFile))?.trim() ?? '';
  const pid = Number.parseInt(pidText, 10);
  if (!Number.isInteger(pid)) {
    await rm(pidFile, { force: true });
    return null;
  }

  const alive = isPidAlive(pid);
  if (!alive) {
    await rm(pidFile, { force: true });
  }

  return {
    pid,
    alive
  };
};

const cleanupBackgroundPidIfOwned = async (pidFile: string): Promise<void> => {
  const current = process.pid;
  const pidText = (await readTextFileIfExists(pidFile))?.trim() ?? '';
  const pid = Number.parseInt(pidText, 10);

  if (pid === current) {
    await rm(pidFile, { force: true });
  }
};


export const createCommandHandlers = (
  dependencies: Partial<CliDependencies> = {}
): CommandHandlers => {
  const resolvedDependencies = {
    ...defaultDependencies,
    ...dependencies
  };

  const startTuiSession = async (input: {
    config: ResolvedOpenWeftConfig;
    configHash: string;
    gated?: boolean;
    prePopulate?: (store: StoreApi<UIStore>) => void;
    onRemoveAgent?: (agentId: string, store: StoreApi<UIStore>) => Promise<void>;
    onAddRequest?: (request: string, store: StoreApi<UIStore>) => Promise<void>;
  }): Promise<void> => {
    const { withFullScreen } = await import('fullscreen-ink');
    const { App } = await import('../ui/App.js');
    const { createUIStore } = await import('../ui/store.js');
    const { createEventHandler } = await import('../ui/hooks/useOrchestratorBridge.js');
    const React = await import('react');

    const uiStore = createUIStore();
    const onEvent = createEventHandler(uiStore);
    const stopController = new StopController();
    const approvalController = new ApprovalController(onEvent);
    const notificationDependencies = createDefaultNotificationDependencies();

    input.prePopulate?.(uiStore);

    // Non-gated (openweft start): execution is already requested
    if (!input.gated) {
      uiStore.getState().requestExecution();
    }

    // Subscribe before app.start() to avoid missing a fast s press
    let gateResolve: ((action: 'start' | 'quit') => void) | null = null;
    const gatePromise = input.gated
      ? new Promise<'start' | 'quit'>((resolve) => { gateResolve = resolve; })
      : null;

    if (input.gated) {
      uiStore.subscribe((s) => {
        if (s.executionRequested) gateResolve?.('start');
      });
    }

    const app = withFullScreen(
      React.createElement(App, {
        store: uiStore,
        onQuitRequest: () => {
          stopController.request('signal');
          gateResolve?.('quit');
        },
        onApprovalDecision: (decision) => { approvalController.resolveCurrent(decision); },
        ...(input.gated ? { onStartRequest: () => { uiStore.getState().requestExecution(); } } : {}),
        ...(input.onRemoveAgent ? { onRemoveAgent: (agentId: string) => { void input.onRemoveAgent!(agentId, uiStore); } } : {}),
        ...(input.onAddRequest ? { onAddRequest: (request: string) => { void input.onAddRequest!(request, uiStore); } } : {}),
      }),
      { exitOnCtrlC: false }
    );
    await app.start();

    const signalHandler = () => {
      if (!stopController.isRequested) {
        stopController.request('signal');
        gateResolve?.('quit');
      }
    };
    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);

    try {
      if (gatePromise) {
        const action = await gatePromise;
        if (action === 'quit') return;
        // Clear placeholder queued agents — orchestrator will emit real ones
        uiStore.getState().clearQueuedAgents();
      }

      await runRealOrchestration({
        config: input.config,
        configHash: input.configHash,
        adapter: selectAdapter({ backend: input.config.backend, streamOutput: false }),
        stopController,
        approvalController,
        notificationDependencies,
        streamOutput: false,
        tmuxRequested: false,
        sleep: resolvedDependencies.sleep,
        onEvent,
      });
    } finally {
      process.off('SIGINT', signalHandler);
      process.off('SIGTERM', signalHandler);
      app.instance.unmount();
      await app.waitUntilExit();
    }
  };

  // handlers is declared here so that `launch` can call sibling handlers.
  const handlers: CommandHandlers = {
    launch: async () => {
      const cwd = resolvedDependencies.getCwd();
      const { config, configHash } = await loadOpenWeftConfig(cwd);

      // No config — first-time user
      if (config.configFilePath === null) {
        if (process.stdout.isTTY) {
          // Dynamic import to avoid loading Ink unless needed
          const { runOnboardingWizard } = await import('../ui/onboarding/runOnboardingWizard.js');
          const result = await runOnboardingWizard(resolvedDependencies);
          if (result.launch) {
            await handlers.start({});
          }
          return;
        }
        // Non-TTY: existing init behavior
        await handlers.init();
        resolvedDependencies.writeLine('OpenWeft is ready. Run "openweft add" to queue work, then "openweft start".');
        return;
      }

      // Config exists — returning user
      const background = await readBackgroundPid(config.paths.pidFile, resolvedDependencies.isPidAlive);
      if (background?.alive) {
        await handlers.status();
        return;
      }

      const queueContent = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
      const { pending } = parseQueueFile(queueContent);
      const checkpointResult = await loadCheckpoint({
        checkpointFile: config.paths.checkpointFile,
        checkpointBackupFile: config.paths.checkpointBackupFile,
      });

      const hasWork = pending.length > 0 || (checkpointResult.checkpoint !== null &&
        Object.values(checkpointResult.checkpoint.features).some((f) =>
          f.status === 'planned' || f.status === 'executing' || f.status === 'pending'
        ));

      if (hasWork) {
        if (!process.stdout.isTTY) {
          await handlers.start({});
          return;
        }

        let nextQueuedRowId = 1;
        const queuedRequestMap = new Map<string, string>();

        await startTuiSession({
          config,
          configHash,
          gated: true,
          prePopulate: (store) => {
            // Checkpoint features (not removable)
            if (checkpointResult.checkpoint) {
              for (const feature of Object.values(checkpointResult.checkpoint.features)) {
                store.getState().addAgent({
                  id: feature.id,
                  name: feature.title ?? feature.request,
                  feature: feature.request,
                  status: 'queued',
                  removable: false,
                });
              }
            }
            // Queue pending items (removable)
            for (const line of pending) {
              const id = `queued-${nextQueuedRowId++}`;
              store.getState().addAgent({
                id,
                name: line.request,
                feature: line.request,
                status: 'queued',
                removable: true,
              });
              queuedRequestMap.set(id, line.request);
            }
            const first = store.getState().agents[0];
            if (first) store.getState().setFocusedAgent(first.id);
          },
          onRemoveAgent: async (agentId, store) => {
            const request = queuedRequestMap.get(agentId);
            if (!request) return;
            store.getState().removeAgent(agentId);
            queuedRequestMap.delete(agentId);
            const currentQueue = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
            const parsed = parseQueueFile(currentQueue);
            const match = parsed.pending.find((l) => l.request === request);
            if (match) {
              const lines = currentQueue.split('\n');
              lines.splice(match.lineIndex, 1);
              await writeTextFileAtomic(config.paths.queueFile, lines.join('\n'));
            }
          },
          onAddRequest: async (request, store) => {
            try {
              const currentQueue = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
              const updated = appendRequestsToQueueContent(currentQueue, [request]);
              await writeTextFileAtomic(config.paths.queueFile, updated);
              const id = `queued-${nextQueuedRowId++}`;
              store.getState().addAgent({ id, name: request, feature: request, status: 'queued', removable: true });
              queuedRequestMap.set(id, request);
              store.getState().setFocusedAgent(id);
              store.getState().setAddInputText(null);
            } catch {
              store.getState().setNotice({ level: 'error', message: 'Failed to write to queue file' });
            }
          },
        });
        return;
      }

      await handlers.status();
    },
    init: async () => {
      const cwd = resolvedDependencies.getCwd();
      const configPath = path.join(cwd, '.openweftrc.json');
      const { config } = await loadOpenWeftConfig(cwd);
      const configExists = config.configFilePath !== null;
      const runtimePaths = configExists ? config.paths : buildDefaultRuntimePaths(cwd);

      await ensureRuntimeDirectories(runtimePaths);
      await ensureQueueFile(runtimePaths.queueFile);
      await ensureDirectory(path.dirname(runtimePaths.promptA));
      await ensureDirectory(path.dirname(runtimePaths.planAdjustment));

      const createdPromptA = await ensureStarterFile(
        runtimePaths.promptA,
        DEFAULT_PROMPT_A_TEMPLATE
      );
      const createdPlanAdjustment = await ensureStarterFile(
        runtimePaths.planAdjustment,
        DEFAULT_PLAN_ADJUSTMENT_TEMPLATE
      );

      if (!configExists) {
        await writeTextFileAtomic(configPath, `${JSON.stringify(getDefaultConfig(), null, 2)}\n`);
      }

      const gitignorePath = path.join(cwd, '.gitignore');
      const gitignoreContent = (await readTextFileIfExists(gitignorePath)) ?? '';
      if (!gitignoreContent.includes('.openweft/')) {
        const newContent = gitignoreContent.length > 0
          ? gitignoreContent.trimEnd() + '\n.openweft/\n'
          : '.openweft/\n';
        await writeTextFileAtomic(gitignorePath, newContent);
      }

      const codex = await resolvedDependencies.detectCodex();
      const claude = await resolvedDependencies.detectClaude();

      if (process.stdout.isTTY) {
        const React = await import('react');
        const { renderStyledOutput, SuccessCard } = await import('../ui/styledOutput.js');
        await renderStyledOutput(
          React.createElement(SuccessCard, {
            message: 'Initialized OpenWeft',
            hint: `Config: ${configExists ? `kept ${config.configFilePath}.` : 'created .openweftrc.json.'}  Backends: codex=${codex.installed ? (codex.authenticated ? 'ready' : 'auth missing') : 'missing'}, claude=${claude.installed ? (claude.authenticated ? 'ready' : 'auth missing') : 'missing'}`,
          })
        );
        return;
      }

      resolvedDependencies.writeLine(
        `Initialized OpenWeft in ${cwd}. Config: ${configExists ? `kept ${config.configFilePath}.` : 'created .openweftrc.json.'}`
      );
      resolvedDependencies.writeLine(
        `Prompts: prompt-a=${createdPromptA ? 'created' : 'kept'}, plan-adjustment=${createdPlanAdjustment ? 'created' : 'kept'}`
      );
      resolvedDependencies.writeLine(
        `Backends: codex=${codex.installed ? (codex.authenticated ? 'ready' : 'installed, auth missing') : 'missing'}, claude=${claude.installed ? (claude.authenticated ? 'ready' : 'installed, auth missing') : 'missing'}`
      );
    },
    add: async (...args: unknown[]) => {
      const requestArgument = typeof args[0] === 'string' ? args[0] : undefined;
      const rawInput = await readCommandInput(requestArgument);
      const requests = collectRequestsFromInput(rawInput);

      if (requests.length === 0) {
        throw new Error('No queueable feature requests were found.');
      }

      const { config } = await loadOpenWeftConfig(resolvedDependencies.getCwd());
      await ensureRuntimeDirectories(config.paths);
      await ensureQueueFile(config.paths.queueFile);

      const existingQueueContent = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
      const updatedQueueContent = appendRequestsToQueueContent(existingQueueContent, requests);
      await writeTextFileAtomic(config.paths.queueFile, updatedQueueContent);

      const existingPlanFiles = await pathExists(config.paths.featureRequestsDir)
        ? await readdir(config.paths.featureRequestsDir).catch(() => [] as string[])
        : [];
      const existingPendingCount = parseQueueFile(existingQueueContent).pending.length;
      const firstId = getNextFeatureIdFromQueue(existingPlanFiles, existingQueueContent) + existingPendingCount;
      let nextId = firstId;

      if (process.stdout.isTTY) {
        const React = await import('react');
        const { renderStyledOutput, InfoCard } = await import('../ui/styledOutput.js');
        const queuedItems = requests.map((req, index) => `#${(firstId + index).toString().padStart(3, '0')} "${req}"`).join(', ');
        await renderStyledOutput(
          React.createElement(InfoCard, {
            message: `Queued ${requests.length} request${requests.length === 1 ? '' : 's'}`,
            detail: queuedItems,
          })
        );
        return;
      }

      for (const request of requests) {
        resolvedDependencies.writeLine(`Queued #${nextId.toString().padStart(3, '0')} "${request}"`);
        nextId += 1;
      }
    },
    start: async (...args: unknown[]) => {
      const options = (args[0] ?? {}) as {
        bg?: boolean;
        stream?: boolean;
        tmux?: boolean;
        dryRun?: boolean;
      };

      const { config, configHash } = await loadOpenWeftConfig(resolvedDependencies.getCwd());
      await ensureRuntimeDirectories(config.paths);
      await ensureQueueFile(config.paths.queueFile);

      const existingBackground = await readBackgroundPid(
        config.paths.pidFile,
        resolvedDependencies.isPidAlive
      );
      const tmuxMonitor = readTmuxMonitorEnv(resolvedDependencies.getEnv());

      if (existingBackground?.alive && !tmuxMonitor) {
        throw new Error(`OpenWeft is already running with PID ${existingBackground.pid}.`);
      }

      if (options.bg && options.tmux) {
        throw new Error('Cannot combine --bg and --tmux.');
      }

      if (options.bg) {
        if (existingBackground?.alive) {
          throw new Error(`OpenWeft is already running in the background with PID ${existingBackground.pid}.`);
        }

        const childArgs = resolvedDependencies
          .getProcessArgv()
          .slice(2)
          .filter((arg) => arg !== '--bg');
        const pid = await resolvedDependencies.spawnBackground({
          cwd: resolvedDependencies.getCwd(),
          args: childArgs,
          outputLogFile: config.paths.outputLogFile
        });
        await writeTextFileAtomic(config.paths.pidFile, `${pid}\n`);
        resolvedDependencies.writeLine(
          `► Backgrounded (PID ${pid}). Use 'openweft status' to check progress.`
        );
        return;
      }

      let useStream = Boolean(options.stream);
      if (options.tmux && !tmuxMonitor) {
        const tmuxAvailable = await resolvedDependencies.detectTmux();
        if (!tmuxAvailable) {
          resolvedDependencies.writeLine('tmux was not found. Continuing without tmux.');
        } else {
          const tmuxLogDirectory = path.join(config.paths.openweftDir, 'tmux');
          const tmuxArgs = resolvedDependencies
            .getProcessArgv()
            .slice(2)
            .filter((arg) => arg !== '--tmux');
          const sessionName = buildTmuxSessionName();
          const tmuxResult = await resolvedDependencies.spawnTmuxSession({
            cwd: resolvedDependencies.getCwd(),
            args: tmuxArgs,
            execPath: resolvedDependencies.getExecPath(),
            processArgv: resolvedDependencies.getProcessArgv(),
            logDirectory: tmuxLogDirectory,
            slotCount: config.concurrency.maxParallelAgents,
            sessionName
          });
          resolvedDependencies.writeLine(
            `► tmux session ${tmuxResult.sessionName} started. Attach with 'tmux attach -t ${tmuxResult.sessionName}'.`
          );
          return;
        }
      }

      if (tmuxMonitor) {
        useStream = true;
      }

      if (process.stdout.isTTY && !options.bg && !options.tmux && !tmuxMonitor && !options.dryRun) {
        await startTuiSession({ config, configHash });
        return;
      }

      const stopController = new StopController();
      const signalHandler = () => {
        if (!stopController.isRequested) {
          stopController.request('signal');
          resolvedDependencies.writeLine('Stop requested. OpenWeft will stop after the current phase.');
        }
      };

      process.on('SIGINT', signalHandler);
      process.on('SIGTERM', signalHandler);

      try {
        if (tmuxMonitor) {
          await writeTextFileAtomic(config.paths.pidFile, `${process.pid}\n`);
        }

        if (options.dryRun) {
          const result = await runDryRunOrchestration({
            config,
            configHash,
            adapter: new MockAgentAdapter()
          });

          resolvedDependencies.writeLine(
            `Dry run complete: planned ${result.plannedCount}, completed ${result.completedCount}.`
          );
          return;
        }

        const adapter = selectAdapter({
          backend: config.backend,
          streamOutput: useStream
        });

        const result = await runRealOrchestration({
          config,
          configHash,
          adapter,
          stopController,
          streamOutput: useStream,
          tmuxRequested: Boolean(options.tmux) || Boolean(tmuxMonitor),
          writeLine: resolvedDependencies.writeLine,
          sleep: resolvedDependencies.sleep,
          ...(tmuxMonitor ? { tmuxMonitor } : {})
        });

        resolvedDependencies.writeLine(
          `Run complete: planned ${result.plannedCount}, merged ${result.mergedCount}, status ${result.checkpoint.status}.`
        );
      } finally {
        process.off('SIGINT', signalHandler);
        process.off('SIGTERM', signalHandler);

        if (process.env.OPENWEFT_BACKGROUND_CHILD === '1' || tmuxMonitor) {
          await cleanupBackgroundPidIfOwned(config.paths.pidFile);
        }
      }
    },
    status: async () => {
      const { config } = await loadOpenWeftConfig(resolvedDependencies.getCwd());
      await ensureRuntimeDirectories(config.paths);
      await ensureQueueFile(config.paths.queueFile);

      const queueContent = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
      const checkpointResult = await loadCheckpoint({
        checkpointFile: config.paths.checkpointFile,
        checkpointBackupFile: config.paths.checkpointBackupFile
      });
      const background = await readBackgroundPid(
        config.paths.pidFile,
        resolvedDependencies.isPidAlive
      );

      if (process.stdout.isTTY) {
        const React = await import('react');
        const { renderStyledOutput, StatusCard } = await import('../ui/styledOutput.js');
        const cp = checkpointResult.checkpoint;
        const phase = cp?.currentPhase
          ? `${cp.currentPhase.name} (${cp.currentPhase.featureIds.length} feature${cp.currentPhase.featureIds.length === 1 ? '' : 's'})`
          : cp?.status ?? 'idle';
        const cost = cp ? `$${cp.cost.totalEstimatedUsd.toFixed(4)}` : '$0.0000';
        const agents = cp
          ? Object.values(cp.features).map((f) => ({
              name: `${f.id} ${f.title ?? f.request}`,
              status: f.status === 'executing' ? 'running' : f.status,
            }))
          : [];
        await renderStyledOutput(
          React.createElement(StatusCard, {
            appName: 'OpenWeft',
            phase,
            cost,
            agents,
          })
        );
        return;
      }

      resolvedDependencies.writeLine(
        renderStatusReport({
          checkpoint: checkpointResult.checkpoint,
          queueContent,
          background
        }).trimEnd()
      );
    },
    stop: async () => {
      const { config } = await loadOpenWeftConfig(resolvedDependencies.getCwd());
      const background = await readBackgroundPid(
        config.paths.pidFile,
        resolvedDependencies.isPidAlive
      );

      if (!background?.alive) {
        if (process.stdout.isTTY) {
          const React = await import('react');
          const { renderStyledOutput, WarningCard } = await import('../ui/styledOutput.js');
          await renderStyledOutput(
            React.createElement(WarningCard, {
              message: 'No background OpenWeft run is active.',
            })
          );
          return;
        }
        resolvedDependencies.writeLine('No background OpenWeft run is active.');
        return;
      }

      resolvedDependencies.sendSignal(background.pid, 'SIGTERM');
      resolvedDependencies.writeLine(
        `Sent SIGTERM to OpenWeft background process ${background.pid}. Waiting for the current phase to finish...`
      );

      for (let attempt = 0; attempt < 300; attempt += 1) {
        await resolvedDependencies.sleep(1000);
        const liveState = await readBackgroundPid(
          config.paths.pidFile,
          resolvedDependencies.isPidAlive
        );
        if (!liveState?.alive) {
          if (process.stdout.isTTY) {
            const React = await import('react');
            const { renderStyledOutput, SuccessCard } = await import('../ui/styledOutput.js');
            await renderStyledOutput(
              React.createElement(SuccessCard, {
                message: 'OpenWeft background run stopped.',
              })
            );
            return;
          }
          resolvedDependencies.writeLine('OpenWeft background run stopped.');
          return;
        }

        const checkpoint = await loadCheckpoint({
          checkpointFile: config.paths.checkpointFile,
          checkpointBackupFile: config.paths.checkpointBackupFile
        });
        if (
          checkpoint.checkpoint &&
          checkpoint.checkpoint.currentPhase === null &&
          ['stopped', 'paused', 'completed', 'failed'].includes(checkpoint.checkpoint.status)
        ) {
          resolvedDependencies.writeLine(
            `OpenWeft run reached terminal state ${checkpoint.checkpoint.status} and is finishing cleanup.`
          );
          return;
        }
      }

      resolvedDependencies.writeLine(
        'Stop was requested, but the background process is still winding down. Check `openweft status` again shortly.'
      );
    }
  };

  return handlers;
};
