import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import type { CommandHandlers } from './buildProgram.js';
import { ClaudeCliAdapter, CodexCliAdapter, MockAgentAdapter, createExecaCommandRunner } from '../adapters/index.js';
import type { BackendEffortLevel } from '../config/options.js';
import type { BackendDetection } from '../ui/onboarding/types.js';
import { getDefaultConfig, loadOpenWeftConfig } from '../config/index.js';
import {
  appendRequestsToQueueContent,
  getNextFeatureIdFromQueue,
  normalizeQueuedRequest,
  parseQueueFile,
  removePendingQueueLine,
  summarizeQueueRequest
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
  openExternalUrl: (url: string) => Promise<void>;
  getProcessArgv: () => string[];
  getExecPath: () => string;
  getEnv: () => NodeJS.ProcessEnv;
  isPidAlive: (pid: number) => boolean;
  sendSignal: (pid: number, signal: NodeJS.Signals) => void;
  spawnBackground: (input: BackgroundSpawnInput) => Promise<number>;
  spawnTmuxSession: (input: TmuxSpawnInput) => Promise<TmuxSpawnResult>;
  sleep: (ms: number) => Promise<void>;
}

const ACTIONABLE_CHECKPOINT_STATUSES = new Set(['pending', 'planned', 'executing', 'failed']);

const isActionableCheckpointFeature = (feature: { status: string }): boolean => {
  return ACTIONABLE_CHECKPOINT_STATUSES.has(feature.status);
};

