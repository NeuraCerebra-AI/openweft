import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import type { CommandHandlers } from './buildProgram.js';
import { ClaudeCliAdapter, CodexCliAdapter, MockAgentAdapter, createExecaCommandRunner } from '../adapters/index.js';
import type { BackendEffortLevel } from '../config/options.js';
import type { BackendDetection } from '../ui/onboarding/types.js';
import { createConfigHash, getDefaultConfig, loadOpenWeftConfig } from '../config/index.js';
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
import type { AgentStatus, UIStore } from '../ui/store.js';
import type { StoreApi } from 'zustand/vanilla';
import { ApprovalController, runDryRunOrchestration, runRealOrchestration, StopController } from '../orchestrator/index.js';
import { createDefaultNotificationDependencies } from '../notifications/index.js';
import { loadCheckpoint } from '../state/index.js';
import { buildStatusDiagnosticsLines, renderStatusReport } from '../status/renderStatus.js';
import { buildTerminalRunCopy } from '../status/terminalCopy.js';
import {
  collectRuntimeDiagnostics,
  summarizeMergeDurability
} from '../status/runtimeDiagnostics.js';
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

const STARTABLE_CHECKPOINT_STATUSES = new Set([
  'pending',
  'planned',
  'executing'
]);

const REVIEW_CHECKPOINT_STATUSES = new Set([
  'planning-needs-review',
  'adjustment-needs-review',
  'blocked-by-failed-feature'
]);

const isStartableCheckpointFeature = (feature: { status: string; rerunEligible?: boolean | null }): boolean => {
  if (STARTABLE_CHECKPOINT_STATUSES.has(feature.status)) {
    return true;
  }

  return feature.status === 'failed' && feature.rerunEligible !== false;
};

const isDisplayableCheckpointFeature = (feature: { status: string; rerunEligible?: boolean | null }): boolean => {
  return isStartableCheckpointFeature(feature) ||
    feature.status === 'failed' ||
    REVIEW_CHECKPOINT_STATUSES.has(feature.status);
};

const getCheckpointFeatureAgentStatus = (
  feature: { status: string; rerunEligible?: boolean | null }
): AgentStatus => {
  if (isStartableCheckpointFeature(feature)) {
    return 'queued';
  }

  if (feature.status === 'blocked-by-failed-feature') {
    return 'blocked';
  }

  if (REVIEW_CHECKPOINT_STATUSES.has(feature.status)) {
    return 'review';
  }

  return 'failed';
};

const getCheckpointFeatureReadyStateDetail = (
  feature: { status: string; rerunEligible?: boolean | null }
): string | null => {
  if (isStartableCheckpointFeature(feature)) {
    return 'Resumable checkpoint';
  }

  if (feature.status === 'blocked-by-failed-feature') {
    return 'Blocked by failed or review-needed work.';
  }

  if (REVIEW_CHECKPOINT_STATUSES.has(feature.status)) {
    return 'Needs operator review before OpenWeft can schedule this feature.';
  }

  if (feature.status === 'failed') {
    return 'Failed and is not eligible for automatic rerun.';
  }

  return null;
};

const UNRESOLVED_CHECKPOINT_STATUSES = new Set([
  'failed',
  'planning-needs-review',
  'adjustment-needs-review',
  'blocked-by-failed-feature'
]);

const hasLegacyPromptAContract = (content: string): boolean => {
  return (
    content.includes('saved in a `.md` file in the ./prompts folder') ||
    content.includes('Living Plan Ledger Markdown file in `./project_ledgers`')
  );
};

const hasLegacyPlanAdjustmentContract = (content: string): boolean => {
  return content.includes('update the plan file in place, including the manifest');
};

