export const USER_REQUEST_MARKER = '{{USER_REQUEST}}';
export const CODE_EDIT_SUMMARY_MARKER = '{{CODE_EDIT_SUMMARY}}';

export const injectPromptTemplate = (
  template: string,
  marker: string,
  replacement: string
): string => {
  if (!template.includes(marker)) {
    throw new Error(`Prompt template is missing marker ${marker}.`);
  }

  return template.replaceAll(marker, replacement);
};

export const buildExecutionPrompt = (input: {
  promptBFilePath: string;
  promptBContent: string;
  planFilePath: string;
  planContent: string;
}): string => {
  return `You are executing a feature implementation using the Work Brief, the primary operating brief for this feature.
The Work Brief is provided below and is also available at ${input.promptBFilePath}.

The supporting implementation plan is also provided below and is available at ${input.planFilePath}.
Use the Work Brief as the main execution brief. The plan file is the Living Plan Ledger: it defines the manifest boundaries, required validation, current assumptions, watchpoints, implementation decisions, and execution record.

Execute the work completely. Follow the brief carefully. Run all tests specified in the plan.
If the Work Brief or plan contains read-only/no-write language meant for planning, treat it as planning-stage-only and still implement the manifest-scoped change.
Do not skip steps. Do not modify the Work Brief file. Only update the plan file to keep its ## Ledger truthful about constraints, assumptions, watchpoints, validation, implementation decisions, debugging protocol activations, and downstream impact reviews. Stay within this repository.
Do not create alternate ledgers, extra prompt files, sibling checkouts, ad hoc branches, or additional git worktrees; OpenWeft owns artifact persistence and git topology.

=== WORK BRIEF START ===
${input.promptBContent}
=== WORK BRIEF END ===

=== PLAN START ===
${input.planContent}
=== PLAN END ===`;
};

export const buildConflictResolutionPrompt = (input: {
  instruction: string;
  planFilePath?: string | null;
  planContent?: string | null;
}): string => {
  if (!input.planFilePath || !input.planContent) {
    return input.instruction;
  }

  return `You are resolving a merge conflict for an OpenWeft feature.
The original implementation plan is available at ${input.planFilePath} and is included below for context.
Use it to preserve the intended feature behavior while reconciling both sides of the merge.
If you update the plan, only update its ## Ledger to keep it truthful about the work performed.

=== PLAN START ===
${input.planContent}
=== PLAN END ===

${input.instruction}`;
};