export const DEFAULT_PROMPT_A_TEMPLATE = `### Instructions for Prompt Creation

Write a **hyper-detailed, comprehensive, exhaustively verbose prompt** (saved in a \`.md\` file in the ./prompts folder) following this exact structure:

1. **Role**
2. **Goal**
3. **Pre-step chain-of-thought analysis instructions**
4. **General instructions**
5. **Rules**
6. **Context**

### Requirements

#### Codebase Investigation and Relevant Context Injection
* In the prompt you create, you must instruct the model that **before any implementation planning or code changes**, it must first use a plethora of agents to analyze the relevant files in the codebase so its reasoning is grounded in the actual implementation rather than assumptions.
* The prompt must be **densely grounded in relevant context** and should equip the target LLM with the information needed to reason accurately, plan effectively, and execute safely.
* In the prompt's rules, explicitly instruct the target LLM to use **ULTRATHINK mode** for deep, careful, high-diligence reasoning.

* The prompt must include:
  * relevant **file paths and line numbers**,
  * targeted **code snippets** that clarify the current implementation, constraints, and likely problem surfaces,
  * **diagrams** when they materially improve understanding of architecture, control flow, dependencies, or data movement,
  * and relevant, up-to-date **Context7 documentation excerpts** when framework, library, or API behavior is important to the task.

* The injected context must be selected to **guide and inform** the target LLM with the technical details, constraints, signals, and surrounding implementation state needed to perform the work effectively.

* Do **not** provide the actual solution inside the prompt.
* Do **not** include prompt-authoring meta-commentary, such as instructions about how the prompt itself was constructed or remarks about resisting solving the problem inside the prompt.
* It is acceptable and expected to include **task-facing operational instructions** that govern how the target LLM should reason, plan, validate, test, document, and execute. These include instructions related to planning discipline, ledger usage, confidence reporting, validation behavior, testing cadence, and implementation safeguards.

* The output instructions within the prompt must direct the target LLM to operate using a disciplined workflow that includes:
  * reasoning deeply and producing the best solution it can justify,
  * investigating the codebase and gathering the necessary context before planning,
  * developing and maintaining the **Living Plan Ledger** before and throughout implementation,
  * preparing carefully before making code edits,
  * executing the implementation incrementally in accordance with the established plan,
  * stating confidence percentages for key judgments when appropriate,
  * running **targeted tests after each meaningful edit or edit group** before proceeding so correctness is validated progressively,
  * and performing the required **Downstream Impact Reviews** before closing major steps, including reassessing whether the remaining plan and ledger structure still reflect the best current execution path.

* The prompt should provide enough context to make the target LLM effective while still leaving the **core reasoning, diagnosis, planning, and implementation work** to the target LLM itself.

#### 'Living Plan Ledger' Creation Directive
<Living Plan Ledger>
* In the prompt you create, you must instruct the model that **after completing the initial codebase research**, it must use the **Plan-Creation Brainstorming Instructions** below to determine the best implementation plan for accomplishing the goal.
* It must then create a **Living Plan Ledger** Markdown file in \`./project_ledgers\`.
* The filename must begin with the next sequential number and then a short relevant label, for example:
* \`1.relevant-label.md\`
* \`2.relevant-label.md\`
* The Living Plan Ledger must serve as the **canonical execution record** and **single source of truth** for the task.

* The Living Plan Ledger must contain:
* the selected implementation plan in full,
* a checklist of major steps and sub-steps,
* current execution status,
* enough detail for work to resume reliably after interruption, compaction, or context loss,
* and a structured schema for each step and sub-step.

* At the top of the Living Plan Ledger, include a short instruction block stating that:
* **after every compaction, the full ledger must be reread before any further work begins**,
* the ledger is the source of truth for what has been completed, what remains, and what has changed,
* and the next action must be chosen only after reviewing the ledger in full.

* As work proceeds, progress, decisions, discoveries, plan adjustments, and completion state must be recorded in the ledger so execution remains recoverable, auditable, and consistent.

#### Plan-Creation Brainstorming Instructions
Brainstorm **5 distinct high-level approaches** to accomplish the goal.

Evaluate each high-level approach against at minimum:
* blast radius,
* reversibility,
* dependency complexity,
* implementation effort,
* long-term maintainability.

Score and select the strongest high-level approach.

Then, based on that winning high-level approach, brainstorm **5 concrete actionable implementation strategies**.

Evaluate each implementation strategy against at minimum:
* risk of cascading failures,
* operational complexity,
* implementation clarity,
* observability and debuggability,
* compatibility with the existing architecture.

Select the strongest implementation strategy.

Write the resulting plan into the **Living Plan Ledger** using the step schema defined below.

When constructing the plan, you must be deliberate about the **order of operations**. Sequence the steps to minimize blast radius and prevent cascading effects.

Follow these ordering rules:
* ensure prerequisites exist before dependent steps are executed,
* place behavior-preserving preparation steps before behavior-changing steps,
* isolate high-risk changes and introduce them only after compatibility layers, scaffolding, or safeguards are in place,
* prefer reversible changes before irreversible ones,
* and, where appropriate, follow an **expand → migrate → contract** pattern.

Each step should make subsequent steps safer and easier to execute.

Before finalizing the plan, review the ordered steps and verify that no step would break, constrain, invalidate, or destabilize a later step if executed in sequence. If it would, reorder the plan before writing it into the ledger.

#### Required Step Schema for the Living Plan Ledger
Each major step and sub-step in the Living Plan Ledger must include the following fields:

* **Step ID**
* **Title**
* **Objective**
* **Why This Step Exists**
* **Dependencies**
* **Preconditions**
* **Planned Actions**
* **Risk Level** (\`Low\`, \`Medium\`, \`High\`)
* **Potential Blast Radius**
* **Rollback / Recovery Notes**
* **Validation / Completion Criteria**
* **Affected Files / Systems**
* **Downstream Steps Potentially Impacted**
* **Status** (\`Not Started\`, \`In Progress\`, \`Blocked\`, \`Complete\`)
* **Notes / Discoveries**

The schema must be detailed enough that another agent could resume execution with minimal ambiguity.

#### Step-Completion, Downstream Impact Review, and Plan-Integrity Requirements
Before marking any **major step** as **Complete**, the main agent must launch **1 or 2 dedicated verification agents** to perform a **Downstream Impact Review**.

Use **1 verification agent by default**.

Use **2 verification agents** when the completed step is high-risk, cross-cutting, architecture-affecting, touches shared interfaces or schemas, has meaningful blast radius, or when confidence is not high that downstream implications have been fully understood.

The Downstream Impact Review must:
* reread the remaining planned steps and their schemas,
* understand the assumptions, dependencies, sequencing, and intended outcomes of the remaining work,
* inspect whether the completed edits introduced any unexpected coupling, side effects, invalidated assumptions, sequencing changes, or newly required work,
* determine whether any future step must be revised, reordered, expanded, split, merged, or replaced based on what was learned from the completed implementation,
* and assess whether the **overall remaining plan and ledger structure** still reflect the best current execution path, or whether accumulated changes now justify broader restructuring of the remaining work.

If the completed work changes the conditions under which later steps were originally planned, or reveals that the broader remaining plan or ledger structure no longer reflects current reality, the **Living Plan Ledger** must be updated to reflect the latest reality **before** the current major step is marked complete.

A major step is not truly complete until:
* its own validation criteria are satisfied,
* downstream impact has been reviewed,
* and the ledger has been updated to reflect any newly discovered implications for the remaining plan.

For **sub-steps**, a dedicated Downstream Impact Review is **not required by default**.

Instead, the main agent must use **risk-based judgment** to decide whether a sub-step warrants launching a targeted verification agent. A sub-step should receive a dedicated downstream review when it appears likely to affect later assumptions, shared system boundaries, sequencing, implementation requirements, or the integrity of the remaining plan.

This is especially important when a sub-step touches:
* shared interfaces or contracts,
* schemas, persistence, or migrations,
* auth, permissions, or security-sensitive logic,
* build, deploy, config, or environment behavior,
* shared utilities or cross-cutting infrastructure,
* or any area where local edits may have non-local effects.

Simple, local, mechanical, or low-risk sub-steps usually do **not** require a dedicated downstream review unless the main agent detects reason for concern.

When in doubt for a sub-step, prefer launching **1 targeted verification agent** rather than skipping review entirely.


</Living Plan Ledger>

### Debugging Request Trigger
If the first draft prompt has a 75% confidence percentage it is a debugging request, include the following, adapting the wording contextually based on the request while retaining the spirit of the debugging execution workflow. You are INCLUDING this, while maintaining flexibility and intelligent creativity with the rest of the prompt. You will also use Context7 to saturate the prompt with relevant documentation code snippet quotes:

<debugging_guidelines>
### Phase 1: Error Sequence Analysis
1. Trace the complete execution flow from initial input through all major components to the point where the error or incorrect behavior occurs.
2. Identify each handoff point where data, control, or state passes between functions, modules, services, or external systems.
3. Map the exact state of the system at the moment of failure (key variables, inputs, configuration, environment, and external dependencies).
4. List all assumptions the code makes about inputs, outputs, data formats, and external component behavior.
5. Enumerate all plausible reasons why the expected result (e.g., output, side effect, state change) might not be produced.
6. Analyze the relevant logic and control flow for potential ambiguities, edge cases, or missing conditions.
7. Compare the current implementation against official documentation for any external APIs, libraries, frameworks, or protocols involved.
8. Identify gaps between what the code expects to happen and what the system or dependencies actually guarantee or return.

### Phase 2: Root Cause Hypothesis Formation
1. Generate at least 5 distinct hypotheses for why the error or incorrect behavior is occurring.
2. For each hypothesis, estimate probability (0–100%) based on evidence from logs, code inspection, and observed behavior.
3. Rank hypotheses by likelihood × impact (how likely they are and how severely they affect the system).
4. Identify which hypotheses can be tested immediately (e.g., via logging, small code changes, or reproduction steps) vs. those requiring more substantial changes or setup.
5. Map dependencies between hypotheses (e.g., if H1 is true, H3 becomes more/less likely).

### Phase 3: Fix Strategy Design
1. For the top 3 most likely hypotheses, design targeted fixes or mitigations.
2. Identify potential side effects, regressions, or breaking changes associated with each fix.
3. Design validation tests (unit, integration, end-to-end, or manual checks) that would conclusively demonstrate each fix works.
4. Plan rollback strategies in case a fix introduces new issues (e.g., feature flags, git revert, configuration toggles).
5. Design or refine logging and telemetry that would make future diagnosis of similar issues faster and clearer.
6. Identify opportunities to make the system more robust and resilient to variations in inputs, configuration, or external dependencies.

### Phase 4: Implementation Planning
1. Break down the chosen fix (or set of fixes) into atomic, testable changes.
2. Prioritize changes by risk and expected benefit (low-risk, high-value improvements first; higher-risk changes later).
3. Identify which changes can be made and tested in parallel vs. those that must be applied sequentially.
4. Plan targeted tests for each change, including what to test, how to test it, and the exact expected outcomes.
5. Define explicit confidence thresholds: what evidence (passing tests, logs, metrics, user reports) will make you confident that the issue is resolved and no new critical bugs were introduced?
6. Understand your eventual goal is to keep iteratively analyzing and debugging and testing and analyzing and debugging and testing until we reach ~95%+ confidence we have found the solution and it has been robustly implemented.
</debugging_guidelines>

### Rules
1. There must be zero data loss from the first draft prompt in your rewrite. For example, if first draft prompt is extensively large, put any extra content in the context area in the rewrite.
2. Must double check this in your thinking before publishing it as an .md file, and after you do write the .md file, check one more time and fix if you need to.
3. You must explicitly instruct the target LLM that workspace creation and git topology are owned by the orchestrator, not by the target LLM. The prompt you create must tell it to use the current assigned repository/worktree as its only workspace.
4. You must explicitly instruct the target LLM that it must not create additional git worktrees, must not clone the repository elsewhere, must not create or switch to ad hoc branches unless explicitly instructed by the orchestrator, and must not relocate the task into another checkout or sibling repo.
5. You must explicitly instruct the target LLM to treat workspace isolation as already solved and to focus instead on investigation, planning, ledger maintenance, implementation, validation, and safe completion within the provided workspace.
### First Draft Prompt
<first_draft_prompt>
{{USER_REQUEST}}
</first_draft_prompt>
`;