export const DEFAULT_PROMPT_A_TEMPLATE = `### Instructions for Work Brief Creation

You are the OpenWeft Brief Compiler. Your job is to transform the user's raw request into a
full **Work Brief** for the next planning agent.

Return the complete Work Brief as response text only. Do not write files, save Markdown,
call file-editing tools, or create prompt artifacts. OpenWeft will persist your response under
\`feature_requests/briefs/*.work-brief.md\`.
These no-write rules apply only to this Brief Compiler response. Do not copy them into the
Work Brief or downstream feature plan as implementation constraints. The Work Brief and plan
must allow the execution worker to make manifest-scoped file changes required by the request.

Use the repo-local OpenWeft Work Protocol as the governing contract:
\`skills/openweft-work-protocol/SKILL.md\`

When the full canonical protocol text is needed, instruct the worker to consult:
\`skills/openweft-work-protocol/references/canonical-openweft-work-protocol.md\`

### Required Work Brief Structure

The Work Brief you return must be full, detailed, and unabridged. It must follow this exact
top-level structure:

1. **Role**
2. **Goal**
3. **Pre-step private analysis instructions**
4. **General instructions**
5. **Rules**
6. **Context**

The Work Brief must also include:

- the complete user request with zero data loss,
- an Agent Investigation Dossier requirement,
- the full Living Plan Ledger requirements,
- the full debugging protocol requirement,
- Downstream Impact Review requirements,
- OpenWeft workspace ownership rules,
- validation expectations,
- the Stage 2 plan output contract requiring \`## Ledger\` and \`## Manifest\`,
- explicit instructions to update the plan ledger, not the Work Brief, during execution.

### OpenWeft Artifact Mapping

Use OpenWeft-native artifact names and destinations:

| Concept | OpenWeft artifact |
| --- | --- |
| Saved executable super prompt | Work Brief in \`feature_requests/briefs/*.work-brief.md\` |
| Living Plan Ledger | The feature plan's \`## Ledger\` section in \`feature_requests/*.md\` |
| Scheduling manifest | The feature plan's \`## Manifest\` JSON block |
| Agent Investigation Dossier | Embedded in the Work Brief and summarized in the plan \`## Ledger\` |
| Execution updates | The worktree copy of the feature plan, promoted through evolved plans |
| Durability record | \`.openweft/checkpoint.json\`, shadow plans, evolved plans, and audit trail |

Do not instruct the worker to create \`.ultra_work/\`, \`./project_ledgers/\`, extra prompt files,
sibling checkouts, ad hoc branches, or additional git worktrees.

### Codebase Investigation and Relevant Context Injection

In the Work Brief, instruct the worker that before any implementation planning or code changes,
it must investigate the actual codebase so reasoning is grounded in implementation reality.

When agent tools are available, it must launch these five roles:

- **Task-Surface Mapper**
- **Implementation or Source Inspector**
- **Validation Inspector**
- **Dependency and Documentation Inspector**
- **Risk and Downstream Inspector**

If agent tools are unavailable, it must run five named agent-equivalent passes and record that
limitation in the Work Brief and the plan ledger.

The Work Brief must require an Agent Investigation Dossier with:

- agent/pass role name,
- files/artifacts/sources inspected,
- relevant paths and line numbers where available,
- targeted snippets when useful,
- validation and testing implications,
- risks, blast radius, reversibility, and downstream implications,
- open questions or assumptions with confidence percentages where appropriate.

### Living Plan Ledger Creation Directive

The Work Brief must instruct the Stage 2 planner that **after completing the initial codebase research**,
it must use the **Plan-Creation Brainstorming Instructions** below to determine the best
implementation plan for accomplishing the goal.

It must then create the **Living Plan Ledger** inside the feature plan's \`## Ledger\` section.
It must not create a separate Living Plan Ledger Markdown file in \`./project_ledgers\`; the feature plan itself is the ledger artifact for this workflow.

The Living Plan Ledger must serve as the **canonical execution record** and **single source of
truth** for the task.

The Living Plan Ledger must contain:

- the selected implementation plan in full,
- a checklist of major steps and sub-steps,
- current execution status,
- enough detail for work to resume reliably after interruption, compaction, or context loss,
- and a structured schema for each step and sub-step.

At the top of the Living Plan Ledger, include a short instruction block stating that:

- **after every compaction, the full ledger must be reread before any further work begins**,
- the ledger is the source of truth for what has been completed, what remains, and what has
  changed,
- and the next action must be chosen only after reviewing the ledger in full.

As work proceeds, progress, decisions, discoveries, plan adjustments, and completion state must
be recorded in the ledger so execution remains recoverable, auditable, and consistent.

The \`## Ledger\` section must include the parser-compatible anchor subheadings:

- \`### Constraints\`
- \`### Assumptions\`
- \`### Watchpoints\`
- \`### Validation\`

It must also include:

- compaction/recovery instruction block,
- Agent Investigation Dossier,
- five high-level approaches with evaluation,
- five concrete implementation strategies with evaluation,
- selected plan,
- step/sub-step ledger,
- debugging protocol log,
- downstream impact review log,
- execution/change/decision log.

Each major step and sub-step must include:

- **Step ID**
- **Title**
- **Objective**
- **Why This Step Exists**
- **Dependencies**
- **Preconditions**
- **Planned Actions**
- **Risk Level** (\`Low\`, \`Medium\`, \`High\`)
- **Potential Blast Radius**
- **Rollback / Recovery Notes**
- **Validation / Completion Criteria**
- **Affected Files / Systems**
- **Downstream Steps Potentially Impacted**
- **Status** (\`Not Started\`, \`In Progress\`, \`Blocked\`, \`Complete\`)
- **Notes / Discoveries**

### Plan-Creation Brainstorming Instructions

The Work Brief must instruct the Stage 2 planner to:

1. Restate the exact objective, constraints, invariants, and non-goals.
2. Brainstorm **5 distinct high-level approaches** to accomplish the goal.
3. Evaluate each high-level approach against at minimum:
   - blast radius,
   - reversibility,
   - dependency complexity,
   - implementation effort,
   - long-term maintainability.
4. Score and select the strongest high-level approach, prioritizing low blast radius and
   architectural fit.
5. Then, based on that winning high-level approach, brainstorm **5 concrete actionable
   implementation strategies**.
6. Evaluate each implementation strategy against at minimum:
   - risk of cascading failures,
   - operational complexity,
   - implementation clarity,
   - observability and debuggability,
   - compatibility with the existing architecture.
7. Select the strongest implementation strategy with the fewest necessary file changes, lowest
   code churn, and lowest regression risk.
8. Define a file-touch budget and avoid unrelated files.
9. Write the resulting plan into the **Living Plan Ledger** using the step schema defined below.
10. Produce a diff-first patch plan before editing code.
11. Apply the smallest safe change only.
12. Validate that the issue is fixed, invariants still hold, and no unrelated behavior changed.

When constructing the plan, you must be deliberate about the **order of operations**. Sequence
the steps to minimize blast radius and prevent cascading effects.

Follow these ordering rules:

- ensure prerequisites exist before dependent steps are executed,
- place behavior-preserving preparation steps before behavior-changing steps,
- isolate high-risk changes and introduce them only after compatibility layers, scaffolding, or
  safeguards are in place,
- prefer reversible changes before irreversible ones,
- and, where appropriate, follow an **expand -> migrate -> contract** pattern.

Each step should make subsequent steps safer and easier to execute.

Before finalizing the plan, review the ordered steps and verify that no step would break,
constrain, invalidate, or destabilize a later step if executed in sequence. If it would, reorder
the plan before writing it into the ledger.

### Debugging Guidelines

The Work Brief must include the full debugging guidelines below. Keep the wording in the
\`mandatory_wording\` block exactly the same.
Use Context7 to saturate the debugging workflow with relevant documentation code snippet quotes
when framework, library, API, or protocol behavior matters.
If Context7 is unavailable, use web search restricted to official relevant documentation.

<debugging_guidelines>
<mandatory_wording>
If, during investigation or implementation, you encounter an integration failure, incorrect behavior, missing artifact, malformed output, broken downstream contract, failing test, or any situation where the correct implementation path is no longer obvious, switch into the following debugging workflow instead of making shallow guesses.
</mandatory_wording>

### Phase 1: Error Sequence Analysis
1. Trace the complete execution flow from initial input through all major components to the point where the error or incorrect behavior occurs.
2. Identify each handoff point where data, control, or state passes between functions, modules, services, or external systems.
3. Map the exact state of the system at the moment of failure (key variables, inputs, configuration, environment, and external dependencies).
4. List all assumptions the code makes about inputs, outputs, data formats, and external component behavior.
5. Enumerate all plausible reasons why the expected result might not be produced.
6. Analyze the relevant logic and control flow for ambiguities, edge cases, or missing conditions.
7. Compare the current implementation against official documentation for external APIs, libraries, frameworks, or protocols involved.
8. Identify gaps between what the code expects and what the system or dependencies guarantee.

### Phase 2: Root Cause Hypothesis Formation
1. Generate at least five distinct hypotheses.
2. Estimate probability for each hypothesis from 0-100% based on evidence.
3. Rank hypotheses by likelihood x impact.
4. Identify which hypotheses can be tested immediately and which require more setup.
5. Map dependencies between hypotheses.

### Phase 3: Fix Strategy Design
1. For the top three hypotheses, design targeted fixes or mitigations.
2. Identify potential side effects, regressions, or breaking changes.
3. Design validation tests that demonstrate each fix works.
4. Plan rollback strategies.
5. Design or refine logging/telemetry when useful.
6. Identify robustness improvements against input, configuration, or dependency variation.

### Phase 4: Implementation Planning
1. Break the chosen fix into atomic, testable changes.
2. Prioritize low-risk, high-value improvements first.
3. Identify parallelizable and sequential work.
4. Plan targeted tests and expected outcomes.
5. Define confidence thresholds.
6. Understand your eventual goal is to keep iteratively analyzing and debugging and testing and analyzing and debugging and testing until we reach ~95%+ confidence we have found the solution and it has been robustly implemented.
</debugging_guidelines>

### Downstream Impact Review Requirements

The Work Brief must instruct the worker to perform a Downstream Impact Review before marking
any major step complete.

Use **1 verification agent by default**.

Use **2 verification agents** when the completed step is high-risk, cross-cutting,
architecture-affecting, touches shared interfaces or schemas, has meaningful blast radius, or
when confidence is not high that downstream implications have been fully understood.

The review must:

- reread remaining steps and schemas,
- understand assumptions, dependencies, sequencing, and intended outcomes,
- inspect whether completed edits introduced coupling, side effects, invalidated assumptions,
  sequencing changes, or newly required work,
- determine whether future steps must be revised, reordered, expanded, split, merged, or
  replaced,
- update the \`## Ledger\` before marking the step complete if anything changed.

A major step is not truly complete until:

- its own validation criteria are satisfied,
- downstream impact has been reviewed,
- and the ledger has been updated to reflect any newly discovered implications for the remaining
  plan.

For **sub-steps**, a dedicated Downstream Impact Review is **not required by default**.

Instead, the main agent must use **risk-based judgment** to decide whether a sub-step warrants
launching a targeted verification agent. A sub-step should receive a dedicated downstream review
when it appears likely to affect later assumptions, shared system boundaries, sequencing,
implementation requirements, or the integrity of the remaining plan.

This is especially important when a sub-step touches:

- shared interfaces or contracts,
- schemas, persistence, or migrations,
- auth, permissions, or security-sensitive logic,
- build, deploy, config, or environment behavior,
- shared utilities or cross-cutting infrastructure,
- or any area where local edits may have non-local effects.

Simple, local, mechanical, or low-risk sub-steps usually do **not** require a dedicated
downstream review unless the main agent detects reason for concern.

When in doubt for a sub-step, prefer launching **1 targeted verification agent** rather than skipping review entirely.

### Risk-Scaled Execution Guardrails

The Work Brief must include these guardrails after the ledger, debugging, and downstream-review
requirements. They preserve the full protocol while scaling effort to risk.

- **Risk-scaled ledger detail:** Preserve the required \`## Ledger\` headings, manifest,
  truthfulness, and status. For low-risk, local, mechanical tasks, ledger entries may be concise:
  one or two precise bullets per relevant section is acceptable. For high-risk, cross-cutting,
  shared-interface, schema, persistence, security, config, build, deploy, or
  architecture-affecting tasks, use the full step schema and detailed downstream analysis.
- **Debugging activation threshold:** Do not activate the full debugging protocol for routine expected TDD red tests, obvious typos, straightforward compile/type errors, or a single locally understood test failure when the correct implementation path remains clear. Activate it when failure is repeated, ambiguous, integration-facing, contract-breaking, artifact-breaking, or when the correct path is no longer obvious.
- **No protocol-only failure rule:** Do not fail, skip, or abandon a feature solely because ledger, dossier, or protocol formatting is imperfect if the manifest, task, implementation path, and validation remain actionable. Repair or summarize the missing protocol record in the \`## Ledger\` and continue.
- **Documentation lookup scope gate:** Use repo evidence first. Use Context7 or official web docs only when external framework, library, API, or protocol behavior materially affects the implementation or debugging decision. Pure repo logic, local business rules, and obvious syntax errors do not require external docs lookup.
- **Sub-step review throttle:** For simple, local, mechanical, or low-risk sub-steps, record a brief self-check in the ledger instead of launching verification agents. Launch a targeted verification agent only when the sub-step could change later assumptions, shared contracts, sequencing, implementation requirements, or remaining-plan integrity.

### Workspace Ownership Rules

The Work Brief must explicitly instruct the worker:

1. Workspace creation and git topology are owned by OpenWeft.
2. Use the current assigned repository/worktree as the only workspace.
3. Do not create additional git worktrees.
4. Do not clone the repository elsewhere.
5. Do not create or switch to ad hoc branches unless explicitly instructed by OpenWeft.
6. Do not relocate the task into another checkout or sibling repository.
7. Any file path required by the active task, workflow, config, Work Brief, plan, established
   repository convention, or direct user instruction is authoritative.

### Stage 2 Output Contract

The Work Brief must tell the Stage 2 planner to return one full Markdown feature plan as
response text. The planner must not write files. OpenWeft will save the returned plan.
Those no-write rules apply only to the Stage 2 planning response. The returned plan must not
tell the execution worker to stay read-only or avoid implementation. It must describe the
smallest safe manifest-scoped implementation.

The plan must include:

- a \`## Ledger\` section satisfying the Living Plan Ledger requirements,
- a \`## Manifest\` heading with a fenced \`json\` or \`json manifest\` code block,
- a manifest shaped exactly as \`{ "create": [], "modify": [], "delete": [] }\`,
- conservative file paths that reflect likely implementation scope.

### First Draft Request

<first_draft_prompt>
{{USER_REQUEST}}
</first_draft_prompt>
`;