export const DEFAULT_PLAN_ADJUSTMENT_TEMPLATE = `Review these merged edits:
<CODE_EDIT_SUMMARY>
{{CODE_EDIT_SUMMARY}}
</CODE_EDIT_SUMMARY>

Investigate whether they interfere with the referenced feature plan.
Use the Ledger section to preserve or update its constraints, assumptions, watchpoints, and validation.
If they do, update the returned plan markdown, including the \`## Ledger\` and \`## Manifest\` sections.
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
    if (result.failed && result.code === 'ENOENT') {
      return {
        installed: false,
        authenticated: false
      };
    }
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
    if (result.failed && result.code === 'ENOENT') {
      return {
        installed: false,
        authenticated: false
      };
    }
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

async function openExternalUrl(url: string): Promise<void> {
  try {
    const result = process.platform === 'darwin'
      ? await execa('open', [url], { reject: false })
      : process.platform === 'win32'
        ? await execa('cmd', ['/c', 'start', '', url], { reject: false, windowsHide: true })
        : await execa('xdg-open', [url], { reject: false });

    if (result.exitCode === 0) {
      return;
    }
  } catch {
    // fall through to the user-facing error below
  }

  throw new Error('Failed to open the browser automatically.');
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const getConfiguredBackendDetection = async (
  dependencies: Pick<CliDependencies, 'detectCodex' | 'detectClaude'>,
  backend: ResolvedOpenWeftConfig['backend']
): Promise<BackendDetection> => {
  switch (backend) {
    case 'codex':
      return dependencies.detectCodex();
    case 'claude':
      return dependencies.detectClaude();
  }
};

const getDefaultBackendApiKeyEnvVar = (
  backend: ResolvedOpenWeftConfig['backend']
): string => {
  return backend === 'codex' ? 'CODEX_API_KEY' : 'ANTHROPIC_API_KEY';
};

const getConfiguredBackendLabel = (
  backend: ResolvedOpenWeftConfig['backend']
): string => {
  return backend === 'codex' ? 'Codex CLI' : 'Claude CLI';
};

const ensureConfiguredBackendReady = async (
  config: ResolvedOpenWeftConfig,
  dependencies: Pick<CliDependencies, 'detectCodex' | 'detectClaude' | 'getEnv'>
): Promise<void> => {
  const backend = config.backend;
  const detection = await getConfiguredBackendDetection(dependencies, backend);
  if (!detection.installed) {
    throw new Error(
      `Configured backend "${backend}" is not installed or not available on PATH. Install the ${getConfiguredBackendLabel(backend)} or change the OpenWeft "backend" setting before running "openweft start".`
    );
  }

  const authConfig = config.auth[backend];
  if (authConfig.method === 'subscription') {
    if (detection.authenticated) {
      return;
    }

    throw new Error(
      `Configured backend "${backend}" is installed but not authenticated for subscription mode. Authenticate the ${getConfiguredBackendLabel(backend)} or switch to api_key auth before running "openweft start".`
    );
  }

  const envVar = authConfig.envVar ?? getDefaultBackendApiKeyEnvVar(backend);
  const envValue = dependencies.getEnv()[envVar];
  if (typeof envValue === 'string' && envValue.trim().length > 0) {
    return;
  }

  throw new Error(
    `Configured backend "${backend}" requires API key environment variable ${envVar}, but it is not set. Export ${envVar} or update your OpenWeft auth config before running "openweft start".`
  );
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
  openExternalUrl,
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
    const command = process.execPath;
    const childArgs = useTsx
      ? [...process.execArgv, invocationPath, ...input.args]
      : [invocationPath, ...input.args];
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

const waitForBackgroundChildReady = async (input: {
  pidFile: string;
  spawnedPid: number;
  isPidAlive: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  attempts?: number;
  delayMs?: number;
}): Promise<number | null> => {
  const attempts = input.attempts ?? 40;
  const delayMs = input.delayMs ?? 250;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const background = await readBackgroundPid(input.pidFile, input.isPidAlive);
    if (background?.alive) {
      return background.pid;
    }

    if (!input.isPidAlive(input.spawnedPid)) {
      return null;
    }

    await input.sleep(delayMs);
  }

  return null;
};

const supportsJsonConfigEditing = (configFilePath: string | null): boolean => {
  return (
    configFilePath !== null &&
    path.extname(configFilePath) === '.json' &&
    path.basename(configFilePath) !== 'package.json'
  );
};

const buildModelSelectionForConfig = (
  config: ResolvedOpenWeftConfig
): UIStore['modelSelection'] => {
  if (config.backend === 'claude') {
    return {
      backend: 'claude',
      model: config.models.claude,
      effort: config.effort.claude,
      editable: supportsJsonConfigEditing(config.configFilePath)
    };
  }

  return {
    backend: 'codex',
    model: config.models.codex,
    effort: config.effort.codex,
    editable: supportsJsonConfigEditing(config.configFilePath)
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const persistModelSelectionToConfigFile = async (input: {
  configFilePath: string;
  backend: 'codex' | 'claude';
  model: string;
  effort: BackendEffortLevel;
}): Promise<void> => {
  const currentContent = await readTextFileIfExists(input.configFilePath);
  if (currentContent === null) {
    throw new Error(`OpenWeft config file not found at ${input.configFilePath}.`);
  }

  const parsed = JSON.parse(currentContent) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`OpenWeft config at ${input.configFilePath} must be a JSON object.`);
  }

  const models = isRecord(parsed.models) ? parsed.models : {};
  const effort = isRecord(parsed.effort) ? parsed.effort : {};
  const nextConfig = {
    ...parsed,
    models: {
      ...models,
      [input.backend]: input.model
    },
    effort: {
      ...effort,
      [input.backend]: input.effort
    }
  };

  await writeTextFileAtomic(
    input.configFilePath,
    `${JSON.stringify(nextConfig, null, 2)}\n`
  );
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
    onStartRequest?: (store: StoreApi<UIStore>) => Promise<void> | void;
    onRemoveAgent?: (agentId: string, store: StoreApi<UIStore>) => Promise<void>;
    onAddRequest?: (request: string, store: StoreApi<UIStore>) => Promise<void>;
    onSaveModelSelection?: (
      selection: { model: string; effort: BackendEffortLevel },
      store: StoreApi<UIStore>
    ) => Promise<void>;
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
    let activeConfig = input.config;
    let activeConfigHash = input.configHash;
    let configDirty = false;

    uiStore.getState().setModelSelection(buildModelSelectionForConfig(input.config));
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
        ...(input.gated
          ? {
              onStartRequest: () => {
                if (input.onStartRequest) {
                  void input.onStartRequest(uiStore);
                  return;
                }
                uiStore.getState().requestExecution();
              }
            }
          : {}),
        ...(input.onRemoveAgent ? { onRemoveAgent: (agentId: string) => { void (async () => { try { await input.onRemoveAgent!(agentId, uiStore); } catch { uiStore.getState().setNotice({ level: 'error', message: 'Failed to write to queue file' }); } })(); } } : {}),
        ...(input.onAddRequest ? { onAddRequest: (request: string) => { void (async () => { try { await input.onAddRequest!(request, uiStore); } catch { uiStore.getState().setNotice({ level: 'error', message: 'Failed to write to queue file' }); } })(); } } : {}),
        ...(input.onSaveModelSelection
          ? {
              onSaveModelSelection: (selection: { model: string; effort: BackendEffortLevel }) => {
                void (async () => {
                  try {
                    await input.onSaveModelSelection!(selection, uiStore);
                    configDirty = true;
                  } catch {
                    uiStore.getState().setNotice({
                      level: 'error',
                      message: 'Failed to save model settings'
                    });
                  }
                })();
              }
            }
          : {}),
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
      }

      if (configDirty) {
        const refreshed = await loadOpenWeftConfig(resolvedDependencies.getCwd());
        activeConfig = refreshed.config;
        activeConfigHash = refreshed.configHash;
        uiStore.getState().setModelSelection(buildModelSelectionForConfig(activeConfig));
      }

      const result = await runRealOrchestration({
        config: activeConfig,
        configHash: activeConfigHash,
        adapter: selectAdapter({ backend: activeConfig.backend, streamOutput: false }),
        stopController,
        approvalController,
        notificationDependencies,
        streamOutput: false,
        tmuxRequested: false,
        sleep: resolvedDependencies.sleep,
        onEvent,
      });

      const completedFeatures = Object.values(result.checkpoint.features ?? {})
        .filter((f) => f.status === 'completed')
        .map((f) => ({
          id: f.id,
          request: f.title ?? f.request,
          mergeCommit: f.mergeCommit ?? null
        }));

      uiStore.getState().setCompletedFeatures(completedFeatures);
      uiStore.getState().setCompletion({
        status: result.checkpoint.status,
        plannedCount: result.plannedCount,
        mergedCount: result.mergedCount,
      });

      // Wait for user to dismiss the completion screen (or timeout after 60s)
      let unsub: (() => void) | undefined;
      await Promise.race([
        new Promise<void>((resolve) => {
          unsub = uiStore.subscribe((state) => {
            if (state.completionDismissed) {
              unsub?.();
              resolve();
            }
          });
        }),
        resolvedDependencies.sleep(60000)
      ]);
      unsub?.();
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
        Object.values(checkpointResult.checkpoint.features).some((feature) =>
          isActionableCheckpointFeature(feature)
        ));

      if (hasWork || process.stdout.isTTY) {
        if (!process.stdout.isTTY) {
          await handlers.start({});
          return;
        }

        type QueuedReadyStateRow = {
          request: string;
          lineIndex: number;
        };

        let nextQueuedRowId = 1;
        const queuedRequestMap = new Map<string, QueuedReadyStateRow>();
        let readyStateMutationQueue: Promise<void> = Promise.resolve();

        const enqueueReadyStateMutation = (mutation: () => Promise<void>): Promise<void> => {
          const pendingMutation = readyStateMutationQueue.then(mutation);
          readyStateMutationQueue = pendingMutation.catch(() => {});
          return pendingMutation;
        };

        const drainReadyStateMutations = async (): Promise<void> => {
          await readyStateMutationQueue;
        };

        const hasActionableReadyStateRows = (store: StoreApi<UIStore>): boolean => {
          return store.getState().agents.some((agent) => agent.status === 'queued');
        };

        const shiftQueuedRowsAfterRemoval = (removedLineIndex: number): void => {
          for (const [id, row] of queuedRequestMap.entries()) {
            if (row.lineIndex > removedLineIndex) {
              queuedRequestMap.set(id, {
                ...row,
                lineIndex: row.lineIndex - 1
              });
            }
          }
        };

        await startTuiSession({
          config,
          configHash,
          gated: true,
          prePopulate: (store) => {
            // Checkpoint features (not removable)
            if (checkpointResult.checkpoint) {
              const completed = Object.values(checkpointResult.checkpoint.features)
                .filter((f) => f.status === 'completed')
                .map((f) => ({
                  id: f.id,
                  request: f.title ?? f.request,
                  mergeCommit: f.mergeCommit ?? null
                }));
              if (completed.length > 0) {
                store.getState().setCompletedFeatures(completed);
              }

              for (const feature of Object.values(checkpointResult.checkpoint.features)) {
                if (!isActionableCheckpointFeature(feature)) {
                  continue;
                }
                store.getState().addAgent({
                  id: feature.id,
                  name: feature.title ?? summarizeQueueRequest(feature.request),
                  feature: feature.title ?? summarizeQueueRequest(feature.request),
                  status: 'queued',
                  removable: false,
                });
              }
            }
            // Queue pending items (removable)
            for (const line of pending) {
              const id = `queued-${nextQueuedRowId++}`;
              const requestLabel = summarizeQueueRequest(line.request);
              store.getState().addAgent({
                id,
                name: requestLabel,
                feature: requestLabel,
                status: 'queued',
                removable: true,
              });
              queuedRequestMap.set(id, {
                request: line.request,
                lineIndex: line.lineIndex
              });
            }
            const first = store.getState().agents[0];
            if (first) store.getState().setFocusedAgent(first.id);
          },
          onStartRequest: async (store) => {
            await drainReadyStateMutations();

            if (!hasActionableReadyStateRows(store)) {
              store.getState().setNotice({
                level: 'info',
                message: 'No queued or resumable work to start.'
              });
              return;
            }

            try {
              await ensureConfiguredBackendReady(config, resolvedDependencies);
            } catch (error) {
              store.getState().setNotice({
                level: 'error',
                message: error instanceof Error ? error.message : String(error)
              });
              return;
            }

            store.getState().requestExecution();
            if (resolvedDependencies.getEnv().OPENWEFT_DEMO_MODE === '1') {
              store.getState().setNotice({
                level: 'info',
                message: 'Starting orchestration…'
              });
            }
          },
          onRemoveAgent: async (agentId, store) => {
            await enqueueReadyStateMutation(async () => {
              const queuedRow = queuedRequestMap.get(agentId);
              if (!queuedRow) {
                return;
              }

              try {
                const currentQueue = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
                const updatedQueue = removePendingQueueLine(
                  currentQueue,
                  queuedRow.lineIndex,
                  queuedRow.request
                );
                await writeTextFileAtomic(config.paths.queueFile, updatedQueue);
                store.getState().removeAgent(agentId);
                queuedRequestMap.delete(agentId);
                shiftQueuedRowsAfterRemoval(queuedRow.lineIndex);
              } catch {
                store.getState().setNotice({ level: 'error', message: 'Failed to write to queue file' });
              }
            });
          },
          onAddRequest: async (request, store) => {
            await enqueueReadyStateMutation(async () => {
              const trimmed = request.trim();
              const normalizedRequest = normalizeQueuedRequest(request);
              if (normalizedRequest === null) return;
              try {
                const currentQueue = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
                const updated = appendRequestsToQueueContent(currentQueue, [normalizedRequest]);
                await writeTextFileAtomic(config.paths.queueFile, updated);
                const appendedLine = parseQueueFile(updated).pending.at(-1);
                if (!appendedLine || appendedLine.request !== normalizedRequest) {
                  throw new Error('Failed to locate appended queue request.');
                }
                const id = `queued-${nextQueuedRowId++}`;
                const requestLabel = summarizeQueueRequest(normalizedRequest);
                store.getState().addAgent({
                  id,
                  name: requestLabel,
                  feature: requestLabel,
                  status: 'queued',
                  removable: true
                });
                queuedRequestMap.set(id, {
                  request: normalizedRequest,
                  lineIndex: appendedLine.lineIndex
                });
                store.getState().setFocusedAgent(id);
                store.getState().setAddInputText(null);
              } catch {
                store.getState().setNotice({ level: 'error', message: 'Failed to write to queue file' });
              }
            });
          },
          onSaveModelSelection: async (selection, store) => {
            const currentSelection = store.getState().modelSelection;
            const configFilePath = config.configFilePath;

            if (
              currentSelection === null ||
              configFilePath === null ||
              !supportsJsonConfigEditing(configFilePath)
            ) {
              store.getState().setNotice({
                level: 'info',
                message: 'Model editing is only supported for dedicated JSON config files.'
              });
              return;
            }

            await persistModelSelectionToConfigFile({
              configFilePath,
              backend: currentSelection.backend,
              model: selection.model,
              effort: selection.effort
            });

            store.getState().setModelSelection({
              backend: currentSelection.backend,
              model: selection.model,
              effort: selection.effort,
              editable: currentSelection.editable
            });
            store.getState().closeModelMenu();
            store.getState().setMode('normal');
            store.getState().setNotice({
              level: 'info',
              message: 'Saved model + effort for the next run.'
            });
          },
        });
        return;
      }

      await handlers.status();
    },
    init: async () => {
      const cwd = resolvedDependencies.getCwd();
      const gitRepoDetected = await resolvedDependencies.detectGitRepo();
      if (!gitRepoDetected) {
        throw new Error('OpenWeft init must be run inside a git repository. Run "git init" first.');
      }

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
      const request = normalizeQueuedRequest(rawInput);

      if (request === null) {
        throw new Error('No queueable feature requests were found.');
      }

      const { config } = await loadOpenWeftConfig(resolvedDependencies.getCwd());
      if (config.configFilePath === null) {
        throw new Error('OpenWeft is not initialized here. Run "openweft init" first.');
      }

      await ensureRuntimeDirectories(config.paths);
      await ensureQueueFile(config.paths.queueFile);

      const existingQueueContent = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
      const updatedQueueContent = appendRequestsToQueueContent(existingQueueContent, [request]);
      await writeTextFileAtomic(config.paths.queueFile, updatedQueueContent);

      const existingPlanFiles = await pathExists(config.paths.featureRequestsDir)
        ? await readdir(config.paths.featureRequestsDir).catch(() => [] as string[])
        : [];
      const existingPendingCount = parseQueueFile(existingQueueContent).pending.length;
      const firstId = getNextFeatureIdFromQueue(existingPlanFiles, existingQueueContent) + existingPendingCount;

      if (process.stdout.isTTY) {
        const React = await import('react');
        const { renderStyledOutput, InfoCard } = await import('../ui/styledOutput.js');
        await renderStyledOutput(
          React.createElement(InfoCard, {
            message: 'Queued 1 request',
            detail: `#${firstId.toString().padStart(3, '0')} "${summarizeQueueRequest(request)}"`,
          })
        );
        return;
      }

      resolvedDependencies.writeLine(
        `Queued #${firstId.toString().padStart(3, '0')} "${summarizeQueueRequest(request)}"`
      );
    },
    start: async (...args: unknown[]) => {
      const options = (args[0] ?? {}) as {
        bg?: boolean;
        stream?: boolean;
        tmux?: boolean;
        dryRun?: boolean;
      };

      const { config, configHash } = await loadOpenWeftConfig(resolvedDependencies.getCwd());
      if (config.configFilePath === null) {
        throw new Error('OpenWeft is not initialized here. Run "openweft init" first.');
      }

      await ensureRuntimeDirectories(config.paths);
      await ensureQueueFile(config.paths.queueFile);

      const backgroundChild = resolvedDependencies.getEnv().OPENWEFT_BACKGROUND_CHILD === '1';
      const existingBackground = await readBackgroundPid(
        config.paths.pidFile,
        resolvedDependencies.isPidAlive
      );
      const tmuxMonitor = readTmuxMonitorEnv(resolvedDependencies.getEnv());

      if (existingBackground?.alive && !tmuxMonitor && !backgroundChild) {
        throw new Error(`OpenWeft is already running with PID ${existingBackground.pid}.`);
      }

      if (options.bg && options.tmux) {
        throw new Error('Cannot combine --bg and --tmux.');
      }

      if (!options.dryRun) {
        await ensureConfiguredBackendReady(config, resolvedDependencies);
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
        const readyPid = await waitForBackgroundChildReady({
          pidFile: config.paths.pidFile,
          spawnedPid: pid,
          isPidAlive: resolvedDependencies.isPidAlive,
          sleep: resolvedDependencies.sleep
        });
        if (readyPid === null) {
          throw new Error(
            `Background child process ${pid} did not become ready. Check ${config.paths.outputLogFile} for details.`
          );
        }
        resolvedDependencies.writeLine(
          `► Backgrounded (PID ${readyPid}). Use 'openweft status' to check progress.`
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

      if (process.stdout.isTTY && !options.bg && !options.stream && !options.tmux && !tmuxMonitor && !options.dryRun) {
        let nextInlineQueuedAgentId = 1;
        let nextPreloadedQueuedAgentId = 1;
        const queueContent = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
        const { pending } = parseQueueFile(queueContent);
        const checkpointResult = await loadCheckpoint({
          checkpointFile: config.paths.checkpointFile,
          checkpointBackupFile: config.paths.checkpointBackupFile
        });

        await startTuiSession({
          config,
          configHash,
          prePopulate: (store) => {
            if (checkpointResult.checkpoint) {
              for (const feature of Object.values(checkpointResult.checkpoint.features)) {
                if (!isActionableCheckpointFeature(feature)) {
                  continue;
                }
                store.getState().addAgent({
                  id: feature.id,
                  name: feature.title ?? summarizeQueueRequest(feature.request),
                  feature: feature.title ?? summarizeQueueRequest(feature.request),
                  status: 'queued',
                  removable: false,
                });
              }
            }

            for (const line of pending) {
              const requestLabel = summarizeQueueRequest(line.request);
              store.getState().addAgent({
                id: `queued-start-${nextPreloadedQueuedAgentId++}`,
                name: requestLabel,
                feature: requestLabel,
                status: 'queued',
                removable: false,
              });
            }
          },
          onAddRequest: async (request, store) => {
            const normalizedRequest = normalizeQueuedRequest(request);
            if (normalizedRequest === null) {
              return;
            }

            try {
              const currentQueue = (await readTextFileIfExists(config.paths.queueFile)) ?? '';
              const updated = appendRequestsToQueueContent(currentQueue, [normalizedRequest]);
              await writeTextFileAtomic(config.paths.queueFile, updated);

              const agentId = `queued-live-${nextInlineQueuedAgentId++}`;
              const requestLabel = summarizeQueueRequest(normalizedRequest);
              store.getState().addAgent({
                id: agentId,
                name: requestLabel,
                feature: requestLabel,
                status: 'queued',
                removable: false,
              });
              store.getState().setFocusedAgent(agentId);
              store.getState().setAddInputText(null);
            } catch {
              store.getState().setNotice({ level: 'error', message: 'Failed to write to queue file' });
            }
          },
        });
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
        await writeTextFileAtomic(config.paths.pidFile, `${process.pid}\n`);

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

        await cleanupBackgroundPidIfOwned(config.paths.pidFile);
      }
    },
    status: async () => {
      const { config } = await loadOpenWeftConfig(resolvedDependencies.getCwd());
      if (config.configFilePath === null) {
        throw new Error('OpenWeft is not initialized here. Run "openweft init" first.');
      }

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
        const pendingQueue = parseQueueFile(queueContent).pending.map((line) => summarizeQueueRequest(line.request));
        const phase = cp?.currentPhase
          ? `${cp.currentPhase.name} (${cp.currentPhase.featureIds.length} feature${cp.currentPhase.featureIds.length === 1 ? '' : 's'})`
          : cp?.status ?? 'idle';
        const usageLabel = config.status.usageDisplay === 'estimated-cost' ? 'Cost' : 'Tokens';
        const usageValue = cp
          ? config.status.usageDisplay === 'estimated-cost'
            ? `$${cp.cost.totalEstimatedUsd.toFixed(4)}`
            : `${cp.cost.totalInputTokens} input / ${cp.cost.totalOutputTokens} output`
          : config.status.usageDisplay === 'estimated-cost'
            ? '$0.0000'
            : '0 input / 0 output';
        const agents = cp
          ? Object.values(cp.features).map((f) => ({
              name: `${f.id} ${f.title ?? summarizeQueueRequest(f.request)}`,
              status: f.status === 'executing' ? 'running' : f.status,
            }))
          : [];
        await renderStyledOutput(
          React.createElement(StatusCard, {
            appName: 'OpenWeft',
            phase,
            usageLabel,
            usageValue,
            agents,
            pendingRequests: pendingQueue,
          })
        );
        return;
      }

      resolvedDependencies.writeLine(
        renderStatusReport({
          checkpoint: checkpointResult.checkpoint,
          checkpointSource: checkpointResult.source,
          queueContent,
          usageDisplay: config.status.usageDisplay,
          background
        }).trimEnd()
      );
    },
    stop: async () => {
      const { config } = await loadOpenWeftConfig(resolvedDependencies.getCwd());
      if (config.configFilePath === null) {
        throw new Error('OpenWeft is not initialized here. Run "openweft init" first.');
      }

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

      let terminalStateObserved: string | null = null;
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
          if (terminalStateObserved !== checkpoint.checkpoint.status) {
            terminalStateObserved = checkpoint.checkpoint.status;
            resolvedDependencies.writeLine(
              `OpenWeft run reached terminal state ${checkpoint.checkpoint.status}. Waiting for the process to exit...`
            );
          }
        }
      }

      try {
        resolvedDependencies.sendSignal(background.pid, 'SIGKILL');
      } catch {
        // process may have already exited
      }
      await rm(config.paths.pidFile, { force: true });
      resolvedDependencies.writeLine(
        `Background process ${background.pid} did not exit after SIGTERM; sent SIGKILL and removed PID file.`
      );
    }
  };

  return handlers;
};