export const DEFAULT_PLAN_ADJUSTMENT_TEMPLATE = `Review these merged edits:
<CODE_EDIT_SUMMARY>
{{CODE_EDIT_SUMMARY}}
</CODE_EDIT_SUMMARY>

Perform a Downstream Impact Review against the referenced feature plan.

This is a read-only adjustment step. Do not modify source files.
This read-only rule applies only to this adjustment response. Do not add it as an
implementation constraint in the returned plan; future execution must still be allowed to
make manifest-scoped file changes.

Inspect whether the merged edits affect:

- the plan's \`## Ledger\`,
- constraints,
- assumptions,
- watchpoints,
- validation requirements,
- remaining step order,
- downstream implementation scope,
- or the \`## Manifest\` file boundaries.

If the merged edits matter, return the full updated plan Markdown. Preserve the complete
\`## Ledger\`, including the OpenWeft Work Protocol sections, and preserve or update the
\`## Manifest\` as needed.

If the merged edits do not materially affect the plan, return the full unchanged plan Markdown.

Never drop the \`## Ledger\` section, the parser-compatible ledger anchor headings, or the
\`## Manifest\` section.
`;
export const DEFAULT_WORK_PROTOCOL_SKILL_TEMPLATE = `---
name: openweft-work-protocol
description: Use when authoring or executing OpenWeft Work Briefs, feature plans, Living Plan Ledgers, downstream impact reviews, conflict-resolution briefs, or planning prompts for OpenWeft. This is the repo-native worker protocol.
version: "1.0.0"
---

# OpenWeft Work Protocol

## Overview

The OpenWeft Work Protocol is the full-diligence operating contract for OpenWeft workers.
It preserves the deep planning, investigation, ledger, debugging, and downstream-review
discipline of the original strict workflow, but maps every artifact into OpenWeft's own
runtime model.

OpenWeft owns persistence, worktrees, branches, checkpointing, cleanup, merge order, and
re-analysis. The worker owns investigation, planning, implementation, validation, and
truthful ledger maintenance inside the assigned workspace.

## Artifact Mapping

Use these OpenWeft-native artifacts:

| Protocol concept | OpenWeft artifact |
| --- | --- |
| Saved executable super prompt | Work Brief in \`feature_requests/briefs/*.work-brief.md\` |
| Living Plan Ledger | The feature plan's \`## Ledger\` section in \`feature_requests/*.md\` |
| Scheduling manifest | The feature plan's \`## Manifest\` JSON block |
| Agent Investigation Dossier | Embedded in the Work Brief and summarized in the plan \`## Ledger\` |
| Execution updates | The worktree copy of the feature plan, promoted through evolved plans |
| Durability record | \`.openweft/checkpoint.json\`, shadow plans, evolved plans, and audit trail |

Do not create independent \`.ultra_work/\`, \`./project_ledgers/\`, extra prompt files, sibling
checkouts, ad hoc branches, or additional git worktrees. Those would split the source of truth.

## Required Work Brief Shape

Every Work Brief must be a full operating document with these top-level sections:

1. **Role**
2. **Goal**
3. **Pre-step private analysis instructions**
4. **General instructions**
5. **Rules**
6. **Context**

The Work Brief must also include:

- the complete user request with zero data loss,
- an Agent Investigation Dossier,
- the full Living Plan Ledger requirements,
- the full debugging protocol from the canonical reference,
- Downstream Impact Review requirements,
- workspace ownership rules,
- validation expectations,
- the Stage 2 plan output contract requiring \`## Ledger\` and \`## Manifest\`,
- explicit instructions to update the plan ledger, not the Work Brief, during execution.

Planning-only no-write or read-only instructions must stay scoped to planning responses.
Do not copy them into the Work Brief or feature plan as implementation constraints. The
execution worker must be allowed to make the manifest-scoped file changes required by the
user request.

When a Work Brief asks for deep reasoning, require private analysis and visible evidence
summaries. The worker should expose decisions, assumptions, confidence levels, validation
evidence, and rationale summaries without dumping hidden chain-of-thought.

## Required Planning Flow

Before any implementation plan or code change, the worker must investigate the task surface.
When agent tools are available, launch these five roles:

- **Task-Surface Mapper**: identify relevant repo artifacts, source files, docs, task
  boundaries, and likely entry points.
- **Implementation or Source Inspector**: inspect relevant implementation material and return
  paths, line numbers, snippets, constraints, and likely problem surfaces.
- **Validation Inspector**: identify tests, QA checks, acceptance criteria, reproduction
  steps, source-verification needs, and artifact validation methods.
- **Dependency and Documentation Inspector**: identify framework, API, library, policy, or
  standards docs needed for correctness.
- **Risk and Downstream Inspector**: identify blast radius, reversibility, hidden coupling,
  sequencing hazards, rollback paths, and review concerns.

If agent tools are unavailable, run five named agent-equivalent passes and record that
limitation in the Work Brief and the plan ledger.

## Agent Investigation Dossier

The dossier must include:

- role name for each agent or pass,
- inspected files, artifacts, docs, or sources,
- relevant paths and line numbers where available,
- targeted snippets when useful,
- validation implications,
- risks, blast radius, reversibility, and downstream implications,
- open questions or assumptions with confidence percentages where appropriate.

## Living Plan Ledger Requirements

The worker must, after completing the initial codebase research, use the Plan-Creation
Brainstorming Instructions below to determine the best implementation plan for accomplishing
the goal.

Then create the **Living Plan Ledger** inside the feature plan's \`## Ledger\` section. It must not create a separate Living Plan Ledger Markdown file in \`./project_ledgers\`; the feature plan itself is the ledger artifact for this workflow.

The Living Plan Ledger must serve as the **canonical execution record** and **single source of
truth** for the task.

The Living Plan Ledger must contain:

- the selected implementation plan in full,
- a checklist of major steps and sub-steps,
- current execution status,
- enough detail for work to resume reliably after interruption, compaction, or context loss,
- and a structured schema for each step and sub-step.

At the top of the Living Plan Ledger, include a short instruction block stating that:

- **after every compaction, the full ledger must be reread before any further work begins**,
- the ledger is the source of truth for what has been completed, what remains, and what has
  changed,
- and the next action must be chosen only after reviewing the ledger in full.

As work proceeds, progress, decisions, discoveries, plan adjustments, and completion state must
be recorded in the ledger so execution remains recoverable, auditable, and consistent.

The Stage 2 plan must contain a \`## Ledger\` section. That section is the Living Plan Ledger and
must include the four parser-compatible anchor subheadings:

- \`### Constraints\`
- \`### Assumptions\`
- \`### Watchpoints\`
- \`### Validation\`

It must also include:

- compaction/recovery instruction block,
- Agent Investigation Dossier,
- five high-level approaches with evaluation,
- five concrete implementation strategies with evaluation,
- selected plan,
- step/sub-step ledger,
- debugging protocol log,
- downstream impact review log,
- execution/change/decision log.

Each major step and sub-step must include:

- Step ID
- Title
- Objective
- Why This Step Exists
- Dependencies
- Preconditions
- Planned Actions
- Risk Level (\`Low\`, \`Medium\`, \`High\`)
- Potential Blast Radius
- Rollback / Recovery Notes
- Validation / Completion Criteria
- Affected Files / Systems
- Downstream Steps Potentially Impacted
- Status (\`Not Started\`, \`In Progress\`, \`Blocked\`, \`Complete\`)
- Notes / Discoveries

## Plan Creation Requirements

After investigation, the worker must:

1. Restate the exact objective, constraints, invariants, and non-goals.
2. Brainstorm **5 distinct high-level approaches** to accomplish the goal.
3. Evaluate each high-level approach against at minimum:
   - blast radius,
   - reversibility,
   - dependency complexity,
   - implementation effort,
   - long-term maintainability.
4. Score and select the strongest high-level approach, prioritizing low blast radius and
   architectural fit.
5. Then, based on that winning high-level approach, brainstorm **5 concrete actionable
   implementation strategies**.
6. Evaluate each implementation strategy against at minimum:
   - risk of cascading failures,
   - operational complexity,
   - implementation clarity,
   - observability and debuggability,
   - compatibility with the existing architecture.
7. Select the strongest implementation strategy with the fewest necessary file changes, lowest
   code churn, and lowest regression risk.
8. Define a file-touch budget and avoid unrelated files.
9. Write the resulting plan into the **Living Plan Ledger** using the step schema defined below.
10. Produce a diff-first patch plan before editing code.
11. Apply the smallest safe change only.
12. Validate that the issue is fixed, invariants still hold, and no unrelated behavior changed.

When constructing the plan, you must be deliberate about the **order of operations**. Sequence
the steps to minimize blast radius and prevent cascading effects.

Follow these ordering rules:

- ensure prerequisites exist before dependent steps are executed,
- place behavior-preserving preparation steps before behavior-changing steps,
- isolate high-risk changes and introduce them only after compatibility layers, scaffolding, or
  safeguards are in place,
- prefer reversible changes before irreversible ones,
- and, where appropriate, follow an **expand -> migrate -> contract** pattern.

Each step should make subsequent steps safer and easier to execute.

Before finalizing the plan, review the ordered steps and verify that no step would break,
constrain, invalidate, or destabilize a later step if executed in sequence. If it would, reorder
the plan before writing it into the ledger.

When returning the feature plan, the worker must not write files during that planning turn,
but the plan itself must describe the implementation work to be done. It must not tell the
execution worker to remain read-only or avoid implementation.

## Debugging Protocol

The Work Brief must include the full debugging protocol from
\`references/canonical-openweft-work-protocol.md\`, including this mandatory wording exactly:

\`\`\`text
If, during investigation or implementation, you encounter an integration failure, incorrect behavior, missing artifact, malformed output, broken downstream contract, failing test, or any situation where the correct implementation path is no longer obvious, switch into the following debugging workflow instead of making shallow guesses.
\`\`\`

## Downstream Impact Review

Before marking a major step complete, the worker must perform a Downstream Impact Review.
Use one dedicated reviewer by default. Use two when the step is high-risk, cross-cutting,
architecture-affecting, touches shared interfaces/schemas, has meaningful blast radius, or
confidence is not high.

The review must inspect whether completed work changes assumptions, dependencies, step order,
validation requirements, manifests, or implementation scope. If it does, update the \`## Ledger\`
before marking the step complete.

If the completed work changes the conditions under which later steps were originally planned,
or reveals that the broader remaining plan or ledger structure no longer reflects current
reality, the **Living Plan Ledger** must be updated to reflect the latest reality **before**
the current major step is marked complete.

A major step is not truly complete until:

- its own validation criteria are satisfied,
- downstream impact has been reviewed,
- and the ledger has been updated to reflect any newly discovered implications for the remaining
  plan.

For **sub-steps**, a dedicated Downstream Impact Review is **not required by default**.

Instead, the main agent must use **risk-based judgment** to decide whether a sub-step warrants
launching a targeted verification agent. A sub-step should receive a dedicated downstream review
when it appears likely to affect later assumptions, shared system boundaries, sequencing,
implementation requirements, or the integrity of the remaining plan.

This is especially important when a sub-step touches:

- shared interfaces or contracts,
- schemas, persistence, or migrations,
- auth, permissions, or security-sensitive logic,
- build, deploy, config, or environment behavior,
- shared utilities or cross-cutting infrastructure,
- or any area where local edits may have non-local effects.

Simple, local, mechanical, or low-risk sub-steps usually do **not** require a dedicated
downstream review unless the main agent detects reason for concern.

When in doubt for a sub-step, prefer launching **1 targeted verification agent** rather than skipping review entirely.

## Risk-Scaled Execution Guardrails

These guardrails preserve the full protocol while scaling effort to risk.

- **Risk-scaled ledger detail:** Preserve the required \`## Ledger\` headings, manifest,
  truthfulness, and status. For low-risk, local, mechanical tasks, ledger entries may be concise:
  one or two precise bullets per relevant section is acceptable. For high-risk, cross-cutting,
  shared-interface, schema, persistence, security, config, build, deploy, or
  architecture-affecting tasks, use the full step schema and detailed downstream analysis.
- **Debugging activation threshold:** Do not activate the full debugging protocol for routine expected TDD red tests, obvious typos, straightforward compile/type errors, or a single locally understood test failure when the correct implementation path remains clear. Activate it when failure is repeated, ambiguous, integration-facing, contract-breaking, artifact-breaking, or when the correct path is no longer obvious.
- **No protocol-only failure rule:** Do not fail, skip, or abandon a feature solely because ledger, dossier, or protocol formatting is imperfect if the manifest, task, implementation path, and validation remain actionable. Repair or summarize the missing protocol record in the \`## Ledger\` and continue.
- **Documentation lookup scope gate:** Use repo evidence first. Use Context7 or official web docs only when external framework, library, API, or protocol behavior materially affects the implementation or debugging decision. Pure repo logic, local business rules, and obvious syntax errors do not require external docs lookup.
- **Sub-step review throttle:** For simple, local, mechanical, or low-risk sub-steps, record a brief self-check in the ledger instead of launching verification agents. Launch a targeted verification agent only when the sub-step could change later assumptions, shared contracts, sequencing, implementation requirements, or remaining-plan integrity.

## Validation

Hard runtime gates:

- Work Brief exists.
- Feature plan exists.
- Plan has a \`## Ledger\`.
- Ledger has the parser-compatible anchor headings.
- Plan has a parseable \`## Manifest\`.

Protocol completeness issues should be repaired through planning or adjustment turns before
skipping a feature. Do not turn every formatting imperfection into a whole-run stop.

## Canonical Reference

When authoring or refreshing the full Work Brief contract, read
\`references/canonical-openweft-work-protocol.md\`. Keep this \`SKILL.md\` focused on routing and
artifact mapping; keep the full protocol text in the reference.`;

export const DEFAULT_WORK_PROTOCOL_CANONICAL_REFERENCE_TEMPLATE = `# Canonical OpenWeft Work Protocol

This reference is the full protocol payload used to author OpenWeft Work Briefs and feature
plans. It keeps the high-diligence workflow intact while mapping every artifact to OpenWeft's
runtime model.

## Role

You are an OpenWeft worker operating inside a repository or worktree assigned by the
OpenWeft orchestrator. You are responsible for careful investigation, plan creation,
implementation, validation, ledger maintenance, and downstream impact review.

OpenWeft owns git topology, branch creation, worktree creation, checkpointing, prompt and plan
persistence, merge order, cleanup, and crash recovery. You do not create or switch branches,
clone repositories, create sibling checkouts, create additional git worktrees, or relocate the
task.

## Goal

Complete the assigned feature request safely and completely within the assigned workspace.
Maintain a truthful Living Plan Ledger in the feature plan's \`## Ledger\` section. Preserve a
parseable \`## Manifest\` so OpenWeft can schedule, merge, and re-analyze work.

## Pre-Step Private Analysis Instructions

Before planning or editing:

1. Read the Work Brief, user request, feature plan, and relevant repo instructions.
2. Identify objective, constraints, invariants, non-goals, and file-touch budget.
3. Investigate the actual codebase before assuming architecture or behavior.
4. Use private analysis for complex reasoning, but expose concise evidence summaries,
   confidence levels, assumptions, and decisions in the ledger.
5. If the correct path becomes unclear, enter the debugging protocol below.

## General Instructions

1. Treat the Work Brief as the immutable operating brief.
2. Treat the feature plan's \`## Ledger\` as the Living Plan Ledger and single source of truth.
3. Update only the plan ledger during execution; do not modify the Work Brief.
4. Keep all code changes scoped to the request, manifest, and proven downstream needs.
5. Prefer small, reversible, reviewable changes.
6. Run targeted tests after meaningful edit groups.
7. Record discoveries, validation, risk changes, downstream impact, and completion status in
   the ledger.
8. Preserve the \`## Manifest\` JSON block and keep file paths conservative and truthful.

## Rules

1. Do not create \`.ultra_work/\`, \`./project_ledgers/\`, extra prompt files, alternate ledgers,
   sibling checkouts, ad hoc branches, or additional git worktrees.
2. Do not rely on generic Markdown placement rules when OpenWeft artifact paths are already
   authoritative.
3. Do not mark a major step complete until validation and downstream impact review are done.
4. Do not broaden implementation scope unless a concrete dependency or downstream requirement
   proves it is necessary.
5. Do not hide tool limitations. If agents, docs, validators, or expected commands are
   unavailable, record the limitation and the chosen fallback.
6. Do not leave the ledger stale after implementation or validation discoveries.

## Context

OpenWeft uses this artifact chain:

\`\`\`text
Raw request
  -> Brief Compiler
  -> Work Brief
  -> Feature Plan
  -> ## Ledger + ## Manifest
  -> Execution
  -> Merge
  -> Re-analysis
\`\`\`

The Work Brief is saved by OpenWeft under \`feature_requests/briefs/*.work-brief.md\`.
The feature plan is saved under \`feature_requests/*.md\`.
The plan's \`## Ledger\` is the Living Plan Ledger.
The plan's \`## Manifest\` is the scheduling contract.

## Agentized Investigation

Before plan creation or implementation, run a five-role investigation when agent tooling is
available:

| Role | Required output |
| --- | --- |
| Task-Surface Mapper | Relevant files, docs, artifacts, task boundaries, likely entry points |
| Implementation or Source Inspector | Paths, line numbers, snippets, constraints, likely problem surfaces |
| Validation Inspector | Tests, QA checks, reproduction steps, acceptance criteria, validation commands |
| Dependency and Documentation Inspector | Framework/API/library/policy docs and source-verification needs |
| Risk and Downstream Inspector | Blast radius, reversibility, hidden coupling, sequencing hazards, rollback paths |

If agents are unavailable, perform five named agent-equivalent passes. Record the limitation
and the passes in the Work Brief and plan ledger.

## Agent Investigation Dossier

The dossier must include:

- agent/pass role name,
- files/artifacts/sources inspected,
- relevant paths and line numbers where available,
- targeted snippets when useful,
- documentation/source citations when applicable,
- validation and testing implications,
- risks, blast radius, reversibility, and downstream implications,
- open questions or assumptions with confidence percentages where appropriate.

## Living Plan Ledger

The worker must, after completing the initial codebase research, use the Plan-Creation
Brainstorming Instructions below to determine the best implementation plan for accomplishing
the goal.

Then create the **Living Plan Ledger** inside the feature plan's \`## Ledger\` section. It must not create a separate Living Plan Ledger Markdown file in \`./project_ledgers\`; the feature plan itself is the ledger artifact for this workflow.

The Living Plan Ledger must serve as the **canonical execution record** and **single source of
truth** for the task.

The Living Plan Ledger must contain:

- the selected implementation plan in full,
- a checklist of major steps and sub-steps,
- current execution status,
- enough detail for work to resume reliably after interruption, compaction, or context loss,
- and a structured schema for each step and sub-step.

At the top of the Living Plan Ledger, include a short instruction block stating that:

- **after every compaction, the full ledger must be reread before any further work begins**,
- the ledger is the source of truth for what has been completed, what remains, and what has
  changed,
- and the next action must be chosen only after reviewing the ledger in full.

As work proceeds, progress, decisions, discoveries, plan adjustments, and completion state must
be recorded in the ledger so execution remains recoverable, auditable, and consistent.

The Stage 2 plan must contain:

\`\`\`markdown
## Ledger

### Compaction Recovery Instruction

### Constraints

### Assumptions

### Watchpoints

### Validation

### Agent Investigation Dossier

### High-Level Approach Evaluation

### Implementation Strategy Evaluation

### Selected Plan

### Step Ledger

### Debugging Protocol Log

### Downstream Impact Review Log

### Execution Log

## Manifest
\`\`\`

The four anchor headings \`Constraints\`, \`Assumptions\`, \`Watchpoints\`, and \`Validation\` are
required for OpenWeft parser compatibility. Additional sections make the ledger useful for
resumability and review.

Each major step and sub-step must include:

- Step ID
- Title
- Objective
- Why This Step Exists
- Dependencies
- Preconditions
- Planned Actions
- Risk Level (\`Low\`, \`Medium\`, \`High\`)
- Potential Blast Radius
- Rollback / Recovery Notes
- Validation / Completion Criteria
- Affected Files / Systems
- Downstream Steps Potentially Impacted
- Status (\`Not Started\`, \`In Progress\`, \`Blocked\`, \`Complete\`)
- Notes / Discoveries

## Plan-Creation Brainstorming Instructions

Before implementation:

1. Restate the exact objective, constraints, invariants, and non-goals.
2. Brainstorm **5 distinct high-level approaches** to accomplish the goal.
3. Evaluate each high-level approach against at minimum:
   - blast radius,
   - reversibility,
   - dependency complexity,
   - implementation effort,
   - long-term maintainability.
4. Score and select the strongest high-level approach, prioritizing lowest blast radius and
   smallest architectural disruption.
5. Then, based on that winning high-level approach, brainstorm **5 concrete actionable
   implementation strategies**.
6. Evaluate each implementation strategy against at minimum:
   - risk of cascading failures,
   - operational complexity,
   - implementation clarity,
   - observability and debuggability,
   - compatibility with the existing architecture.
7. Select the strongest implementation strategy with the fewest necessary file changes, lowest
   code churn, and lowest regression risk.
8. Define a file-touch budget and avoid unrelated files.
9. Write the resulting plan into the **Living Plan Ledger** using the step schema defined below.
10. Produce a diff-first patch plan before editing code.
11. Apply the smallest safe change only.
12. Validate that the issue is fixed, invariants still hold, and no unrelated behavior changed.

When constructing the plan, you must be deliberate about the **order of operations**. Sequence
the steps to minimize blast radius and prevent cascading effects.

Follow these ordering rules:

- ensure prerequisites exist before dependent steps are executed,
- place behavior-preserving preparation steps before behavior-changing steps,
- isolate high-risk changes and introduce them only after compatibility layers, scaffolding, or
  safeguards are in place,
- prefer reversible changes before irreversible ones,
- and, where appropriate, follow an **expand -> migrate -> contract** pattern.

Each step should make subsequent steps safer and easier to execute.

Before finalizing the plan, review the ordered steps and verify that no step would break,
constrain, invalidate, or destabilize a later step if executed in sequence. If it would, reorder
the plan before writing it into the ledger.

## Debugging Guidelines

Keep the words in the \`mandatory_wording\` block exactly the same.
Use Context7 to saturate the debugging workflow with relevant documentation code snippet quotes
when framework, library, API, or protocol behavior matters.
If Context7 is unavailable, use web search restricted to official relevant documentation.

<debugging_guidelines>
<mandatory_wording>
If, during investigation or implementation, you encounter an integration failure, incorrect behavior, missing artifact, malformed output, broken downstream contract, failing test, or any situation where the correct implementation path is no longer obvious, switch into the following debugging workflow instead of making shallow guesses.
</mandatory_wording>

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
2. For each hypothesis, estimate probability (0-100%) based on evidence from logs, code inspection, and observed behavior.
3. Rank hypotheses by likelihood x impact (how likely they are and how severely they affect the system).
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

## Downstream Impact Review

Before marking a major step complete:

1. Re-read the remaining planned steps and their schemas.
2. Understand assumptions, dependencies, sequencing, and intended outcomes.
3. Inspect whether completed edits introduced unexpected coupling, side effects, invalidated
   assumptions, sequencing changes, or newly required work.
4. Determine whether future steps must be revised, reordered, expanded, split, merged, or
   replaced.
5. Assess whether the remaining plan and ledger still reflect the best current path.
6. Update the \`## Ledger\` before marking the step complete if the review changes anything.

Use one dedicated verification agent by default. Use two when the step is high-risk,
cross-cutting, architecture-affecting, touches shared interfaces/schemas, has meaningful
blast radius, or confidence is not high.

If the completed work changes the conditions under which later steps were originally planned,
or reveals that the broader remaining plan or ledger structure no longer reflects current
reality, the **Living Plan Ledger** must be updated to reflect the latest reality **before**
the current major step is marked complete.

A major step is not truly complete until:

- its own validation criteria are satisfied,
- downstream impact has been reviewed,
- and the ledger has been updated to reflect any newly discovered implications for the remaining
  plan.

For **sub-steps**, a dedicated Downstream Impact Review is **not required by default**.

Instead, the main agent must use **risk-based judgment** to decide whether a sub-step warrants
launching a targeted verification agent. A sub-step should receive a dedicated downstream review
when it appears likely to affect later assumptions, shared system boundaries, sequencing,
implementation requirements, or the integrity of the remaining plan.

This is especially important when a sub-step touches:

- shared interfaces or contracts,
- schemas, persistence, or migrations,
- auth, permissions, or security-sensitive logic,
- build, deploy, config, or environment behavior,
- shared utilities or cross-cutting infrastructure,
- or any area where local edits may have non-local effects.

Simple, local, mechanical, or low-risk sub-steps usually do **not** require a dedicated
downstream review unless the main agent detects reason for concern.

When in doubt for a sub-step, prefer launching **1 targeted verification agent** rather than skipping review entirely.

## Risk-Scaled Execution Guardrails

These guardrails preserve the full protocol while scaling effort to risk.

- **Risk-scaled ledger detail:** Preserve the required \`## Ledger\` headings, manifest,
  truthfulness, and status. For low-risk, local, mechanical tasks, ledger entries may be concise:
  one or two precise bullets per relevant section is acceptable. For high-risk, cross-cutting,
  shared-interface, schema, persistence, security, config, build, deploy, or
  architecture-affecting tasks, use the full step schema and detailed downstream analysis.
- **Debugging activation threshold:** Do not activate the full debugging protocol for routine expected TDD red tests, obvious typos, straightforward compile/type errors, or a single locally understood test failure when the correct implementation path remains clear. Activate it when failure is repeated, ambiguous, integration-facing, contract-breaking, artifact-breaking, or when the correct path is no longer obvious.
- **No protocol-only failure rule:** Do not fail, skip, or abandon a feature solely because ledger, dossier, or protocol formatting is imperfect if the manifest, task, implementation path, and validation remain actionable. Repair or summarize the missing protocol record in the \`## Ledger\` and continue.
- **Documentation lookup scope gate:** Use repo evidence first. Use Context7 or official web docs only when external framework, library, API, or protocol behavior materially affects the implementation or debugging decision. Pure repo logic, local business rules, and obvious syntax errors do not require external docs lookup.
- **Sub-step review throttle:** For simple, local, mechanical, or low-risk sub-steps, record a brief self-check in the ledger instead of launching verification agents. Launch a targeted verification agent only when the sub-step could change later assumptions, shared contracts, sequencing, implementation requirements, or remaining-plan integrity.

## Stage 2 Output Contract

The plan-generation turn must return one complete Markdown feature plan as response text. It
must not write files. OpenWeft will save the returned text.
Those no-write rules apply only to the Stage 2 planning response. The returned plan must not
tell the execution worker to stay read-only or avoid implementation. It must describe the
smallest safe manifest-scoped implementation.

The returned plan must include:

- a \`## Ledger\` section satisfying the Living Plan Ledger requirements,
- a \`## Manifest\` section with a \`json\` or \`json manifest\` fenced code block,
- a manifest shaped exactly as \`{ "create": [], "modify": [], "delete": [] }\`,
- conservative file paths that reflect likely implementation scope.

## Execution Contract

During execution:

- Follow the Work Brief.
- Use the feature plan as the Living Plan Ledger.
- If the Work Brief or plan contains read-only/no-write language meant for planning, treat it
  as planning-stage-only and still implement the manifest-scoped change.
- Update only the plan ledger, not the Work Brief.
- Run the validation listed in the plan.
- Invoke the debugging protocol when needed.
- Record downstream impact review before closing major steps.
- Keep changes scoped and reversible.`;


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

const formatCleanupSummary = (
  action: 'cleaned' | 'preserved' | 'nothing-to-clean' | 'cleanup-failed'
): string => {
  switch (action) {
    case 'cleaned':
      return 'codex-home cleaned';
    case 'preserved':
      return 'codex-home preserved';
    case 'cleanup-failed':
      return 'codex-home cleanup failed';
    default:
      return 'codex-home already absent';
  }
};

const formatRunTerminalLabel = (status: string): string => {
  switch (status) {
    case 'failed':
      return 'Run failed';
    case 'paused':
      return 'Run paused';
    case 'stopped':
      return 'Run stopped';
    default:
      return 'Run complete';
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

const applyStartModelOverrides = (
  config: ResolvedOpenWeftConfig,
  overrides: {
    model?: string;
    effort?: string;
  }
): ResolvedOpenWeftConfig => {
  const model = overrides.model?.trim();
  const effort = overrides.effort?.trim();

  if (!model && !effort) {
    return config;
  }

  if (config.backend === 'claude') {
    return {
      ...config,
      models: {
        ...config.models,
        ...(model ? { claude: model } : {})
      },
      effort: {
        ...config.effort,
        ...(effort ? { claude: effort as typeof config.effort.claude } : {})
      }
    };
  }

  return {
    ...config,
    models: {
      ...config.models,
      ...(model ? { codex: model } : {})
    },
    effort: {
      ...config.effort,
      ...(effort ? { codex: effort as typeof config.effort.codex } : {})
    }
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
        ...(result.finalizationSummary
          ? {
              finalHead: result.finalizationSummary.finalHead,
              durabilitySummary: summarizeMergeDurability(result.finalizationSummary.mergeDurability),
              cleanupSummary: formatCleanupSummary(result.finalizationSummary.runtimeCleanup.action)
            }
          : {})
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
          isDisplayableCheckpointFeature(feature)
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
                if (!isDisplayableCheckpointFeature(feature)) {
                  continue;
                }
                store.getState().addAgent({
                  id: feature.id,
                  name: feature.title ?? summarizeQueueRequest(feature.request),
                  feature: feature.title ?? summarizeQueueRequest(feature.request),
                  status: getCheckpointFeatureAgentStatus(feature),
                  removable: false,
                  readyStateDetail: getCheckpointFeatureReadyStateDetail(feature),
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
      const workProtocolSkillPath = path.join(cwd, 'skills', 'openweft-work-protocol', 'SKILL.md');
      const workProtocolReferencePath = path.join(
        cwd,
        'skills',
        'openweft-work-protocol',
        'references',
        'canonical-openweft-work-protocol.md'
      );

      await ensureRuntimeDirectories(runtimePaths);
      await ensureQueueFile(runtimePaths.queueFile);
      await ensureDirectory(path.dirname(runtimePaths.promptA));
      await ensureDirectory(path.dirname(runtimePaths.planAdjustment));
      await ensureDirectory(path.dirname(workProtocolSkillPath));
      await ensureDirectory(path.dirname(workProtocolReferencePath));

      const createdPromptA = await ensureStarterFile(
        runtimePaths.promptA,
        DEFAULT_PROMPT_A_TEMPLATE
      );
      const createdPlanAdjustment = await ensureStarterFile(
        runtimePaths.planAdjustment,
        DEFAULT_PLAN_ADJUSTMENT_TEMPLATE
      );
      const createdWorkProtocolSkill = await ensureStarterFile(
        workProtocolSkillPath,
        DEFAULT_WORK_PROTOCOL_SKILL_TEMPLATE
      );
      const createdWorkProtocolReference = await ensureStarterFile(
        workProtocolReferencePath,
        DEFAULT_WORK_PROTOCOL_CANONICAL_REFERENCE_TEMPLATE
      );

      if (!createdPromptA) {
        const existingPromptA = await readTextFileIfExists(runtimePaths.promptA);
        if (existingPromptA && hasLegacyPromptAContract(existingPromptA)) {
          resolvedDependencies.writeLine(
            'Warning: existing prompts/prompt-a.md appears to contain legacy Work Brief file-writing instructions; OpenWeft kept it, but Work Brief runs may be cleaner if you refresh it.'
          );
        }
      }

      if (!createdPlanAdjustment) {
        const existingPlanAdjustment = await readTextFileIfExists(runtimePaths.planAdjustment);
        if (existingPlanAdjustment && hasLegacyPlanAdjustmentContract(existingPlanAdjustment)) {
          resolvedDependencies.writeLine(
            'Warning: existing prompts/plan-adjustment.md appears to contain legacy in-place adjustment instructions; OpenWeft kept it, but Work Brief re-analysis expects returned plan markdown.'
          );
        }
      }

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
        `Work protocol: skill=${createdWorkProtocolSkill ? 'created' : 'kept'}, reference=${createdWorkProtocolReference ? 'created' : 'kept'}`
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
        model?: string;
        effort?: string;
      };

      const loadedConfig = await loadOpenWeftConfig(resolvedDependencies.getCwd());
      const config = applyStartModelOverrides(loadedConfig.config, {
        ...(options.model ? { model: options.model } : {}),
        ...(options.effort ? { effort: options.effort } : {})
      });
      const configHash = config === loadedConfig.config
        ? loadedConfig.configHash
        : createConfigHash(config);
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
          `► Backgrounded (PID ${readyPid}). Use 'openweft status' to check progress; raw output is in .openweft/output.log.`
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
                if (!isDisplayableCheckpointFeature(feature)) {
                  continue;
                }
                store.getState().addAgent({
                  id: feature.id,
                  name: feature.title ?? summarizeQueueRequest(feature.request),
                  feature: feature.title ?? summarizeQueueRequest(feature.request),
                  status: getCheckpointFeatureAgentStatus(feature),
                  removable: false,
                  readyStateDetail: getCheckpointFeatureReadyStateDetail(feature),
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
          resolvedDependencies.writeLine('Stop requested. OpenWeft will stop at the next phase-safe checkpoint.');
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
          const failedCount = Object.values(result.checkpoint.features).filter(
            (feature) => UNRESOLVED_CHECKPOINT_STATUSES.has(feature.status)
          ).length;

          resolvedDependencies.writeLine(
            result.checkpoint.status === 'failed'
              ? `Dry run failed: planned ${result.plannedCount}, completed ${result.completedCount}, failed/review ${failedCount}.`
              : `Dry run complete: planned ${result.plannedCount}, completed ${result.completedCount}.`
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

        const terminalLabel = formatRunTerminalLabel(result.checkpoint.status);
        resolvedDependencies.writeLine(
          result.finalizationSummary
            ? `${terminalLabel}: planned ${result.plannedCount}, merged ${result.mergedCount}, status ${result.checkpoint.status}, head ${result.finalizationSummary.finalHead ?? 'unknown'}, durability ${summarizeMergeDurability(result.finalizationSummary.mergeDurability)}, ${formatCleanupSummary(result.finalizationSummary.runtimeCleanup.action)}.`
            : `${terminalLabel}: planned ${result.plannedCount}, merged ${result.mergedCount}, status ${result.checkpoint.status}.`
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
      const diagnostics = await collectRuntimeDiagnostics({
        repoRoot: config.repoRoot,
        checkpointFile: config.paths.checkpointFile,
        checkpointBackupFile: config.paths.checkpointBackupFile,
        codexHomeDir: config.paths.codexHomeDir,
        completedFeatures: Object.values(checkpointResult.checkpoint?.features ?? {}).filter(
          (feature) => feature.status === 'completed'
        )
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
        const usageLabel = 'Tokens';
        const usageValue = cp
          ? `${cp.cost.totalInputTokens} input / ${cp.cost.totalOutputTokens} output`
          : '0 input / 0 output';
        const agents = cp
          ? Object.values(cp.features).map((f) => ({
              name: `${f.id} ${f.title ?? summarizeQueueRequest(f.request)}`,
              status: f.status === 'executing' ? 'running' : f.status,
            }))
          : [];
        const runCopy = buildTerminalRunCopy({
          checkpoint: cp ?? null,
          checkpointSource: checkpointResult.source,
          pendingQueueCount: pendingQueue.length,
          diagnostics,
          background
        });
        await renderStyledOutput(
          React.createElement(StatusCard, {
            appName: 'OpenWeft',
            health: runCopy.health,
            meaning: runCopy.meaning,
            nextAction: runCopy.nextAction,
            phase,
            usageLabel,
            usageValue,
            agents,
            checkpointSource: checkpointResult.source,
            diagnosticLines: buildStatusDiagnosticsLines({
              checkpointSource: checkpointResult.source,
              diagnostics
            }),
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
          usageDisplay: 'tokens',
          diagnostics,
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
        `Sent SIGTERM to OpenWeft background process ${background.pid}. Waiting for the next phase-safe checkpoint...`
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
